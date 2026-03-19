// ============================================================
// videogen-avatar — Stage 3: Asset Generator
// Takes an AssetManifest → generates all assets in parallel
// Handles fallback chains when sources fail
//
// NEW: Generates MULTIPLE stock clips per beat for rapid-fire
// sub-clipping (1.5-2.5s visual cuts instead of one static clip)
// ============================================================

import type {
  AssetManifest,
  AssetRequest,
  AssetMap,
  MultiAssetMap,
  GeneratedAsset,
  AssetSource,
  ParallelGroup,
} from "./types.js";
import { getIndependentRequests, getDependentRequests } from "./assetRouter.js";
import { generateImage } from "./utils/nanoBananaClient.js";
import { generateTextToVideo, generateImageToVideo } from "./utils/klingClient.js";
import { searchStockVideo, searchStockVideoBatch, resetUsedVideos } from "./utils/pexelsClient.js";
import { retry } from "./utils/retry.js";

// How many stock clips to fetch per beat for rapid-fire sub-clipping
const PEXELS_CLIPS_PER_BEAT = 3;

// Upload base64 image to server storage so Creatomate can access it via public URL
async function uploadToStorage(base64: string, mimeType: string, beatId: number): Promise<string> {
  const { storagePut } = await import("../../../server/storage.js");
  const ext = mimeType.includes("png") ? "png" : "jpg";
  const key = `avatar-broll/beat-${beatId}-${Date.now()}.${ext}`;
  const buffer = Buffer.from(base64, "base64");
  const { url: localPath } = await storagePut(key, buffer, mimeType);

  // Convert relative /uploads/... path to full public URL for Creatomate
  const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : process.env.BASE_URL || "https://social-media-engin-production.up.railway.app";
  return `${baseUrl}${localPath}`;
}

export async function generateAllAssets(
  manifest: AssetManifest,
  signal?: AbortSignal,
): Promise<AssetMap> {
  const assets: AssetMap = {};

  // Reset Pexels deduplication for this video generation
  resetUsedVideos();

  // Phase 1: Generate all independent assets in parallel (grouped by source)
  console.log(`[AssetGen] Generating ${manifest.requests.length} assets across ${manifest.parallelGroups.length} source groups...`);

  const independentResults = await Promise.allSettled(
    manifest.parallelGroups.map(group =>
      processGroup(group, manifest.requests, assets, signal)
    ),
  );

  for (const result of independentResults) {
    if (result.status === "rejected") {
      console.error(`[AssetGen] Group failed: ${result.reason}`);
    }
  }

  // Phase 2: Process dependent requests (I2V that need source images)
  const dependents = getDependentRequests(manifest);
  if (dependents.length > 0) {
    console.log(`[AssetGen] Processing ${dependents.length} dependent requests (I2V)...`);
    for (const req of dependents) {
      const sourceAsset = assets[req.dependsOn!];
      if (!sourceAsset) {
        console.warn(`[AssetGen] Beat ${req.beatId}: dependency (beat ${req.dependsOn}) not available, skipping I2V`);
        continue;
      }
      try {
        const asset = await generateSingleAsset(req, signal, sourceAsset.url);
        assets[req.beatId] = asset;  // I2V result replaces the still
      } catch (err: any) {
        console.warn(`[AssetGen] Beat ${req.beatId}: I2V failed (${err.message}), keeping still image`);
        // The still image from Phase 1 remains in assets[req.beatId]
      }
    }
  }

  const successCount = Object.keys(assets).length;
  const totalBeats = new Set(manifest.requests.map(r => r.beatId)).size;
  console.log(`[AssetGen] Completed: ${successCount}/${totalBeats} beats have assets`);

  return assets;
}

/**
 * Generate multiple assets per beat for rapid-fire sub-clipping.
 * For Pexels beats, fetches multiple clips instead of just one.
 * Returns MultiAssetMap where each beat can have 1-4 assets.
 */
export async function generateAllAssetsMulti(
  manifest: AssetManifest,
  signal?: AbortSignal,
): Promise<{ primary: AssetMap; multi: MultiAssetMap }> {
  // Reset Pexels deduplication for this video generation
  resetUsedVideos();

  const primary: AssetMap = {};
  const multi: MultiAssetMap = {};

  console.log(`[AssetGen] Generating ${manifest.requests.length} assets (multi-clip mode)...`);

  // Phase 1: Generate independent assets
  const independentResults = await Promise.allSettled(
    manifest.parallelGroups.map(group =>
      processGroupMulti(group, manifest.requests, primary, multi, signal)
    ),
  );

  for (const result of independentResults) {
    if (result.status === "rejected") {
      console.error(`[AssetGen] Group failed: ${result.reason}`);
    }
  }

  // Phase 2: Dependent requests (I2V)
  const dependents = getDependentRequests(manifest);
  for (const req of dependents) {
    const sourceAsset = primary[req.dependsOn!];
    if (!sourceAsset) continue;
    try {
      const asset = await generateSingleAsset(req, signal, sourceAsset.url);
      primary[req.beatId] = asset;
      multi[req.beatId] = [asset];
    } catch (err: any) {
      console.warn(`[AssetGen] Beat ${req.beatId}: I2V failed, keeping still`);
    }
  }

  const successCount = Object.keys(primary).length;
  const multiCount = Object.values(multi).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`[AssetGen] Completed: ${successCount} beats with ${multiCount} total clips`);

  return { primary, multi };
}

