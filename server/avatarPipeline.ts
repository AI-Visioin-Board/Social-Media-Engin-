// ============================================================
// Avatar Reels — Server Pipeline Bridge
// Bridges tRPC router to videogen-avatar/ code with DB persistence
// at each stage and approval gates for topic + video review.
// ============================================================

import { eq } from "drizzle-orm";
import { getDb } from "./db.js";
import { avatarRuns } from "../drizzle/schema.js";
import { runFullResearch, type VerifiedTopic, type VerifiedFact } from "./avatarResearch.js";
import type { ContentBucket } from "../videogen-avatar/src/prompts/quinnPersona.js";

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

// ─── Stage 1: Discovery + Research → pause at topic_review ──

export async function runAvatarPipeline(runId: number): Promise<void> {
  const ac = new AbortController();
  runningPipelines.set(runId, ac);

  try {
    // Update status: topic_discovery
    await updateRun(runId, {
      status: "topic_discovery",
      statusDetail: "Discovering AI news topics from NewsAPI, Reddit, and GPT web search...",
    });

    // Run full research pipeline (discover → score → verify)
    const research = await runFullResearch();

    if (ac.signal.aborted) throw new Error("Pipeline cancelled");

    // Persist candidates
    await updateRun(runId, {
      status: "topic_review",
      statusDetail: `${research.candidates.length} verified topics ready for review`,
      topicCandidates: JSON.stringify(research.candidates),
    });

    // Pipeline pauses here — user picks a topic in the dashboard
    console.log(`[AvatarPipeline] Run ${runId}: ${research.candidates.length} candidates ready for review`);
  } catch (err: any) {
    if (err.message === "Pipeline cancelled") {
      await updateRun(runId, { status: "cancelled", statusDetail: "Cancelled by user" });
    } else {
      await updateRun(runId, { status: "failed", errorMessage: err.message, statusDetail: `Failed: ${err.message}` });
      console.error(`[AvatarPipeline] Run ${runId} failed:`, err);
    }
  } finally {
    runningPipelines.delete(runId);
  }
}

// ─── Stage 2-5: After topic approval → script → assets → avatar → assembly ──

