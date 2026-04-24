// ============================================================
// Captions/Mirage Pipeline — B-Roll Image Generator
//
// Simplified pipeline that generates:
//   1. Script (via scriptDirector.ts)
//   2. B-roll IMAGES / per-shot assets (no video gen, no Creatomate assembly)
//   3. Saves per-beat (or per-shot) files + script to a local folder
//
// Output folder: output/B Roll for Reels/{topic}/
//   1.png, 2.png, ...        — legacy beat-level files (when shots[] absent)
//   1-1.png, 1-2.png, ...    — per-shot sub-assets (when beat has shots[])
//   script.txt               — full narration for HeyGen
//   script.json              — full VideoScript (including shots[]) for reference
//
// After this pipeline runs, browser automation handles:
//   - HeyGen: paste script → generate avatar video → download
//   - Captions/Mirage / Remotion: upload avatar.mp4 + b-roll images in order
// ============================================================

import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { generateScript } from "./scriptDirector.js";
import { generateImage, saveImageToFile } from "./utils/nanoBananaClient.js";
import { searchStockPhoto } from "./utils/pexelsClient.js";
import type { VideoScript, Beat, Shot } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Save to AVATAR PIPELINE folder in project root (override with BROLL_OUTPUT_DIR env var)
const OUTPUT_BASE = process.env.BROLL_OUTPUT_DIR
  || resolve(__dirname, "../../AVATAR PIPELINE");

// ─── Types ───────────────────────────────────────────────────

interface CaptionsPipelineConfig {
  topic: string;
  targetDurationSec?: number;
  signal?: AbortSignal;
}

interface CaptionsPipelineResult {
  outputDir: string;
  script: VideoScript;
  imageCount: number;
  imageFiles: string[];
  scriptFile: string;
}

// Layouts that skip external b-roll generation entirely.
const SKIP_LAYOUTS = new Set(["avatar_closeup", "text_card", "icon_grid", "motion_graphic"]);

// Visual types rendered by Remotion — no asset fetch.
const REMOTION_ONLY_VISUAL_TYPES = new Set(["stat_card"]);

// ─── Main Pipeline ───────────────────────────────────────────

export async function runCaptionsPipeline(
  config: CaptionsPipelineConfig,
): Promise<CaptionsPipelineResult> {
  const { topic, targetDurationSec = 60, signal } = config;

  console.log(`\n========================================`);
  console.log(`[CaptionsPipeline] Starting`);
  console.log(`[CaptionsPipeline] Topic: ${topic}`);
  console.log(`========================================\n`);

  // === STAGE 1: Generate Script ===
  console.log(`[CaptionsPipeline] Stage 1: Generating script...`);
  const script = await generateScript({ topic, targetDurationSec, signal });
  console.log(`[CaptionsPipeline] Script: ${script.beats.length} beats, ${script.totalDurationSec}s`);

  // === Create output directory ===
  const folderName = sanitizeTopicName(topic);
  const outputDir = join(OUTPUT_BASE, folderName);
  await mkdir(outputDir, { recursive: true });
  console.log(`[CaptionsPipeline] Output: ${outputDir}`);

  // === STAGE 2: Generate B-Roll Images (per-beat + per-shot) ===
  console.log(`[CaptionsPipeline] Stage 2: Generating b-roll images...`);
  const imageFiles = await generateBrollImages(script, outputDir, signal);
  console.log(`[CaptionsPipeline] Generated ${imageFiles.length} b-roll files`);

  // === STAGE 3: Save Script ===
  console.log(`[CaptionsPipeline] Stage 3: Saving script...`);
  const scriptTxtPath = join(outputDir, "script.txt");
  const scriptJsonPath = join(outputDir, "script.json");

  // script.txt — plain narration text for pasting into HeyGen
  // (section markers stripped so HeyGen doesn't read them as literal text)
  const narrationText = script.beats
    .map(b => (b.narration ?? "").replace(/\[[A-Z0-9]+\]\s*/g, ""))
    .join("\n\n");
  await writeFile(scriptTxtPath, narrationText, "utf-8");

  // script.json — full VideoScript (incl. shots[]) for reference
  await writeFile(scriptJsonPath, JSON.stringify(script, null, 2), "utf-8");

  console.log(`\n========================================`);
  console.log(`[CaptionsPipeline] COMPLETE`);
  console.log(`[CaptionsPipeline] Folder: ${outputDir}`);
  console.log(`[CaptionsPipeline] Files: ${imageFiles.length}`);
  console.log(`[CaptionsPipeline] Script: ${scriptTxtPath}`);
  console.log(`========================================\n`);

  return {
    outputDir,
    script,
    imageCount: imageFiles.length,
    imageFiles,
    scriptFile: scriptTxtPath,
  };
}