async function processGroup(
  group: ParallelGroup,
  allRequests: AssetRequest[],
  assets: AssetMap,
  signal?: AbortSignal,
): Promise<void> {
  const requests = allRequests.filter(
    r => group.beatIds.includes(r.beatId) && r.dependsOn === undefined && r.source === group.source,
  );

  const chunks = chunkArray(requests, group.maxConcurrent);

  for (const chunk of chunks) {
    const results = await Promise.allSettled(
      chunk.map(async (req) => {
        const asset = await generateWithFallback(req, signal);
        if (asset) assets[req.beatId] = asset;
      }),
    );

    for (const r of results) {
      if (r.status === "rejected") {
        console.error(`[AssetGen] Asset failed: ${r.reason}`);
      }
    }
  }
}

async function processGroupMulti(
  group: ParallelGroup,
  allRequests: AssetRequest[],
  primary: AssetMap,
  multi: MultiAssetMap,
  signal?: AbortSignal,
): Promise<void> {
  const requests = allRequests.filter(
    r => group.beatIds.includes(r.beatId) && r.dependsOn === undefined && r.source === group.source,
  );

  const chunks = chunkArray(requests, group.maxConcurrent);

  for (const chunk of chunks) {
    const results = await Promise.allSettled(
      chunk.map(async (req) => {
        // For Pexels, fetch multiple clips
        if (req.source === "pexels") {
          const clips = await searchStockVideoBatch(req.prompt, PEXELS_CLIPS_PER_BEAT, signal);
          if (clips.length > 0) {
            const assets: GeneratedAsset[] = clips.map((clip, i) => ({
              beatId: req.beatId,
              source: "pexels" as const,
              mediaType: "video" as const,
              url: clip.url,
              durationSec: clip.duration,
              width: clip.width,
              height: clip.height,
              fallbackUsed: false,
            }));
            primary[req.beatId] = assets[0];
            multi[req.beatId] = assets;
          } else {
            // Fallback to single generation
            const asset = await generateWithFallback(req, signal);
            if (asset) {
              primary[req.beatId] = asset;
              multi[req.beatId] = [asset];
            }
          }
        } else {
          const asset = await generateWithFallback(req, signal);
          if (asset) {
            primary[req.beatId] = asset;
            multi[req.beatId] = [asset];
          }
        }
      }),
    );

    for (const r of results) {
      if (r.status === "rejected") {
        console.error(`[AssetGen] Asset failed: ${r.reason}`);
      }
    }
  }
}

async function generateWithFallback(
  req: AssetRequest,
  signal?: AbortSignal,
): Promise<GeneratedAsset | null> {
  // Try primary source
  try {
    return await retry(
      () => generateSingleAsset(req, signal),
      `${req.source}:beat${req.beatId}`,
      2,
      signal,
    );
  } catch (primaryErr: any) {
    console.warn(`[AssetGen] Beat ${req.beatId}: primary ${req.source} failed: ${primaryErr.message}`);
  }

  // Try fallback chain
  for (const fallbackSource of req.fallbackChain) {
    try {
      console.log(`[AssetGen] Beat ${req.beatId}: trying fallback ${fallbackSource}...`);
      const fallbackReq = { ...req, source: fallbackSource };
      const asset = await generateSingleAsset(fallbackReq, signal);
      return { ...asset, fallbackUsed: true, fallbackSource };
    } catch (fallbackErr: any) {
      console.warn(`[AssetGen] Beat ${req.beatId}: fallback ${fallbackSource} also failed: ${fallbackErr.message}`);
    }
  }

  console.error(`[AssetGen] Beat ${req.beatId}: ALL sources exhausted, no asset generated`);
  return null;
}

async function generateSingleAsset(
  req: AssetRequest,
  signal?: AbortSignal,
  sourceImageUrl?: string,
): Promise<GeneratedAsset> {
  switch (req.source) {
    case "nano_banana": {
      const result = await generateImage(req.prompt, signal);
      const publicUrl = await uploadToStorage(result.imageBase64, result.mimeType, req.beatId);
      return {
        beatId: req.beatId,
        source: "nano_banana",
        mediaType: "image",
        url: publicUrl,
        width: result.width,
        height: result.height,
        fallbackUsed: false,
      };
    }

    case "kling_t2v": {
      const result = await generateTextToVideo(req.prompt, signal);
      return {
        beatId: req.beatId,
        source: "kling_t2v",
        mediaType: "video",
        url: result.videoUrl,
        durationSec: result.durationSec,
        width: 1080,
        height: 1920,
        fallbackUsed: false,
      };
    }

    case "kling_i2v": {
      if (!sourceImageUrl) throw new Error("I2V requires a source image URL");
      const result = await generateImageToVideo(sourceImageUrl, req.prompt, signal);
      return {
        beatId: req.beatId,
        source: "kling_i2v",
        mediaType: "video",
        url: result.videoUrl,
        durationSec: result.durationSec,
        width: 1080,
        height: 1920,
        fallbackUsed: false,
      };
    }

    case "pexels": {
      const result = await searchStockVideo(req.prompt, signal);
      if (!result) throw new Error("No stock footage found");
      return {
        beatId: req.beatId,
        source: "pexels",
        mediaType: "video",
        url: result.url,
        durationSec: result.duration,
        width: result.width,
        height: result.height,
        fallbackUsed: false,
      };
    }

    case "puppeteer_graphic": {
      throw new Error("Puppeteer graphic rendering not yet implemented");
    }
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
