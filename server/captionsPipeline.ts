// ============================================================
// Captions Pipeline — Server-Side Bridge
//
// Same robust research + script + asset generation as avatarPipeline,
// but instead of HeyGen + Creatomate assembly, saves numbered b-roll
// images + script to a local folder for manual assembly via Captions/Mirage.
//
// Stages:
//   1. Discovery + Research (SAME as API pipeline — NewsAPI, Reddit, GPT)
//   2. Script Generation (SAME — verified facts, content buckets)
//   3. Asset Generation (SAME — assetRouter + generateAllAssetsMulti)
//   4. Save to Folder (NEW — download URLs → numbered PNGs/JPGs + script.txt)
//
// The discovery + topic review stages are handled by avatarPipeline.ts
// (shared). This file only handles post-topic-approval stages.
// ============================================================

import { eq } from "drizzle-orm";
import { getDb } from "./db.js";
import { avatarRuns } from "../drizzle/schema.js";
import type { VerifiedFact } from "./avatarResearch.js";
import type { ContentBucket } from "../videogen-avatar/src/prompts/quinnPersona.js";
import { mkdir, writeFile, readdir, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";

// Output base directory — defaults to AVATAR PIPELINE folder in project root
// Override with BROLL_OUTPUT_DIR env var to save elsewhere
const OUTPUT_BASE = process.env.BROLL_OUTPUT_DIR
  || resolve(process.cwd(), "AVATAR PIPELINE");

// ─── Abort Controller Registry ──────────────────────────────

const runningPipelines = new Map<number, AbortController>();

// ─── DB Helpers ─────────────────────────────────────────────

async function updateRun(runId: number, fields: Record<string, any>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(avatarRuns).set({ ...fields, updatedAt: new Date() }).where(eq(avatarRuns.id, runId));
}

async function getRun(runId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(avatarRuns).where(eq(avatarRuns.id, runId)).limit(1);
  return rows[0] ?? null;
}

// ─── After topic approval → script → assets → save to folder ──

export async function continueAfterTopicApprovalCaptions(
  runId: number,
  topicIndex: number,
): Promise<void> {
  const ac = new AbortController();
  runningPipelines.set(runId, ac);

  try {
    // No HeyGen/Creatomate keys needed for captions pipeline
    // We only need Gemini (Nano Banana) and/or Pexels
    const { hasKey } = await import("../videogen-avatar/src/config.js");
    if (!hasKey("gemini") && !hasKey("pexels")) {
      throw new Error("Need at least GEMINI_API_KEY or PEXELS_API_KEY for image generation.");
    }

    const run = await getRun(runId);
    if (!run) throw new Error(`Run ${runId} not found`);

    // Parse candidates and select the approved topic
    const candidates = JSON.parse(run.topicCandidates ?? "[]");
    const approved = candidates[topicIndex];
    if (!approved) throw new Error(`Invalid topic index: ${topicIndex}`);

    // Persist approved topic + its sources/facts
    await updateRun(runId, {
      status: "scripting",
      statusDetail: `[Captions] Generating script for: "${approved.title.slice(0, 60)}..."`,
      topic: approved.title,
      sourceArticles: JSON.stringify(approved.sources),
      extractedFacts: JSON.stringify(approved.facts),
      verificationStatus: approved.verificationStatus,
      viralityScore: Math.round(approved.weightedScore * 10),
    });

    if (ac.signal.aborted) throw new Error("Pipeline cancelled");

    // Stage 2: Generate script from verified facts (SAME as API pipeline)
    const { generateScript } = await import("../videogen-avatar/src/scriptDirector.js");
    const script = await generateScript({
      topic: approved.title,
      targetDurationSec: 60,
      // No dayNumber — Captions pipeline has no series
      contentBucket: (run.contentBucket as ContentBucket) ?? undefined,
      verifiedFacts: approved.facts,
      signal: ac.signal,
    });

    await updateRun(runId, {
      scriptJson: JSON.stringify(script),
      instagramCaption: script.caption,
      statusDetail: `[Captions] Script ready: ${script.beats.length} beats, ${script.totalDurationSec}s. Generating b-roll...`,
    });

    if (ac.signal.aborted) throw new Error("Pipeline cancelled");

    // Stage 3: Asset generation using smart routing (SAME as API pipeline)
    await updateRun(runId, {
      status: "generating_assets",
      statusDetail: "[Captions] Generating b-roll images with smart routing...",
    });

    const { routeAssets } = await import("../videogen-avatar/src/assetRouter.js");
    const { generateAllAssetsMulti } = await import("../videogen-avatar/src/assetGenerator.js");

    const manifest = routeAssets(script);
    const { primary: assets, multi: multiAssets } = await generateAllAssetsMulti(manifest, ac.signal, { imagesOnly: true });

    if (ac.signal.aborted) throw new Error("Pipeline cancelled");

    // ─── Minimum B-Roll Enforcement ────────────────────────────
    const MIN_BROLL = 5;
    const assetCount = Object.keys(assets).length;
    const beatsNeedingAssets = script.beats.filter((b: any) => b.layout !== "text_card");

    if (assetCount < MIN_BROLL && beatsNeedingAssets.length >= MIN_BROLL) {
      console.warn(`[CaptionsPipeline] Only ${assetCount} assets — below minimum ${MIN_BROLL}. Backfilling with AI images...`);
      await updateRun(runId, {
        statusDetail: `[Captions] Only ${assetCount}/${MIN_BROLL} assets. Generating AI backfill...`,
      });

      const { generateImage } = await import("../videogen-avatar/src/utils/nanoBananaClient.js");
      const missingBeats = beatsNeedingAssets.filter((b: any) => !assets[b.id]);
      for (const beat of missingBeats.slice(0, MIN_BROLL - assetCount)) {
        try {
          const aspectRatio = beat.layout === "pip" ? "1:1" as const : "9:16" as const;
          const result = await generateImage(beat.visualPrompt, ac.signal, aspectRatio);
          const buffer = Buffer.from(result.imageBase64, "base64");
          const { storagePut } = await import("./storage.js");
          const ext = result.mimeType.includes("png") ? "png" : "jpg";
          const key = `avatar-broll/backfill-beat-${beat.id}-${Date.now()}.${ext}`;
          const { url: localPath } = await storagePut(key, buffer, result.mimeType);
          const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
            ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
            : process.env.BASE_URL || "https://social-media-engin-production.up.railway.app";
          const publicUrl = `${baseUrl}${localPath}`;
          assets[beat.id] = {
            beatId: beat.id,
            source: "nano_banana" as any,
            mediaType: "image",
            url: publicUrl,
            width: 1080,
            height: aspectRatio === "1:1" ? 1080 : 1920,
            fallbackUsed: true,
          };
          multiAssets[beat.id] = [assets[beat.id]];
          console.log(`[CaptionsPipeline] Backfilled beat ${beat.id} with AI image`);
        } catch (err: any) {
          console.warn(`[CaptionsPipeline] Backfill for beat ${beat.id} failed: ${err.message}`);
        }
      }
    }

    await updateRun(runId, {
      assetMap: JSON.stringify(assets),
      multiAssetMap: JSON.stringify(multiAssets),
      statusDetail: `[Captions] ${Object.keys(assets).length} assets generated. Saving to folder...`,
    });

    // Stage 4: Download assets and save as numbered files to local folder
    await updateRun(runId, {
      status: "assembling",
      statusDetail: "[Captions] Saving numbered b-roll images + script to folder...",
    });

    const folderName = sanitizeTopicName(approved.title);
    const outputDir = join(OUTPUT_BASE, folderName);
    const savedFiles = await saveAssetsToFolder(script, assets, outputDir, runId, ac.signal);

    // Close headless browser if it was used during asset generation
    try {
      const { closeBrowser } = await import("./headlessBroll.js");
      await closeBrowser();
    } catch { /* browser may not have been started */ }

    // Mark complete — only store the folder name, not full server path
    await updateRun(runId, {
      status: "completed",
      statusDetail: `[Captions] Done! ${savedFiles.length} b-roll files + script saved.`,
      brollOutputDir: `AVATAR PIPELINE/${folderName}`,
      brollImageCount: savedFiles.length,
    });

    console.log(`[CaptionsPipeline] Run ${runId}: ${savedFiles.length} files saved to ${outputDir}`);
  } catch (err: any) {
    if (err.message === "Pipeline cancelled") {
      await updateRun(runId, { status: "cancelled", statusDetail: "Cancelled by user" });
    } else {
      await updateRun(runId, { status: "failed", errorMessage: err.message, statusDetail: `Failed: ${err.message}` });
      console.error(`[CaptionsPipeline] Run ${runId} failed:`, err);
    }
  } finally {
    runningPipelines.delete(runId);
  }
}

// ─── Feedback / Revision for Captions ────────────────────────

export async function handleCaptionsFeedback(runId: number, feedback: string): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);

  const history = JSON.parse(run.feedbackHistory ?? "[]");
  history.push({ feedback, timestamp: new Date().toISOString(), fromStt: false });

  await updateRun(runId, {
    feedbackHistory: JSON.stringify(history),
    revisionCount: (run.revisionCount ?? 0) + 1,
  });

  // Re-run from scripting
  const facts: VerifiedFact[] = JSON.parse(run.extractedFacts ?? "[]");
  await rerunCaptionsPipeline(runId, run.topic ?? "", facts, feedback);
}

