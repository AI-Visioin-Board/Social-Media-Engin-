// ============================================================
// AI News You Can Use — Pipeline Orchestrator
// Educational reel series: Tue/Thu schedule, 30-episode day counter.
//
// OUTPUT: Saves script + B-roll to local folder for manual assembly.
// Avatar video is created manually through HeyGen UI (v4 quality).
// No HeyGen API, no Creatomate. Pipeline ends after saving assets.
//
// Folder structure:
//   AVATAR PIPELINE/AI News You Can Use/<topic-name>/
//     script.txt        — narration text
//     script.json       — full beat-by-beat script
//     1.png             — B-roll for beat 1
//     step1--gemini-agents-tab--3s.png  — headless capture with descriptive name
//     2.png             — B-roll for beat 2
//     ...
// ============================================================

import { eq } from "drizzle-orm";
import { getDb } from "./db.js";
import { ainycuRuns, appSettings } from "../drizzle/schema.js";
import { runFullResearch, type VerifiedTopic, type VerifiedFact } from "./ainycuResearch.js";
import { mkdir, writeFile, readdir, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";

// Output directory — AVATAR PIPELINE/AI News You Can Use/<topic>/
const OUTPUT_BASE = process.env.BROLL_OUTPUT_DIR
  || resolve(process.cwd(), "AVATAR PIPELINE", "AI News You Can Use");

// ─── Abort Controller Registry ──────────────────────────────

const runningPipelines = new Map<number, AbortController>();

// ─── DB Helpers ─────────────────────────────────────────────

async function updateRun(runId: number, fields: Record<string, any>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(ainycuRuns).set({ ...fields, updatedAt: new Date() }).where(eq(ainycuRuns.id, runId));
}

async function getRun(runId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(ainycuRuns).where(eq(ainycuRuns.id, runId)).limit(1);
  return rows[0] ?? null;
}

// ─── Day Counter ────────────────────────────────────────────

async function getNextDayNumber(): Promise<number> {
  const db = await getDb();
  if (!db) return 1;
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, "ainycu_next_day_number")).limit(1);
  return parseInt(rows[0]?.value ?? "1", 10);
}

async function incrementDayNumber(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const current = await getNextDayNumber();
  const next = current + 1;
  await db.update(appSettings)
    .set({ value: String(next), updatedAt: new Date() })
    .where(eq(appSettings.key, "ainycu_next_day_number"));
  console.log(`[AINYCU Pipeline] Day counter incremented: ${current} → ${next}`);
}

// ─── Stage 1: Discovery + Research → pause at topic_review ──

export async function runAinycuPipeline(runId: number, suggestedTopic?: string): Promise<void> {
  const ac = new AbortController();
  runningPipelines.set(runId, ac);

  try {
    await updateRun(runId, {
      status: "topic_discovery",
      statusDetail: suggestedTopic
        ? `Researching suggested topic: "${suggestedTopic}"...`
        : "Discovering actionable AI tools and features...",
    });

    const research = await runFullResearch(suggestedTopic);

    if (ac.signal.aborted) throw new Error("Pipeline cancelled");

    await updateRun(runId, {
      status: "topic_review",
      statusDetail: `${research.candidates.length} verified topics ready for review`,
      topicCandidates: JSON.stringify(research.candidates),
    });

    // Auto-approve if user suggested the topic
    if (suggestedTopic && research.candidates.length > 0) {
      console.log(`[AINYCU Pipeline] Run ${runId}: Auto-approving suggested topic`);
      await continueAfterTopicApproval(runId, 0);
      return;
    }

    console.log(`[AINYCU Pipeline] Run ${runId}: ${research.candidates.length} candidates ready for review`);
  } catch (err: any) {
    if (err.message === "Pipeline cancelled") {
      await updateRun(runId, { status: "cancelled", statusDetail: "Cancelled by user" });
    } else {
      await updateRun(runId, { status: "failed", errorMessage: err.message, statusDetail: `Failed: ${err.message}` });
      console.error(`[AINYCU Pipeline] Run ${runId} failed:`, err);
    }
  } finally {
    runningPipelines.delete(runId);
  }
}

// ─── Stage 2-4: Topic approval → script → assets → save to folder ──

