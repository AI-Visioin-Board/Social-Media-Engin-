// ============================================================
// videogen-avatar — Stage 3: Asset Generator
// Takes an AssetManifest → generates all assets in parallel
// Handles fallback chains when sources fail
//
// FLOW: Nano Banana still → Veo 3.1 animation → 5s video clip
// Veo failure gracefully degrades to still image (Ken Burns in assembler)
//
// Pexels stock beats fetch MULTIPLE clips per beat for rapid-fire
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
import { getDependentRequests, decodeShotId } from "./assetRouter.js";
import { generateImage } from "./utils/nanoBananaClient.js";
import { animateImage } from "./utils/veoClient.js";
import { searchStockVideo, searchStockVideoBatch, resetUsedVideos } from "./utils/pexelsClient.js";
// Note: klingClient.ts import removed — Kling no longer used in routing
import { retry } from "./utils/retry.js";

// How many stock clips to fetch per beat for rapid-fire sub-clipping
const PEXELS_CLIPS_PER_BEAT = 3;

// Upload base64 image to server storage so Creatomate can access it via public URL
async function uploadToStorage(base64: string, mimeType: string, beatId: number): Promise<string> {
  const { storagePut } = await import("../../server/storage.js");
  const ext = mimeType.includes("png") ? "png" : "jpg";
  const key = `avatar-broll/beat-${beatId}-${Date.now()}.${ext}`;
  const buffer = Buffer.from(base64, "base64");
  const { url: localPath } = await storagePut(key, buffer, mimeType);

  return toPublicUrl(localPath);
}

// Upload a raw Buffer (video/image) to server storage
async function uploadBufferToStorage(buf: Buffer, mimeType: string, beatId: number, ext: string): Promise<string> {
  const { storagePut } = await import("../../server/storage.js");
  const key = `avatar-broll/beat-${beatId}-${Date.now()}.${ext}`;
  const { url: localPath } = await storagePut(key, buf, mimeType);

  return toPublicUrl(localPath);
}

