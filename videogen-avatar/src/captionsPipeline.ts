// ============================================================
// Captions/Mirage Pipeline — B-Roll Image Generator
//
// Simplified pipeline that generates:
//   1. Script (via scriptDirector.ts)
//   2. B-roll IMAGES only (no video gen, no Creatomate assembly)
//   3. Saves numbered images + script to a local folder
//
// Output folder: output/B Roll for Reels/{topic}/
//   1.png, 2.png, ... (b-roll images in beat order)
//   script.txt         (full narration for HeyGen)
//   script.json        (full VideoScript for reference)
//
// After this pipeline runs, browser automation handles:
//   - HeyGen: paste script → generate avatar video → download
//   - Captions/Mirage: upload avatar.mp4 + b-roll images in order
// ============================================================

import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { generateScript } from "./scriptDirector.js";
import { generateImage, saveImageToFile } from "./utils/nanoBananaClient.js";
import { searchStockPhoto } from "./utils/pexelsClient.js";
import type { VideoScript, Beat } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_BASE = resolve(__dirname, "../output/B Roll for Reels");

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

  // === STAGE 2: Generate B-Roll Images ===
  console.log(`[CaptionsPipeline] Stage 2: Generating b-roll images...`);
  const imageFiles = await generateBrollImages(script, outputDir, signal);
  console.log(`[CaptionsPipeline] Generated ${imageFiles.length} b-roll images`);

  // === STAGE 3: Save Script ===
  console.log(`[CaptionsPipeline] Stage 3: Saving script...`);
  const scriptTxtPath = join(outputDir, "script.txt");
  const scriptJsonPath = join(outputDir, "script.json");

  // script.txt — plain narration text for pasting into HeyGen
  const narrationText = script.beats.map(b => b.narration).join("\n\n");
  await writeFile(scriptTxtPath, narrationText, "utf-8");

  // script.json — full VideoScript for reference
  await writeFile(scriptJsonPath, JSON.stringify(script, null, 2), "utf-8");

  console.log(`\n========================================`);
  console.log(`[CaptionsPipeline] COMPLETE`);
  console.log(`[CaptionsPipeline] Folder: ${outputDir}`);
  console.log(`[CaptionsPipeline] Images: ${imageFiles.length}`);
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
  let imageNumber = 1;

  for (const beat of script.beats) {
    // Skip beats that don't need b-roll
    if (beat.layout === "avatar_closeup" || beat.layout === "text_card") {
      console.log(`[CaptionsPipeline] Beat ${beat.id}: ${beat.layout} — skipping (no b-roll)`);
      continue;
    }

    // Pexels returns JPEG, Nano Banana returns PNG — use correct extension
    const isPexelsBeat = beat.visualType === "generic_action";
    const ext = isPexelsBeat ? "jpg" : "png";
    const filename = `${imageNumber}.${ext}`;
    const outputPath = join(outputDir, filename);

    try {
      if (isPexelsBeat) {
        await generatePexelsImage(beat, outputPath, signal);
      } else {
        await generateNanoBananaImage(beat, outputPath, signal);
      }

      imageFiles.push(outputPath);
      console.log(`[CaptionsPipeline] Beat ${beat.id} → ${filename} ✓`);
      imageNumber++;
    } catch (err: any) {
      console.error(`[CaptionsPipeline] Beat ${beat.id} FAILED: ${err.message}`);
      // Try fallback with the other source (extension may be wrong but Captions handles both)
      const fallbackExt = isPexelsBeat ? "png" : "jpg";
      const fallbackPath = join(outputDir, `${imageNumber}.${fallbackExt}`);
      try {
        if (isPexelsBeat) {
          console.log(`[CaptionsPipeline] Beat ${beat.id}: Pexels failed, trying Nano Banana...`);
          await generateNanoBananaImage(beat, fallbackPath, signal);
        } else {
          console.log(`[CaptionsPipeline] Beat ${beat.id}: Nano Banana failed, trying Pexels...`);
          await generatePexelsImage(beat, fallbackPath, signal);
        }
        imageFiles.push(fallbackPath);
        console.log(`[CaptionsPipeline] Beat ${beat.id} → ${imageNumber}.${fallbackExt} (fallback) ✓`);
        imageNumber++;
      } catch (fallbackErr: any) {
        console.error(`[CaptionsPipeline] Beat ${beat.id}: ALL sources failed: ${fallbackErr.message}`);
      }
    }
  }

  return imageFiles;
}

// ─── Image Generators ────────────────────────────────────────

async function generateNanoBananaImage(
  beat: Beat,
  outputPath: string,
  signal?: AbortSignal,
): Promise<void> {
  const prompt = buildImagePrompt(beat);
  console.log(`[CaptionsPipeline] Nano Banana: "${prompt.slice(0, 80)}..."`);

  const result = await generateImage(prompt, signal, "9:16");
  await saveImageToFile(result, outputPath);
}

async function generatePexelsImage(
  beat: Beat,
  outputPath: string,
  signal?: AbortSignal,
): Promise<void> {
  const query = buildStockQuery(beat);
  console.log(`[CaptionsPipeline] Pexels photo: "${query}"`);

  const photo = await searchStockPhoto(query, signal);
  if (!photo) {
    throw new Error(`No Pexels photos found for "${query}"`);
  }

  // Download the image
  const response = await fetch(photo.url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to download Pexels photo: HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, buffer);
}

// ─── Prompt Builders ─────────────────────────────────────────
// Adapted from assetRouter.ts prompt builders

function buildImagePrompt(beat: Beat): string {
  switch (beat.visualType) {
    case "named_person": {
      const subject = beat.visualSubject ?? "a person";
      return `Photorealistic portrait of ${subject}. ${beat.visualPrompt}. Vertical 9:16 composition, cinematic lighting, sharp focus, editorial photography style. High detail on face and expression.`;
    }
    case "product_logo_ui":
    case "screen_capture":
      return `${beat.visualPrompt}. Clean product photography style, sharp text and UI elements, vertical 9:16 composition. High contrast, professional lighting.`;
    case "cinematic_concept":
      return `${beat.visualPrompt}. Cinematic vertical 9:16 composition, dramatic lighting, high production value. Sharp focus, vivid colors.`;
    case "data_graphic":
      return `Infographic style image: ${beat.visualPrompt}. Clean design, bold numbers, high contrast. Dark background with bright accent colors (#00E5FF, #FF6B00). Vertical 9:16 format.`;
    default:
      return `${beat.visualPrompt}. High quality, vertical 9:16 composition.`;
  }
}

function buildStockQuery(beat: Beat): string {
  // Strip AI jargon for Pexels search
  const cleaned = beat.visualPrompt
    .replace(/\b(AI|artificial intelligence|neural|algorithm|machine learning|deep learning|LLM|GPT|model)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  // 5 words max for better results
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
      console.log(`\nDone! ${result.imageCount} images saved to:`);
      console.log(result.outputDir);
      console.log(`\nNext steps:`);
      console.log(`1. Open HeyGen → paste script from: ${result.scriptFile}`);
      console.log(`2. Generate avatar video → save as avatar.mp4 in the same folder`);
      console.log(`3. Upload avatar.mp4 + all numbered PNGs to Captions/Mirage`);
    })
    .catch(err => {
      console.error(`Pipeline failed: ${err.message}`);
      process.exit(1);
    });
}