async function rerunCaptionsPipeline(
  runId: number,
  topic: string,
  facts: VerifiedFact[],
  feedback?: string,
): Promise<void> {
  const ac = new AbortController();
  runningPipelines.set(runId, ac);

  try {
    const run = await getRun(runId);
    if (!run) throw new Error(`Run ${runId} not found`);

    await updateRun(runId, {
      status: "scripting",
      statusDetail: feedback
        ? `[Captions] Re-generating with feedback: "${feedback.slice(0, 60)}..."`
        : "[Captions] Re-generating script...",
    });

    const { generateScript } = await import("../videogen-avatar/src/scriptDirector.js");
    const script = await generateScript({
      topic,
      targetDurationSec: 60,
      // No dayNumber — Captions pipeline has no series
      contentBucket: (run.contentBucket as ContentBucket) ?? undefined,
      verifiedFacts: facts,
      feedback,
      signal: ac.signal,
    });

    await updateRun(runId, {
      scriptJson: JSON.stringify(script),
      instagramCaption: script.caption,
      status: "generating_assets",
      statusDetail: "[Captions] Re-generating b-roll images...",
    });

    if (ac.signal.aborted) throw new Error("Pipeline cancelled");

    const { routeAssets } = await import("../videogen-avatar/src/assetRouter.js");
    const { generateAllAssetsMulti } = await import("../videogen-avatar/src/assetGenerator.js");

    const manifest = routeAssets(script);
    const { primary: assets, multi: multiAssets } = await generateAllAssetsMulti(manifest, ac.signal, { imagesOnly: true });

    await updateRun(runId, {
      assetMap: JSON.stringify(assets),
      multiAssetMap: JSON.stringify(multiAssets),
      status: "assembling",
      statusDetail: "[Captions] Saving revised b-roll files...",
    });

    // Save to folder (cleans old files first)
    const folderName = sanitizeTopicName(topic);
    const outputDir = join(OUTPUT_BASE, folderName);
    const savedFiles = await saveAssetsToFolder(script, assets, outputDir, runId, ac.signal);

    await updateRun(runId, {
      status: "completed",
      statusDetail: `[Captions] Revised! ${savedFiles.length} b-roll files saved.`,
      brollOutputDir: `AVATAR PIPELINE/${folderName}`,
      brollImageCount: savedFiles.length,
    });
  } catch (err: any) {
    if (err.message === "Pipeline cancelled") {
      await updateRun(runId, { status: "cancelled" });
    } else {
      await updateRun(runId, { status: "failed", errorMessage: err.message, statusDetail: `Failed: ${err.message}` });
    }
  } finally {
    runningPipelines.delete(runId);
  }
}