function toPublicUrl(localPath: string): string {
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
  options?: { imagesOnly?: boolean },
): Promise<{ primary: AssetMap; multi: MultiAssetMap }> {
  // Reset Pexels deduplication for this video generation
  resetUsedVideos();

  const primary: AssetMap = {};
  const multi: MultiAssetMap = {};

  console.log(`[AssetGen] Generating ${manifest.requests.length} assets (multi-clip mode)...`);

  const imagesOnly = options?.imagesOnly ?? false;
  if (imagesOnly) {
    console.log(`[AssetGen] Images-only mode — skipping Veo animation, using Pexels photos instead of videos`);
  }

  // Phase 1: Generate independent assets
  const independentResults = await Promise.allSettled(
    manifest.parallelGroups.map(group =>
      processGroupMulti(group, manifest.requests, primary, multi, signal, imagesOnly)
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

  // V9 — collapse per-shot encoded beatIds (beatId*1000+shotIndex) back into the
  // parent beat's MultiAssetMap entry so the assembler sees one list per beat.
  // Leaves the primary map keyed at the encoded shotId for debugging (Railway logs),
  // but also publishes the decoded primary/multi at the parent beatId.
  regroupShotAssets(primary, multi);

  const successCount = Object.keys(primary).length;
  const multiCount = Object.values(multi).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`[AssetGen] Completed: ${successCount} beats with ${multiCount} total clips`);

  return { primary, multi };
}

/**
 * V9 — the asset router emits one AssetRequest per sub-shot, each with a unique
 * encoded beatId (shotId = beatId*1000 + shotIndex). The assembler expects assets
 * grouped by ORIGINAL beatId, so we collapse shotIds back under their parent here.
 *
 * After this pass: for a beat that had 3 sub-shots,
 *   - multi[beatId] = [asset0, asset1, asset2] (ordered by shotIndex)
 *   - primary[beatId] = multi[beatId][0] (first shot is primary)
 *   - multi[shotId] entries remain for debugging but aren't the contract
 */
function regroupShotAssets(primary: AssetMap, multi: MultiAssetMap): void {
  // Collect all encoded shotIds (values ≥ 1000 are encoded per-shot IDs)
  const shotIds = Object.keys(primary).map(Number).filter(n => n >= 1000);
  if (shotIds.length === 0) return;

  // Group by parent beatId
  const groups = new Map<number, Array<{ shotIndex: number; asset: GeneratedAsset }>>();
  // Include any existing single-shot assets (shot 0 is stored under the plain beatId)
  for (const idStr of Object.keys(primary)) {
    const shotId = Number(idStr);
    const { beatId, shotIndex } = decodeShotId(shotId);
    if (shotIndex === 0 && shotId < 1000) {
      // Non-encoded beat (e.g. legacy single-asset beat) — still surface under its own beatId
      // but also include it as shotIndex 0 of that parent's group so multi[beatId][0] is consistent.
      const arr = groups.get(beatId) ?? [];
      arr.push({ shotIndex: 0, asset: primary[shotId] });
      groups.set(beatId, arr);
    } else if (shotId >= 1000) {
      const arr = groups.get(beatId) ?? [];
      arr.push({ shotIndex, asset: primary[shotId] });
      groups.set(beatId, arr);
    }
  }

  // Publish decoded groups back under parent beatId
  groups.forEach((entries, beatId) => {
    entries.sort((a: { shotIndex: number }, b: { shotIndex: number }) => a.shotIndex - b.shotIndex);
    const assets = entries.map((e: { asset: GeneratedAsset }) => ({ ...e.asset, beatId }));
    if (assets.length > 0) {
      multi[beatId] = assets;
      primary[beatId] = assets[0];
    }
  });
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
  imagesOnly?: boolean,
): Promise<void> {
  const requests = allRequests.filter(
    r => group.beatIds.includes(r.beatId) && r.dependsOn === undefined && r.source === group.source,
  );

  const chunks = chunkArray(requests, group.maxConcurrent);

  for (const chunk of chunks) {
    const results = await Promise.allSettled(
      chunk.map(async (req) => {
        // For Pexels — fetch photos if imagesOnly, otherwise video clips
        if (req.source === "pexels") {
          if (imagesOnly) {
            // Images-only mode: use Pexels Photos API instead of Videos
            const { searchStockPhoto } = await import("./utils/pexelsClient.js");
            const photo = await searchStockPhoto(req.prompt, signal);
            if (photo) {
              const asset: GeneratedAsset = {
                beatId: req.beatId,
                source: "pexels" as const,
                mediaType: "image" as const,
                url: photo.url,
                width: photo.width,
                height: photo.height,
                fallbackUsed: false,
              };
              primary[req.beatId] = asset;
              multi[req.beatId] = [asset];
            } else {
              const asset = await generateWithFallback(req, signal, undefined, imagesOnly);
              if (asset) {
                primary[req.beatId] = asset;
                multi[req.beatId] = [asset];
              }
            }
          } else {
            const clips = await searchStockVideoBatch(req.prompt, PEXELS_CLIPS_PER_BEAT, signal);
            if (clips.length > 0) {
              const assets: GeneratedAsset[] = clips.map((clip) => ({
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
              const asset = await generateWithFallback(req, signal);
              if (asset) {
                primary[req.beatId] = asset;
                multi[req.beatId] = [asset];
              }
            }
          }
        } else {
          const asset = await generateWithFallback(req, signal, undefined, imagesOnly);
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
  _sourceImageUrl?: string,
  imagesOnly?: boolean,
): Promise<GeneratedAsset | null> {
  // Try primary source
  try {
    return await retry(
      () => generateSingleAsset(req, signal, undefined, imagesOnly),
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
      const asset = await generateSingleAsset(fallbackReq, signal, undefined, imagesOnly);
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
  imagesOnly?: boolean,
): Promise<GeneratedAsset> {
  switch (req.source) {
    case "nano_banana": {
      // Step 1: Generate sharp still image via Nano Banana
      const result = await generateImage(req.prompt, signal, req.aspectRatio);
      const imagePublicUrl = await uploadToStorage(result.imageBase64, result.mimeType, req.beatId);

      // Images-only mode: skip Veo animation, return still image directly
      if (imagesOnly) {
        console.log(`[AssetGen] Beat ${req.beatId}: Nano Banana still (images-only mode)`);
        return {
          beatId: req.beatId,
          source: "nano_banana",
          mediaType: "image",
          url: imagePublicUrl,
          width: result.width,
          height: result.height,
          fallbackUsed: false,
        };
      }

      // Dimensions depend on aspect ratio
      const videoWidth = 1080;
      const videoHeight = req.aspectRatio === "1:1" ? 1080 : 1920;

      // Step 2: Animate the still with Veo 3.1 (image-to-video)
      // V9 Law 0.4 — use the full cinematographer-grade prompt as-is. The previous
      // "Subtle cinematic motion" wrapper diluted quality by overriding the shot's
      // camera-move spec. Veo gets the real brief now.
      try {
        const motionPrompt = req.prompt;
        const veoResult = await animateImage(result.imageBase64, result.mimeType, motionPrompt, signal, req.aspectRatio);
        const videoPublicUrl = await uploadBufferToStorage(veoResult.videoBuffer, veoResult.mimeType, req.beatId, "mp4");
        console.log(`[AssetGen] Beat ${req.beatId}: Nano Banana → Veo animation SUCCESS (${req.aspectRatio})`);
        return {
          beatId: req.beatId,
          source: "nano_banana",
          mediaType: "video",
          url: videoPublicUrl,
          durationSec: veoResult.durationSec,
          width: videoWidth,
          height: videoHeight,
          fallbackUsed: false,
        };
      } catch (veoErr: any) {
        console.warn(`[AssetGen] Beat ${req.beatId}: Veo animation failed (${veoErr.message}), using still image with Ken Burns`);
        return {
          beatId: req.beatId,
          source: "nano_banana",
          mediaType: "image",
          url: imagePublicUrl,
          width: result.width,
          height: result.height,
          fallbackUsed: false,
        };
      }
    }

    // Kling cases kept for type safety but never routed to (removed from assetRouter)
    case "kling_t2v":
    case "kling_i2v": {
      throw new Error("Kling video generation removed — use Nano Banana + Veo instead");
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

    case "headless_capture": {
      // Real website screenshot via Puppeteer headless browser
      const { extractUrlFromPrompt, captureScreenshot } = await import("../../server/headlessBroll.js");
      const url = extractUrlFromPrompt(req.prompt);
      if (!url) {
        throw new Error(`No URL found in visualPrompt for headless capture: "${req.prompt.slice(0, 80)}..."`);
      }

      const layout: "pip" | "fullscreen_broll" = req.aspectRatio === "1:1" ? "pip" : "fullscreen_broll";
      const capture = await captureScreenshot(url, req.beatId, layout, req.prompt, signal);

      // Upload screenshot to server storage for public URL access
      const publicUrl = await uploadBufferToStorage(capture.buffer, "image/png", req.beatId, "png");
      console.log(`[AssetGen] Beat ${req.beatId}: Headless capture SUCCESS from ${url} (${capture.width}x${capture.height})`);

      return {
        beatId: req.beatId,
        source: "headless_capture",
        mediaType: "image",
        url: publicUrl,
        width: capture.width,
        height: capture.height,
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