export async function continueAfterTopicApproval(
  runId: number,
  topicIndex: number,
): Promise<void> {
  const ac = new AbortController();
  runningPipelines.set(runId, ac);

  try {
    const run = await getRun(runId);
    if (!run) throw new Error(`Run ${runId} not found`);

    // Parse candidates and select the approved topic
    const candidates: VerifiedTopic[] = JSON.parse(run.topicCandidates ?? "[]");
    const approved = candidates[topicIndex];
    if (!approved) throw new Error(`Invalid topic index: ${topicIndex}`);

    // Persist approved topic + its sources/facts
    await updateRun(runId, {
      status: "scripting",
      statusDetail: `Generating Quinn script for: "${approved.title.slice(0, 60)}..."`,
      topic: approved.title,
      sourceArticles: JSON.stringify(approved.sources),
      extractedFacts: JSON.stringify(approved.facts),
      verificationStatus: approved.verificationStatus,
      viralityScore: Math.round(approved.weightedScore * 10),
    });

    if (ac.signal.aborted) throw new Error("Pipeline cancelled");

    // Stage 2: Generate script from verified facts
    const { generateScript } = await import("../videogen-avatar/src/scriptDirector.js");
    const script = await generateScript({
      topic: approved.title,
      targetDurationSec: 60,
      dayNumber: run.dayNumber ?? undefined,
      contentBucket: (run.contentBucket as ContentBucket) ?? undefined,
      verifiedFacts: approved.facts,
      signal: ac.signal,
    });

    await updateRun(runId, {
      scriptJson: JSON.stringify(script),
      instagramCaption: script.caption,
      statusDetail: `Script ready: ${script.beats.length} beats, ${script.totalDurationSec}s`,
    });

    if (ac.signal.aborted) throw new Error("Pipeline cancelled");

    // Stage 3 + 4: Asset generation and avatar generation in parallel
    await updateRun(runId, {
      status: "generating_assets",
      statusDetail: "Generating B-roll assets and avatar video in parallel...",
    });

    const { routeAssets } = await import("../videogen-avatar/src/assetRouter.js");
    const { generateAllAssets } = await import("../videogen-avatar/src/assetGenerator.js");
    const { generateAvatarVideo } = await import("../videogen-avatar/src/utils/heygenClient.js");
    const { CONFIG } = await import("../videogen-avatar/src/config.js");

    // Route beats to asset sources
    const manifest = routeAssets(script);

    // Build full narration text for HeyGen
    const narrationText = script.beats.map(b => b.narration).join(" ");

    // Run asset gen + avatar gen in parallel
    const [assetsResult, avatarResult] = await Promise.allSettled([
      generateAllAssets(manifest, ac.signal),
      generateAvatarVideo({
        script: narrationText,
        avatarId: CONFIG.heygenAvatarId,
        lookId: run.outfitId || CONFIG.heygenLookId,
        voiceId: CONFIG.heygenVoiceId,
      }, ac.signal),
    ]);

    if (ac.signal.aborted) throw new Error("Pipeline cancelled");

    // Handle asset results
    if (assetsResult.status === "rejected") {
      throw new Error(`Asset generation failed: ${assetsResult.reason?.message ?? assetsResult.reason}`);
    }
    const assets = assetsResult.value;

    // Handle avatar result
    let avatarVideoUrl: string | null = null;
    let avatarDurationSec: number | null = null;
    if (avatarResult.status === "fulfilled") {
      avatarVideoUrl = avatarResult.value.videoUrl;
      avatarDurationSec = avatarResult.value.durationSec;
      await updateRun(runId, { heygenCreditsUsed: (run.heygenCreditsUsed ?? 0) + 1 });
    } else {
      console.warn(`[AvatarPipeline] Avatar generation failed: ${avatarResult.reason?.message}`);
      // Continue without avatar — will show B-roll only
    }

    await updateRun(runId, {
      assetMap: JSON.stringify(assets),
      avatarVideoUrl,
      avatarDurationSec,
      statusDetail: "Assets and avatar ready. Assembling video...",
    });

    // Stage 5: Assembly via Shotstack
    await updateRun(runId, {
      status: "assembling",
      statusDetail: "Building Shotstack edit and rendering final video...",
    });

    const { buildEdit } = await import("../videogen-avatar/src/assembler.js");
    const { renderVideo } = await import("../videogen-avatar/src/utils/shotstackClient.js");

    const avatarInfo = {
      videoUrl: avatarVideoUrl ?? "",
      durationSec: avatarDurationSec ?? script.totalDurationSec,
      format: "mp4" as const,
      transparent: false,
    };

    const pipelineConfig = {
      topic: run.topic ?? "",
      targetDurationSec: 60,
      avatarPosition: "bottomRight" as const,
      avatarScale: 0.3,
      captionStyle: "bold_highlight" as const,
      includeBackgroundMusic: true,
      autoPost: false,
    };

    const edit = buildEdit(script, assets, avatarInfo, pipelineConfig);

    await updateRun(runId, {
      shotstackEditJson: JSON.stringify(edit),
      statusDetail: "Submitting to Shotstack for rendering...",
    });

    const renderResult = await renderVideo(edit, ac.signal);

    await updateRun(runId, {
      status: "video_review",
      statusDetail: "Video rendered! Ready for review.",
      assembledVideoUrl: renderResult.videoUrl,
      finalVideoUrl: renderResult.videoUrl,
    });

    console.log(`[AvatarPipeline] Run ${runId}: Video ready for review at ${renderResult.videoUrl}`);
  } catch (err: any) {
    if (err.message === "Pipeline cancelled") {
      await updateRun(runId, { status: "cancelled", statusDetail: "Cancelled by user" });
    } else {
      await updateRun(runId, { status: "failed", errorMessage: err.message, statusDetail: `Failed: ${err.message}` });
      console.error(`[AvatarPipeline] Run ${runId} failed:`, err);
    }
  } finally {
    runningPipelines.delete(runId);
  }
}

// ─── Post to Instagram ──────────────────────────────────────

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
      // No webhook configured — just mark complete
      await updateRun(runId, {
        status: "completed",
        statusDetail: "Video approved (no Make.com webhook configured for posting)",
      });
      return;
    }

    // Fire Make.com webhook
    const res = await fetch(ENV.makeWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "avatar_reel",
        videoUrl: run.finalVideoUrl,
        caption: caption || run.instagramCaption,
        topic: run.topic,
        dayNumber: run.dayNumber,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({})) as any;
      await updateRun(runId, {
        status: "completed",
        statusDetail: "Posted to Instagram!",
        instagramPostId: data?.postId ?? data?.id ?? "posted",
      });
    } else {
      await updateRun(runId, {
        status: "completed", // Still mark complete — video is done, posting is secondary
        statusDetail: `Video approved. Instagram posting returned ${res.status}.`,
      });
    }
  } catch (err: any) {
    await updateRun(runId, {
      status: "completed", // Video is done even if posting fails
      statusDetail: `Video approved. Posting error: ${err.message}`,
      errorMessage: err.message,
    });
  }
}

// ─── Feedback / Revision ────────────────────────────────────