// ─── B-Roll Image Generation ─────────────────────────────────

async function generateBrollImages(
  script: VideoScript,
  outputDir: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const imageFiles: string[] = [];

  for (const beat of script.beats) {
    // Skip beats that don't need b-roll
    if (SKIP_LAYOUTS.has(beat.layout)) {
      console.log(`[CaptionsPipeline] Beat ${beat.id}: ${beat.layout} — skipping (no b-roll)`);
      continue;
    }
    if (beat.remotionOnly) {
      console.log(`[CaptionsPipeline] Beat ${beat.id}: remotion-only — skipping`);
      continue;
    }

    // Per-shot generation when shots[] exists
    if (beat.shots && beat.shots.length > 0) {
      for (const shot of beat.shots) {
        if (REMOTION_ONLY_VISUAL_TYPES.has(shot.visualType)) continue;

        const saved = await tryGenerateShot(beat, shot, outputDir, signal);
        if (saved) imageFiles.push(saved);
      }
      continue;
    }

    // Legacy beat-level generation
    const saved = await tryGenerateBeat(beat, outputDir, signal);
    if (saved) imageFiles.push(saved);
  }

  return imageFiles;
}

// ─── Single-file generators (beat + shot) ─────────────────────

async function tryGenerateBeat(
  beat: Beat,
  outputDir: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const usePexels = shouldUsePexels(beat.visualType);
  const ext = usePexels ? "jpg" : "png";
  const filename = `${beat.id}.${ext}`;
  const outputPath = join(outputDir, filename);

  try {
    if (usePexels) {
      await generatePexelsImage(buildStockQuery(beat.visualPrompt), outputPath, signal);
    } else {
      await generateNanoBananaImage(buildImagePromptFromBeat(beat), outputPath, signal);
    }
    console.log(`[CaptionsPipeline] Beat ${beat.id} → ${filename} ✓`);
    return outputPath;
  } catch (err: any) {
    console.error(`[CaptionsPipeline] Beat ${beat.id} FAILED: ${err.message}`);
    // Swap source and try fallback
    const fbExt = usePexels ? "png" : "jpg";
    const fbPath = join(outputDir, `${beat.id}.${fbExt}`);
    try {
      if (usePexels) {
        console.log(`[CaptionsPipeline] Beat ${beat.id}: Pexels failed, trying Nano Banana...`);
        await generateNanoBananaImage(buildImagePromptFromBeat(beat), fbPath, signal);
      } else {
        console.log(`[CaptionsPipeline] Beat ${beat.id}: Nano Banana failed, trying Pexels...`);
        await generatePexelsImage(buildStockQuery(beat.visualPrompt), fbPath, signal);
      }
      console.log(`[CaptionsPipeline] Beat ${beat.id} → ${beat.id}.${fbExt} (fallback) ✓`);
      return fbPath;
    } catch (fallbackErr: any) {
      console.error(`[CaptionsPipeline] Beat ${beat.id}: ALL sources failed: ${fallbackErr.message}`);
      return null;
    }
  }
}

async function tryGenerateShot(
  beat: Beat,
  shot: Shot,
  outputDir: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const usePexels = shouldUsePexels(shot.visualType);
  const ext = usePexels ? "jpg" : "png";
  const filename = `${beat.id}-${shot.idx}.${ext}`;
  const outputPath = join(outputDir, filename);

  const label = `Beat ${beat.id} shot ${shot.idx}`;

  try {
    if (usePexels) {
      await generatePexelsImage(buildStockQuery(shot.visualPrompt), outputPath, signal);
    } else {
      await generateNanoBananaImage(buildImagePromptFromShot(beat, shot), outputPath, signal);
    }
    console.log(`[CaptionsPipeline] ${label} → ${filename} ✓`);
    return outputPath;
  } catch (err: any) {
    console.error(`[CaptionsPipeline] ${label} FAILED: ${err.message}`);
    const fbExt = usePexels ? "png" : "jpg";
    const fbPath = join(outputDir, `${beat.id}-${shot.idx}.${fbExt}`);
    try {
      if (usePexels) {
        console.log(`[CaptionsPipeline] ${label}: Pexels failed, trying Nano Banana...`);
        await generateNanoBananaImage(buildImagePromptFromShot(beat, shot), fbPath, signal);
      } else {
        console.log(`[CaptionsPipeline] ${label}: Nano Banana failed, trying Pexels...`);
        await generatePexelsImage(buildStockQuery(shot.visualPrompt), fbPath, signal);
      }
      console.log(`[CaptionsPipeline] ${label} → ${beat.id}-${shot.idx}.${fbExt} (fallback) ✓`);
      return fbPath;
    } catch (fallbackErr: any) {
      console.error(`[CaptionsPipeline] ${label}: ALL sources failed: ${fallbackErr.message}`);
      return null;
    }
  }
}