// ─── Cancel ─────────────────────────────────────────────────

export function cancelCaptionsPipeline(runId: number): boolean {
  const ac = runningPipelines.get(runId);
  if (ac) {
    ac.abort();
    return true;
  }
  return false;
}

// ─── Utilities ──────────────────────────────────────────────

function sanitizeTopicName(topic: string): string {
  return topic
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80)
    .replace(/^-|-$/g, "");
}

/** Remove all files in a directory (not subdirectories) before re-saving */
async function cleanFolder(dir: string): Promise<void> {
  try {
    const files = await readdir(dir);
    await Promise.all(files.map(f => unlink(join(dir, f)).catch(() => {})));
  } catch {
    // Directory may not exist yet — that's fine
  }
}

/** Shared: download assets and save as numbered files to a local folder */
async function saveAssetsToFolder(
  script: any,
  assets: Record<string, any>,
  outputDir: string,
  runId: number,
  signal?: AbortSignal,
): Promise<string[]> {
  await mkdir(outputDir, { recursive: true });
  await cleanFolder(outputDir);

  let imageNumber = 1;
  const savedFiles: string[] = [];

  for (const beat of script.beats) {
    if (beat.layout === "avatar_closeup" || beat.layout === "text_card") continue;
    const asset = assets[beat.id];
    if (!asset) {
      console.warn(`[CaptionsPipeline] Beat ${beat.id}: no asset generated, skipping`);
      continue;
    }

    try {
      const response = await fetch(asset.url, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status} downloading ${asset.url}`);
      const buffer = Buffer.from(await response.arrayBuffer());

      // Captions app only supports images — skip any video assets
      if (asset.mediaType === "video") {
        console.warn(`[CaptionsPipeline] Beat ${beat.id}: skipping video asset (Captions app = images only)`);
        continue;
      }
      const ext = asset.url.includes(".jpg") || asset.url.includes(".jpeg") ? "jpg" : "png";
      const filename = `${imageNumber}.${ext}`;
      await writeFile(join(outputDir, filename), buffer);
      savedFiles.push(filename);
      console.log(`[CaptionsPipeline] Beat ${beat.id} → ${filename} (${asset.source})`);
      imageNumber++;

      await updateRun(runId, {
        statusDetail: `[Captions] Saved ${savedFiles.length} files... (beat ${beat.id})`,
      });
    } catch (dlErr: any) {
      console.error(`[CaptionsPipeline] Beat ${beat.id}: download failed: ${dlErr.message}`);
    }
  }

  // Save script files
  const narrationText = script.beats.map((b: any) => b.narration).join("\n\n");
  await writeFile(join(outputDir, "script.txt"), narrationText, "utf-8");
  await writeFile(join(outputDir, "script.json"), JSON.stringify(script, null, 2), "utf-8");

  return savedFiles;
}