export async function handleFeedback(runId: number, feedback: string, fromStt: boolean): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);

  // Append to feedback history
  const history = JSON.parse(run.feedbackHistory ?? "[]");
  history.push({ feedback, timestamp: new Date().toISOString(), fromStt });

  await updateRun(runId, {
    status: "revision",
    statusDetail: `Revision ${(run.revisionCount ?? 0) + 1}: Re-generating script with feedback...`,
    feedbackHistory: JSON.stringify(history),
    revisionCount: (run.revisionCount ?? 0) + 1,
  });

  // Re-run from scripting with the feedback context
  const facts: VerifiedFact[] = JSON.parse(run.extractedFacts ?? "[]");

  // Re-run the production pipeline from script generation
  await continueAfterTopicApprovalWithFacts(runId, run.topic ?? "", facts, feedback);
}

async function continueAfterTopicApprovalWithFacts(
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
        ? `Re-generating script with feedback: "${feedback.slice(0, 60)}..."`
        : `Generating Quinn script...`,
    });

    const { generateScript } = await import("../videogen-avatar/src/scriptDirector.js");
    const script = await generateScript({
      topic,
      targetDurationSec: 60,
      dayNumber: run.dayNumber ?? undefined,
      contentBucket: (run.contentBucket as ContentBucket) ?? undefined,
      verifiedFacts: facts,
      feedback,
      signal: ac.signal,
    });

    await updateRun(runId, {
      scriptJson: JSON.stringify(script),
      instagramCaption: script.caption,
      status: "generating_assets",
      statusDetail: "Generating B-roll assets and avatar video in parallel...",
    });

    if (ac.signal.aborted) throw new Error("Pipeline cancelled");

    const { routeAssets } = await import("../videogen-avatar/src/assetRouter.js");
    const { generateAllAssets } = await import("../videogen-avatar/src/assetGenerator.js");
    const { generateAvatarVideo } = await import("../videogen-avatar/src/utils/heygenClient.js");
    const { CONFIG } = await import("../videogen-avatar/src/config.js");

    const manifest = routeAssets(script);
    const narrationText = script.beats.map(b => b.narration).join(" ");

    const [assetsResult, avatarResult] = await Promise.allSettled([
      generateAllAssets(manifest, ac.signal),
      generateAvatarVideo({
        script: narrationText,
        avatarId: CONFIG.heygenAvatarId,
        lookId: run.outfitId || CONFIG.heygenLookId,
        voiceId: CONFIG.heygenVoiceId,
      }, ac.signal),
    ]);

    if (ac.signal.aborted) throw new Error("Pipeline cancelled");

    if (assetsResult.status === "rejected") {
      throw new Error(`Asset generation failed: ${assetsResult.reason?.message}`);
    }

    let avatarVideoUrl = run.avatarVideoUrl;
    let avatarDurationSec = run.avatarDurationSec;
    if (avatarResult.status === "fulfilled") {
      avatarVideoUrl = avatarResult.value.videoUrl;
      avatarDurationSec = avatarResult.value.durationSec;
      await updateRun(runId, { heygenCreditsUsed: (run.heygenCreditsUsed ?? 0) + 1 });
    }

    await updateRun(runId, {
      assetMap: JSON.stringify(assetsResult.value),
      avatarVideoUrl,
      avatarDurationSec,
      status: "assembling",
      statusDetail: "Assembling video...",
    });

    const { buildEdit } = await import("../videogen-avatar/src/assembler.js");
    const { renderVideo } = await import("../videogen-avatar/src/utils/shotstackClient.js");

    const avatarInfo = {
      videoUrl: avatarVideoUrl ?? "",
      durationSec: avatarDurationSec ?? script.totalDurationSec,
      format: "mp4" as const,
      transparent: false,
    };

    const pipelineConfig = {
      topic: run.topic ?? topic,
      targetDurationSec: 60,
      avatarPosition: "bottomRight" as const,
      avatarScale: 0.3,
      captionStyle: "bold_highlight" as const,
      includeBackgroundMusic: true,
      autoPost: false,
    };

    const edit = buildEdit(script, assetsResult.value, avatarInfo, pipelineConfig);

    await updateRun(runId, { shotstackEditJson: JSON.stringify(edit) });

    const renderResult = await renderVideo(edit, ac.signal);

    await updateRun(runId, {
      status: "video_review",
      statusDetail: "Revised video ready for review!",
      assembledVideoUrl: renderResult.videoUrl,
      finalVideoUrl: renderResult.videoUrl,
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
  const beat = script.beats?.[beatIndex];

  if (!beat) throw new Error(`Beat ${beatIndex} not found in script`);

  await updateRun(runId, {
    status: "assembling",
    statusDetail: `Swapping B-roll for beat ${beatIndex + 1}...`,
  });

  try {
    // Update the visual prompt if provided
    if (newPrompt) {
      beat.visualPrompt = newPrompt;
      script.beats[beatIndex] = beat;
    }

    // Re-generate just this beat's asset
    const { routeAssets } = await import("../videogen-avatar/src/assetRouter.js");
    const { generateAllAssets } = await import("../videogen-avatar/src/assetGenerator.js");

    // Create a mini-script with just this one beat for asset generation
    const miniBeatScript = { ...script, beats: [beat] };
    const manifest = routeAssets(miniBeatScript);
    const newAssets = await generateAllAssets(manifest);

    // Patch the asset map
    const newAsset = newAssets[beat.id];
    if (newAsset) {
      assets[beat.id] = newAsset;
    }

    // Rebuild and re-render
    const { buildEdit } = await import("../videogen-avatar/src/assembler.js");
    const { renderVideo } = await import("../videogen-avatar/src/utils/shotstackClient.js");

    const avatarInfo = {
      videoUrl: run.avatarVideoUrl ?? "",
      durationSec: run.avatarDurationSec ?? script.totalDurationSec,
      format: "mp4" as const,
      transparent: false,
    };

    const pipelineConfig = {
      topic: run.topic ?? "",
      targetDurationSec: 60,
      avatarPosition: "bottomRight" as const,
      avatarScale: 0.3,
      captionStyle: "bold_highlight" as const,
      includeBackgroundMusic: true,
      autoPost: false,
    };

    const edit = buildEdit(script, assets, avatarInfo, pipelineConfig);
    const renderResult = await renderVideo(edit);

    await updateRun(runId, {
      status: "video_review",
      statusDetail: `B-roll swapped for beat ${beatIndex + 1}. Video re-rendered!`,
      scriptJson: JSON.stringify(script),
      assetMap: JSON.stringify(assets),
      shotstackEditJson: JSON.stringify(edit),
      assembledVideoUrl: renderResult.videoUrl,
      finalVideoUrl: renderResult.videoUrl,
    });
  } catch (err: any) {
    await updateRun(runId, {
      status: "video_review", // Stay in review even if swap fails
      statusDetail: `B-roll swap failed: ${err.message}. Previous video still available.`,
    });
  }
}

// ─── Surgical Narration Edit ────────────────────────────────

export async function editNarration(runId: number, beatIndex: number, newText: string): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);

  const script = JSON.parse(run.scriptJson ?? "{}");
  const assets = JSON.parse(run.assetMap ?? "{}");
  const beat = script.beats?.[beatIndex];

  if (!beat) throw new Error(`Beat ${beatIndex} not found in script`);

  await updateRun(runId, {
    status: "generating_avatar",
    statusDetail: `Updating narration for beat ${beatIndex + 1} and re-generating avatar video...`,
  });

  try {
    // Update the narration text
    beat.narration = newText;
    script.beats[beatIndex] = beat;

    // Re-generate full avatar video (HeyGen takes complete script)
    const { generateAvatarVideo } = await import("../videogen-avatar/src/utils/heygenClient.js");
    const { CONFIG } = await import("../videogen-avatar/src/config.js");

    const narrationText = script.beats.map((b: any) => b.narration).join(" ");
    const avatarResult = await generateAvatarVideo({
      script: narrationText,
      avatarId: CONFIG.heygenAvatarId,
      lookId: run.outfitId || CONFIG.heygenLookId,
      voiceId: CONFIG.heygenVoiceId,
    });

    await updateRun(runId, {
      avatarVideoUrl: avatarResult.videoUrl,
      avatarDurationSec: avatarResult.durationSec,
      heygenCreditsUsed: (run.heygenCreditsUsed ?? 0) + 1,
      status: "assembling",
      statusDetail: "Re-assembling video with new narration...",
    });

    // Re-assemble
    const { buildEdit } = await import("../videogen-avatar/src/assembler.js");
    const { renderVideo } = await import("../videogen-avatar/src/utils/shotstackClient.js");

    const pipelineConfig = {
      topic: run.topic ?? "",
      targetDurationSec: 60,
      avatarPosition: "bottomRight" as const,
      avatarScale: 0.3,
      captionStyle: "bold_highlight" as const,
      includeBackgroundMusic: true,
      autoPost: false,
    };

    const edit = buildEdit(script, assets, {
      videoUrl: avatarResult.videoUrl,
      durationSec: avatarResult.durationSec,
      format: "mp4",
      transparent: false,
    }, pipelineConfig);

    const renderResult = await renderVideo(edit);

    await updateRun(runId, {
      status: "video_review",
      statusDetail: `Narration updated for beat ${beatIndex + 1}. Video re-rendered!`,
      scriptJson: JSON.stringify(script),
      shotstackEditJson: JSON.stringify(edit),
      assembledVideoUrl: renderResult.videoUrl,
      finalVideoUrl: renderResult.videoUrl,
    });
  } catch (err: any) {
    await updateRun(runId, {
      status: "video_review",
      statusDetail: `Narration edit failed: ${err.message}. Previous video still available.`,
    });
  }
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