export async function continueAfterTopicApproval(
  runId: number,
  topicIndex: number,
): Promise<void> {
  const ac = new AbortController();
  runningPipelines.set(runId, ac);

  try {
    // Only need Gemini/Pexels for image assets (no HeyGen/Creatomate needed)
    const { hasKey } = await import("../videogen-avatar/src/config.js");
    if (!hasKey("gemini") && !hasKey("pexels")) {
      throw new Error("Need at least GEMINI_API_KEY or PEXELS_API_KEY for B-roll generation.");
    }

    const run = await getRun(runId);
    if (!run) throw new Error(`Run ${runId} not found`);

    const candidates: VerifiedTopic[] = JSON.parse(run.topicCandidates ?? "[]");
    const approved = candidates[topicIndex];
    if (!approved) throw new Error(`Invalid topic index: ${topicIndex}`);

    // Read the day number (assigned at generation time)
    const dayNumber = run.draftDay ?? run.dayNumber ?? await getNextDayNumber();

    await updateRun(runId, {
      status: "scripting",
      statusDetail: `Generating educational script for Day ${dayNumber}: "${approved.title.slice(0, 60)}..."`,
      topic: approved.title,
      topicAngle: approved.angle ?? null,
      topicSourceUrl: approved.url ?? null,
      sourceArticles: JSON.stringify(approved.sources),
      extractedFacts: JSON.stringify(approved.facts),
      verificationStatus: approved.verificationStatus,
      viralityScore: Math.round(approved.weightedScore * 10),
      dayNumber,
      draftDay: dayNumber,
    });

    if (ac.signal.aborted) throw new Error("Pipeline cancelled");

    // Stage 2: Generate educational script
    const { generateAinycuScript } = await import("../videogen-avatar/src/ainycuScriptDirector.js");
    const script = await generateAinycuScript({
      topic: approved.title,
      angle: approved.angle,
      dayNumber,
      verifiedFacts: approved.facts,
      signal: ac.signal,
    });

    await updateRun(runId, {
      scriptJson: JSON.stringify(script),
      instagramCaption: script.caption,
      statusDetail: `Script ready: ${script.beats.length} beats, ${script.totalDurationSec}s. Generating B-roll...`,
    });

    if (ac.signal.aborted) throw new Error("Pipeline cancelled");

    // Stage 3: Asset generation (headless captures + Nano Banana + Pexels)
    await updateRun(runId, {
      status: "generating_assets",
      statusDetail: "Generating B-roll assets (headless captures + AI images)...",
    });

    const { routeAssets } = await import("../videogen-avatar/src/assetRouter.js");
    const { generateAllAssetsMulti } = await import("../videogen-avatar/src/assetGenerator.js");

    const manifest = routeAssets(script);
    const { primary: assets, multi: multiAssets } = await generateAllAssetsMulti(manifest, ac.signal);

    if (ac.signal.aborted) throw new Error("Pipeline cancelled");

    // ─── Targeted B-Roll Backfill ───────────────────────────────
    // Only backfill beats that NEED B-roll (pip/fullscreen_broll) but are missing it.
    // No artificial minimum — trust the script structure. Avatar closeups, text cards,
    // and graphic scenes don't need B-roll and will be filled by Remotion components.
    const beatsNeedingBroll = script.beats.filter(
      (b: any) => (b.layout === "pip" || b.layout === "fullscreen_broll") && !assets[b.id]
    );

    if (beatsNeedingBroll.length > 0) {
      console.warn(`[AINYCU Pipeline] ${beatsNeedingBroll.length} beats need B-roll but are missing assets. Backfilling...`);
      await updateRun(runId, {
        statusDetail: `${beatsNeedingBroll.length} B-roll beats missing assets. Generating AI backfill...`,
      });

      const { generateImage } = await import("../videogen-avatar/src/utils/nanoBananaClient.js");
      for (const beat of beatsNeedingBroll) {
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
          console.log(`[AINYCU Pipeline] Backfilled beat ${beat.id} with AI image`);
        } catch (err: any) {
          console.warn(`[AINYCU Pipeline] Backfill for beat ${beat.id} failed: ${err.message}`);
        }
      }
    }

    await updateRun(runId, {
      assetMap: JSON.stringify(assets),
      multiAssetMap: JSON.stringify(multiAssets),
      statusDetail: `${Object.keys(assets).length} assets generated. Saving to folder...`,
    });

    // Stage 4: Download assets and save to local folder
    await updateRun(runId, {
      status: "assembling",
      statusDetail: "Saving B-roll + script to local folder...",
    });

    const folderName = sanitizeTopicName(approved.title);
    const outputDir = join(OUTPUT_BASE, folderName);
    const savedFiles = await saveAssetsToFolder(script, assets, outputDir, runId, approved.url, ac.signal);

    // Close headless browser if it was used (free memory)
    try {
      const { closeBrowser } = await import("./headlessBroll.js");
      await closeBrowser();
    } catch { /* browser may not have been started */ }

    // Mark complete — pipeline ends here. User creates avatar video manually.
    await updateRun(runId, {
      status: "completed",
      statusDetail: `Day ${dayNumber} ready! ${savedFiles.length} B-roll files + script saved to folder. Create avatar video in HeyGen UI.`,
      brollOutputDir: `AVATAR PIPELINE/AI News You Can Use/${folderName}`,
      brollImageCount: savedFiles.length,
    });

    console.log(`[AINYCU Pipeline] Run ${runId}: Day ${dayNumber} — ${savedFiles.length} files saved to ${outputDir}`);
  } catch (err: any) {
    if (err.message === "Pipeline cancelled") {
      await updateRun(runId, { status: "cancelled", statusDetail: "Cancelled by user" });
    } else {
      await updateRun(runId, { status: "failed", errorMessage: err.message, statusDetail: `Failed: ${err.message}` });
      console.error(`[AINYCU Pipeline] Run ${runId} failed:`, err);
    }
  } finally {
    runningPipelines.delete(runId);
  }
}