function shouldUsePexels(visualType: string): boolean {
  // Only real-footage visual types go to Pexels in captions mode
  return visualType === "generic_action" || visualType === "reaction_clip";
}

// ─── Image Generators ────────────────────────────────────────

async function generateNanoBananaImage(
  prompt: string,
  outputPath: string,
  signal?: AbortSignal,
): Promise<void> {
  console.log(`[CaptionsPipeline] Nano Banana: "${prompt.slice(0, 80)}..."`);
  const result = await generateImage(prompt, signal, "9:16");
  await saveImageToFile(result, outputPath);
}

async function generatePexelsImage(
  query: string,
  outputPath: string,
  signal?: AbortSignal,
): Promise<void> {
  console.log(`[CaptionsPipeline] Pexels photo: "${query}"`);
  const photo = await searchStockPhoto(query, signal);
  if (!photo) {
    throw new Error(`No Pexels photos found for "${query}"`);
  }

  const response = await fetch(photo.url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to download Pexels photo: HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, buffer);
}

// ─── Prompt Builders ─────────────────────────────────────────

function buildImagePromptFromBeat(beat: Beat): string {
  return buildImagePrompt(beat.visualType, beat.visualPrompt, beat.visualSubject);
}

function buildImagePromptFromShot(beat: Beat, shot: Shot): string {
  return buildImagePrompt(
    shot.visualType,
    shot.visualPrompt,
    shot.visualSubject ?? beat.visualSubject,
  );
}

function buildImagePrompt(
  visualType: string,
  visualPrompt: string,
  visualSubject?: string,
): string {
  switch (visualType) {
    case "named_person": {
      const subject = visualSubject ?? "a person";
      return `Photorealistic portrait of ${subject}. ${visualPrompt}. Vertical 9:16 composition, cinematic lighting, sharp focus, editorial photography style. High detail on face and expression.`;
    }
    case "brand_logo_card": {
      const brand = visualSubject ?? "the product";
      return `Ultra-clean centered logo of ${brand} on a dark gradient background (#0a0a0a → #1a1a2e). ${visualPrompt}. Minimal, sharp, high-contrast editorial style. No extra text. Vertical 9:16 composition.`;
    }
    case "product_logo_ui":
    case "screen_capture":
      return `${visualPrompt}. Clean product photography style, sharp text and UI elements, vertical 9:16 composition. High contrast, professional lighting.`;
    case "cinematic_concept":
      return `${visualPrompt}. Cinematic vertical 9:16 composition, dramatic lighting, high production value. Sharp focus, vivid colors.`;
    case "data_graphic":
      return `Infographic style image: ${visualPrompt}. Clean design, bold numbers, high contrast. Dark background with bright accent colors (#00E5FF, #FF6B00). Vertical 9:16 format.`;
    default:
      return `${visualPrompt}. High quality, vertical 9:16 composition.`;
  }
}

function buildStockQuery(prompt: string): string {
  const cleaned = prompt
    .replace(/\b(AI|artificial intelligence|neural|algorithm|machine learning|deep learning|LLM|GPT|model)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const words = cleaned.split(/\s+/).slice(0, 5).join(" ");
  return words || "technology office";
}

// ─── Utilities ───────────────────────────────────────────────

function sanitizeTopicName(topic: string): string {
  return topic
    .replace(/[^a-zA-Z0-9\s-]/g, "")  // remove special chars
    .replace(/\s+/g, "-")              // spaces → hyphens
    .replace(/-+/g, "-")               // collapse multiple hyphens
    .slice(0, 80)                       // cap length
    .replace(/^-|-$/g, "");            // trim leading/trailing hyphens
}

// ─── CLI Entry Point ─────────────────────────────────────────

if (process.argv[1]?.endsWith("captionsPipeline.ts") || process.argv[1]?.endsWith("captionsPipeline.js")) {
  const topic = process.argv[2] ?? "OpenAI just released GPT-5 with real-time video understanding and autonomous task completion";

  runCaptionsPipeline({ topic })
    .then(result => {
      console.log(`\nDone! ${result.imageCount} files saved to:`);
      console.log(result.outputDir);
      console.log(`\nNext steps:`);
      console.log(`1. Open HeyGen → paste script from: ${result.scriptFile}`);
      console.log(`2. Generate avatar video → save as avatar.mp4 in the same folder`);
      console.log(`3. Upload avatar.mp4 + all numbered files to Captions/Mirage or Remotion`);
    })
    .catch(err => {
      console.error(`Pipeline failed: ${err.message}`);
      process.exit(1);
    });
}
