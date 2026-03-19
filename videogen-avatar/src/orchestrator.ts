// ============================================================
// videogen-avatar — Main Pipeline Orchestrator
// Topic in → Final MP4 out
// Runs all 7 stages, handles parallel execution and errors
// ============================================================

import { nanoid } from "nanoid";
import { CONFIG } from "./config.js";
import { generateScript } from "./scriptDirector.js";
import { routeAssets } from "./assetRouter.js";
import { generateAllAssets } from "./assetGenerator.js";
import { generateAvatarVideo } from "./utils/heygenClient.js";
import { assembleVideo, buildSource } from "./assembler.js";
import type {
  PipelineConfig,
  PipelineRun,
  PipelineStatus,
  VideoScript,
  AssetMap,
  AvatarResult,
} from "./types.js";

export async function runPipeline(
  config: PipelineConfig,
  signal?: AbortSignal,
): Promise<PipelineRun> {
  const run: PipelineRun = {
    runId: nanoid(12),
    config,
    status: "scripting",
    startedAt: new Date(),
  };

  console.log(`\n========================================`);
  console.log(`[Pipeline] Run ${run.runId} started`);
  console.log(`[Pipeline] Topic: ${config.topic}`);
  console.log(`[Pipeline] Target: ${config.targetDurationSec}s`);
  console.log(`========================================\n`);

  try {
    // === STAGE 1: Script Director ===
    updateStatus(run, "scripting");
    console.log(`[Pipeline] Stage 1: Generating script...`);
    const script = await generateScript({ topic: config.topic, targetDurationSec: config.targetDurationSec, signal });
    run.script = script;
    console.log(`[Pipeline] Stage 1 complete: ${script.beats.length} beats, ${script.totalDurationSec}s`);

    // === STAGE 2: Asset Router ===
    updateStatus(run, "routing");
    console.log(`[Pipeline] Stage 2: Routing assets...`);
    const manifest = routeAssets(script);
    console.log(`[Pipeline] Stage 2 complete: ${manifest.requests.length} asset requests across ${manifest.parallelGroups.length} groups`);

    // === STAGES 3 & 4: Run in PARALLEL ===
    console.log(`[Pipeline] Stages 3+4: Generating assets AND avatar in parallel...`);

    const [assetsResult, avatarResult] = await Promise.allSettled([
      // Stage 3: Asset Generation
      (async () => {
        updateStatus(run, "generating_assets");
        const assets = await generateAllAssets(manifest, signal);
        run.assets = assets;
        return assets;
      })(),
      // Stage 4: Avatar Generation
      (async () => {
        updateStatus(run, "generating_avatar");
        const fullNarration = script.beats.map(b => b.narration).join(" ");
        const avatar = await generateAvatarVideo({ script: fullNarration }, signal);
        const avatarObj: AvatarResult = {
          videoUrl: avatar.videoUrl,
          durationSec: avatar.durationSec,
          format: "mp4",
          transparent: false,
        };
        run.avatar = avatarObj;
        return avatarObj;
      })(),
    ]);

    // Check results
    const assets = unwrapSettled(assetsResult, "Asset generation");
    const avatar = unwrapSettled(avatarResult, "Avatar generation");

    console.log(`[Pipeline] Stages 3+4 complete`);
    console.log(`[Pipeline]   Assets: ${Object.keys(assets).length} generated`);
    console.log(`[Pipeline]   Avatar: ${avatar.durationSec}s video`);

    // === STAGE 5: Assembly ===
    updateStatus(run, "assembling");
    console.log(`[Pipeline] Stage 5: Assembling video via Creatomate...`);
    const { videoUrl } = await assembleVideo(script, assets, avatar, config, signal);
    run.assemblyUrl = videoUrl;
    console.log(`[Pipeline] Stage 5 complete: ${videoUrl}`);

    // === STAGE 6: Post-Processing ===
    updateStatus(run, "post_processing");
    console.log(`[Pipeline] Stage 6: Post-processing...`);
    // TODO: FFmpeg audio normalization, background music, bumpers
    // For now, Shotstack output is the final
    run.finalUrl = videoUrl;
    console.log(`[Pipeline] Stage 6 complete (passthrough — post-processing not yet implemented)`);

    // === STAGE 7: Delivery ===
    updateStatus(run, "delivering");
    console.log(`[Pipeline] Stage 7: Delivering...`);
    // TODO: storagePut(), webhook, Instagram API
    console.log(`[Pipeline] Stage 7 complete (delivery not yet implemented)`);

    // Done
    updateStatus(run, "completed");
    run.completedAt = new Date();
    const elapsed = (run.completedAt.getTime() - run.startedAt.getTime()) / 1000;

    console.log(`\n========================================`);
    console.log(`[Pipeline] Run ${run.runId} COMPLETED`);
    console.log(`[Pipeline] Final video: ${run.finalUrl}`);
    console.log(`[Pipeline] Elapsed: ${elapsed.toFixed(1)}s`);
    console.log(`========================================\n`);

    return run;

  } catch (err: any) {
    run.status = "failed";
    run.error = err.message;
    run.completedAt = new Date();
    console.error(`\n[Pipeline] Run ${run.runId} FAILED: ${err.message}\n`);
    return run;
  }
}

function updateStatus(run: PipelineRun, status: PipelineStatus) {
  run.status = status;
}

function unwrapSettled<T>(result: PromiseSettledResult<T>, label: string): T {
  if (result.status === "rejected") {
    throw new Error(`${label} failed: ${result.reason}`);
  }
  return result.value;
}

// === CLI entry point ===
if (process.argv[1]?.endsWith("orchestrator.ts") || process.argv[1]?.endsWith("orchestrator.js")) {
  const topic = process.argv[2] ?? "OpenAI just released GPT-5 with real-time video understanding and autonomous task completion";

  runPipeline({
    topic,
    targetDurationSec: CONFIG.defaultTargetDuration,
    avatarPosition: CONFIG.defaultAvatarPosition,
    avatarScale: CONFIG.defaultAvatarScale,
    captionStyle: "bold_highlight",
    includeBackgroundMusic: false,
    autoPost: false,
  }).then(run => {
    if (run.status === "completed") {
      console.log("Pipeline finished successfully!");
    } else {
      console.error(`Pipeline failed: ${run.error}`);
      process.exit(1);
    }
  });
}