// ─── Approve Post + Increment Day Counter ───────────────────

export async function continueAfterVideoApproval(runId: number, caption?: string): Promise<void> {
  try {
    const run = await getRun(runId);
    if (!run) throw new Error(`Run ${runId} not found`);

    await updateRun(runId, {
      status: "posting",
      statusDetail: "Posting to Instagram via Make.com webhook...",
      instagramCaption: caption || run.instagramCaption,
    });

    const { ENV } = await import("./_core/env.js");
    if (!ENV.makeWebhookUrl) {
      // Still increment day counter even without webhook
      await incrementDayNumber();
      await updateRun(runId, {
        status: "completed",
        statusDetail: `Day ${run.draftDay} approved (no webhook configured). Day counter advanced.`,
        finalDay: run.draftDay,
      });
      return;
    }

    const res = await fetch(ENV.makeWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "reel",
        videoUrl: run.finalVideoUrl,
        caption: caption || run.instagramCaption,
        topic: run.topic,
        dayNumber: run.draftDay,
        series: "ai_news_you_can_use",
      }),
      signal: AbortSignal.timeout(30_000),
    });

    // Increment day counter on successful post
    await incrementDayNumber();

    if (res.ok) {
      const data = await res.json().catch(() => ({})) as any;
      await updateRun(runId, {
        status: "completed",
        statusDetail: `Day ${run.draftDay} posted to Instagram!`,
        instagramPostId: data?.postId ?? data?.id ?? "posted",
        finalDay: run.draftDay,
      });
    } else {
      await updateRun(runId, {
        status: "completed",
        statusDetail: `Day ${run.draftDay} approved. Instagram posting returned ${res.status}. Day counter advanced.`,
        finalDay: run.draftDay,
      });
    }
  } catch (err: any) {
    // Still increment on approval even if posting fails
    await incrementDayNumber();
    const run = await getRun(runId);
    await updateRun(runId, {
      status: "completed",
      statusDetail: `Day ${run?.draftDay ?? "?"} approved. Posting error: ${err.message}. Day counter advanced.`,
      errorMessage: err.message,
      finalDay: run?.draftDay ?? null,
    });
  }
}

// ─── Reject Video (day counter stays) ───────────────────────

export async function rejectVideo(runId: number): Promise<void> {
  await updateRun(runId, {
    status: "failed",
    statusDetail: "Video rejected. Day counter unchanged — next run will use the same day number.",
  });
  console.log(`[AINYCU Pipeline] Run ${runId}: Video rejected. Day counter NOT incremented.`);
}

// ─── Feedback / Revision ────────────────────────────────────

export async function handleFeedback(runId: number, feedback: string, fromStt: boolean): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);

  const history = JSON.parse(run.feedbackHistory ?? "[]");
  history.push({ feedback, timestamp: new Date().toISOString(), fromStt });

  await updateRun(runId, {
    status: "revision",
    statusDetail: `Revision ${(run.revisionCount ?? 0) + 1}: Re-generating with feedback...`,
    feedbackHistory: JSON.stringify(history),
    revisionCount: (run.revisionCount ?? 0) + 1,
  });

  const facts: VerifiedFact[] = JSON.parse(run.extractedFacts ?? "[]");
  await rerunPipeline(runId, run.topic ?? "", run.topicAngle ?? undefined, facts, feedback);
}

async function rerunPipeline(
  runId: number,
  topic: string,
  angle: string | undefined,
  facts: VerifiedFact[],
  feedback?: string,
): Promise<void> {
  const ac = new AbortController();
  runningPipelines.set(runId, ac);

  try {
    const run = await getRun(runId);
    if (!run) throw new Error(`Run ${runId} not found`);

    const dayNumber = run.draftDay ?? run.dayNumber ?? await getNextDayNumber();

    await updateRun(runId, {
      status: "scripting",
      statusDetail: feedback
        ? `Re-generating Day ${dayNumber} script with feedback...`
        : `Generating Day ${dayNumber} script...`,
    });

    const { generateAinycuScript } = await import("../videogen-avatar/src/ainycuScriptDirector.js");
    const script = await generateAinycuScript({
      topic,
      angle,
      dayNumber,
      verifiedFacts: facts,
      feedback,
      signal: ac.signal,
    });

    await updateRun(runId, {
      scriptJson: JSON.stringify(script),
      instagramCaption: script.caption,
      status: "generating_assets",
      statusDetail: "Re-generating B-roll assets...",
    });

    if (ac.signal.aborted) throw new Error("Pipeline cancelled");

    const { routeAssets } = await import("../videogen-avatar/src/assetRouter.js");
    const { generateAllAssetsMulti } = await import("../videogen-avatar/src/assetGenerator.js");

    const manifest = routeAssets(script);
    const { primary: assets, multi: multiAssets } = await generateAllAssetsMulti(manifest, ac.signal);

    await updateRun(runId, {
      assetMap: JSON.stringify(assets),
      multiAssetMap: JSON.stringify(multiAssets),
      status: "assembling",
      statusDetail: "Saving revised B-roll files to folder...",
    });

    // Save to folder (cleans old files first)
    const folderName = sanitizeTopicName(topic);
    const outputDir = join(OUTPUT_BASE, folderName);
    const topicUrl = run.topicSourceUrl ?? undefined;
    const savedFiles = await saveAssetsToFolder(script, assets, outputDir, runId, topicUrl, ac.signal);

    // Close headless browser if it was used
    try {
      const { closeBrowser } = await import("./headlessBroll.js");
      await closeBrowser();
    } catch { /* browser may not have been started */ }

    await updateRun(runId, {
      status: "completed",
      statusDetail: `Revised Day ${dayNumber}! ${savedFiles.length} B-roll files saved. Create avatar video in HeyGen UI.`,
      brollOutputDir: `AVATAR PIPELINE/AI News You Can Use/${folderName}`,
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

// ─── Surgical B-Roll Swap ───────────────────────────────────

export async function swapBroll(runId: number, beatIndex: number, newPrompt?: string): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);

  const script = JSON.parse(run.scriptJson ?? "{}");
  const assets = JSON.parse(run.assetMap ?? "{}");
  const multiAssets = JSON.parse(run.multiAssetMap ?? "{}");
  const beat = script.beats?.[beatIndex];
  if (!beat) throw new Error(`Beat ${beatIndex} not found`);

  await updateRun(runId, { status: "assembling", statusDetail: `Swapping B-roll for beat ${beatIndex + 1}...` });

  try {
    if (newPrompt) {
      beat.visualPrompt = newPrompt;
      script.beats[beatIndex] = beat;
    }

    const { routeAssets } = await import("../videogen-avatar/src/assetRouter.js");
    const { generateAllAssets } = await import("../videogen-avatar/src/assetGenerator.js");

    const miniBeatScript = { ...script, beats: [beat] };
    const manifest = routeAssets(miniBeatScript);
    const newAssets = await generateAllAssets(manifest);

    const newAsset = newAssets[beat.id];
    if (newAsset) {
      assets[beat.id] = newAsset;
      multiAssets[beat.id] = [newAsset];
    }

    // Re-save to folder
    const folderName = sanitizeTopicName(run.topic ?? "untitled");
    const outputDir = join(OUTPUT_BASE, folderName);
    const topicUrl = run.topicSourceUrl ?? undefined;
    const savedFiles = await saveAssetsToFolder(script, assets, outputDir, runId, topicUrl);

    await updateRun(runId, {
      status: "completed",
      statusDetail: `B-roll swapped for beat ${beatIndex + 1}. ${savedFiles.length} files re-saved.`,
      scriptJson: JSON.stringify(script),
      assetMap: JSON.stringify(assets),
      multiAssetMap: JSON.stringify(multiAssets),
      brollImageCount: savedFiles.length,
    });
  } catch (err: any) {
    await updateRun(runId, {
      status: "completed",
      statusDetail: `B-roll swap failed: ${err.message}. Previous files still available.`,
    });
  }
}

// ─── Surgical Narration Edit ────────────────────────────────

export async function editNarration(runId: number, beatIndex: number, newText: string): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);

  const script = JSON.parse(run.scriptJson ?? "{}");
  const beat = script.beats?.[beatIndex];
  if (!beat) throw new Error(`Beat ${beatIndex} not found`);

  // Update narration in script
  beat.narration = newText;
  script.beats[beatIndex] = beat;

  // Re-save script files to folder
  const folderName = sanitizeTopicName(run.topic ?? "untitled");
  const outputDir = join(OUTPUT_BASE, folderName);

  const narrationText = script.beats.map((b: any) => b.narration).join("\n\n");
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "script.txt"), narrationText, "utf-8");
  await writeFile(join(outputDir, "script.json"), JSON.stringify(script, null, 2), "utf-8");

  await updateRun(runId, {
    status: "completed",
    statusDetail: `Narration updated for beat ${beatIndex + 1}. Script files re-saved to folder.`,
    scriptJson: JSON.stringify(script),
  });

  console.log(`[AINYCU Pipeline] Run ${runId}: Narration edited for beat ${beatIndex + 1}`);
}

// ─── Cancel Running Pipeline ────────────────────────────────

export function cancelPipeline(runId: number): boolean {
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
    // Directory may not exist yet
  }
}

/** Download assets from URLs and save as numbered files to local folder */
async function saveAssetsToFolder(
  script: any,
  assets: Record<string, any>,
  outputDir: string,
  runId: number,
  topicUrl?: string,
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
      console.warn(`[AINYCU Pipeline] Beat ${beat.id}: no asset generated, skipping`);
      continue;
    }

    try {
      const response = await fetch(asset.url, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status} downloading ${asset.url}`);
      const buffer = Buffer.from(await response.arrayBuffer());

      // Build descriptive filename from section marker + description
      const markerMatch = beat.narration?.match(/\[(HOOK|DAYTAG|BRIDGE|STEP\d|SOWHAT|SIGNOFF)\]/i);
      const section = markerMatch?.[1]?.toLowerCase() ?? `beat${beat.id}`;
      const desc = (beat.visualPrompt ?? "")
        .replace(/https?:\/\/[^\s]+/g, "")  // strip URLs
        .replace(/[^a-zA-Z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .toLowerCase()
        .slice(0, 40)
        .replace(/-+$/, "");
      const duration = `${Math.round(beat.durationSec)}s`;
      const ext = asset.mediaType === "video" ? "mp4"
        : asset.url.includes(".jpg") || asset.url.includes(".jpeg") ? "jpg" : "png";

      const filename = desc
        ? `${imageNumber}--${section}--${desc}--${duration}.${ext}`
        : `${imageNumber}.${ext}`;

      await writeFile(join(outputDir, filename), buffer);
      savedFiles.push(filename);
      console.log(`[AINYCU Pipeline] Beat ${beat.id} → ${filename} (${asset.source})`);
      imageNumber++;

      await updateRun(runId, {
        statusDetail: `Saved ${savedFiles.length} files... (beat ${beat.id})`,
      });
    } catch (dlErr: any) {
      console.error(`[AINYCU Pipeline] Beat ${beat.id}: download failed: ${dlErr.message}`);
    }
  }

  // Save script files
  const narrationText = script.beats.map((b: any) => b.narration).join("\n\n");
  await writeFile(join(outputDir, "script.txt"), narrationText, "utf-8");
  await writeFile(join(outputDir, "script.json"), JSON.stringify(script, null, 2), "utf-8");

  return savedFiles;
}

