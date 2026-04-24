// ============================================================
// videogen-avatar — Stage 3: Asset Generator
// Takes an AssetManifest → generates all assets in parallel
// Handles fallback chains when sources fail
//
// v9 — PER-SHOT ASSETS:
// When a Beat has shots[], the router emits one AssetRequest per shot with
// shotIdx set. This generator stores each shot's asset separately and then
// reassembles them in order into MultiAssetMap[beatId] so downstream tools
// (Remotion) can lay them out as hard-cut sub-clips.
//
// FLOW: Nano Banana still → Veo 3.1 animation → 5s video clip
// Veo failure gracefully degrades to still image (Ken Burns in assembler)
//
// Pexels beats without shots[] still fetch MULTIPLE clips for rapid-fire
// sub-clipping. Pexels shots (with shotIdx) fetch a single clip each.
// ============================================================

import type {
  AssetManifest,
  AssetRequest,
  AssetMap,
  MultiAssetMap,
  GeneratedAsset,
  ParallelGroup,
} from "./types.js";
import { getDependentRequests } from "./assetRouter.js";
import { generateImage } from "./utils/nanoBananaClient.js";
import { animateImage } from "./utils/veoClient.js";
import { searchStockVideo, searchStockVideoBatch, resetUsedVideos } from "./utils/pexelsClient.js";
// Note: klingClient.ts import removed — Kling no longer used in routing
import { retry } from "./utils/retry.js";

// How many stock clips to fetch per beat for rapid-fire sub-clipping
// (only applied for beat-level Pexels requests with no shotIdx)
const PEXELS_CLIPS_PER_BEAT = 3;

// Key for per-shot asset dedup / lookup
function reqKey(req: Pick<AssetRequest, "beatId" | "shotIdx">): string {
  return req.shotIdx !== undefined ? `${req.beatId}:${req.shotIdx}` : `${req.beatId}`;
}

// Upload base64 image to server storage so Creatomate can access it via public URL
async function uploadToStorage(
  base64: string,
  mimeType: string,
  beatId: number,
  shotIdx?: number,
): Promise<string> {
  const { storagePut } = await import("../../server/storage.js");
  const ext = mimeType.includes("png") ? "png" : "jpg";
  const shotTag = shotIdx !== undefined ? `-s${shotIdx}` : "";
  const key = `avatar-broll/beat-${beatId}${shotTag}-${Date.now()}.${ext}`;
  const buffer = Buffer.from(base64, "base64");
  const { url: localPath } = await storagePut(key, buffer, mimeType);

  return toPublicUrl(localPath);
}

// Upload a raw Buffer (video/image) to server storage
async function uploadBufferToStorage(
  buf: Buffer,
  mimeType: string,
  beatId: number,
  ext: string,
  shotIdx?: number,
): Promise<string> {
  const { storagePut } = await import("../../server/storage.js");
  const shotTag = shotIdx !== undefined ? `-s${shotIdx}` : "";
  const key = `avatar-broll/beat-${beatId}${shotTag}-${Date.now()}.${ext}`;
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
  const { primary } = await generateAllAssetsMulti(manifest, signal);
  return primary;
}

/**
 * Generate all assets (beat-level AND per-shot) and return both:
 *   primary[beatId]    — the first/cover asset for each beat
 *   multi[beatId][idx] — ordered array of per-shot assets (length ≥ 1)
 */
export async function generateAllAssetsMulti(
  manifest: AssetManifest,
  signal?: AbortSignal,
  options?: { imagesOnly?: boolean },
): Promise<{ primary: AssetMap; multi: MultiAssetMap }> {
  // Reset Pexels deduplication for this video generation
  resetUsedVideos();

  const imagesOnly = options?.imagesOnly ?? false;
  if (imagesOnly) {
    console.log(`[AssetGen] Images-only mode — skipping Veo animation, using Pexels photos instead of videos`);
  }

  // Shared map of all results keyed by "beatId" or "beatId:shotIdx".
  // Multiple groups write here concurrently; keys never collide because each
  // AssetRequest has a unique (beatId, shotIdx) pair.
  const shotResults = new Map<string, GeneratedAsset[]>();

  console.log(`[AssetGen] Generating ${manifest.requests.length} assets (multi-clip mode)...`);

  // Phase 1: Generate independent assets per source group
  const independentResults = await Promise.allSettled(
    manifest.parallelGroups.map(group =>
      processGroupMulti(group, manifest.requests, shotResults, signal, imagesOnly),
    ),
  );

  for (const result of independentResults) {
    if (result.status === "rejected") {
      console.error(`[AssetGen] Group failed: ${result.reason}`);
    }
  }

  // Phase 2: Dependent requests (I2V that need source images)
  const dependents = getDependentRequests(manifest);
  for (const req of dependents) {
    const depKey = req.dependsOn !== undefined ? `${req.dependsOn}` : undefined;
    const depArr = depKey ? shotResults.get(depKey) : undefined;
    const sourceAsset = depArr?.[0];
    if (!sourceAsset) continue;
    try {
      const asset = await generateSingleAsset(req, signal, sourceAsset.url);
      shotResults.set(reqKey(req), [asset]);
    } catch (err: any) {
      console.warn(`[AssetGen] Beat ${req.beatId}: I2V failed (${err.message}), keeping still`);
    }
  }

  // Phase 3: Reassemble primary + multi in request/shot order
  const primary: AssetMap = {};
  const multi: MultiAssetMap = {};

  for (const req of manifest.requests) {
    const arr = shotResults.get(reqKey(req));
    if (!arr || arr.length === 0) continue;
    const list = multi[req.beatId] ?? (multi[req.beatId] = []);
    for (const a of arr) list.push(a);
    if (!primary[req.beatId]) primary[req.beatId] = arr[0];
  }

  const successCount = Object.keys(primary).length;
  const multiCount = Object.values(multi).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`[AssetGen] Completed: ${successCount} beats with ${multiCount} total clips/shots`);

  return { primary, multi };
}

async function processGroupMulti(
  group: ParallelGroup,
  allRequests: AssetRequest[],
  shotResults: Map<string, GeneratedAsset[]>,
  signal?: AbortSignal,
  imagesOnly?: boolean,
): Promise<void> {
  const requests = allRequests.filter(
    r => r.dependsOn === undefined && r.source === group.source && group.beatIds.includes(r.beatId),
  );

  const chunks = chunkArray(requests, group.maxConcurrent);

  for (const chunk of chunks) {
    const results = await Promise.allSettled(
      chunk.map(async (req) => {
        const assets = await fetchAssetsForRequest(req, signal, imagesOnly);
        if (assets && assets.length > 0) {
          // Stamp shotIdx so downstream consumers can match asset → shot
          if (req.shotIdx !== undefined) {
            for (const a of assets) a.shotIdx = req.shotIdx;
          }
          shotResults.set(reqKey(req), assets);
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

/**
 * Fetch one-or-more assets for a single AssetRequest.
 *
 * Returns MULTIPLE assets only in one case:
 *   - Beat-level Pexels request with no shotIdx → fetch PEXELS_CLIPS_PER_BEAT
 *     clips so we can rapid-fire sub-clip a single beat when shots[] is absent.
 *
 * Everything else returns exactly 1 asset.
 */
async function fetchAssetsForRequest(
  req: AssetRequest,
  signal?: AbortSignal,
  imagesOnly?: boolean,
): Promise<GeneratedAsset[] | null> {
  // Beat-level Pexels rapid-fire: fetch N video clips in one request
  const isShotLevel = req.shotIdx !== undefined;

  if (req.source === "pexels" && !isShotLevel) {
    if (imagesOnly) {
      // Images-only mode: use Pexels Photos API instead of Videos
      const { searchStockPhoto } = await import("./utils/pexelsClient.js");
      const photo = await searchStockPhoto(req.prompt, signal);
      if (photo) {
        return [{
          beatId: req.beatId,
          source: "pexels",
          mediaType: "image",
          url: photo.url,
          width: photo.width,
          height: photo.height,
          fallbackUsed: false,
        }];
      }
      // fallback chain
      const fb = await generateWithFallback(req, signal, undefined, imagesOnly);
      return fb ? [fb] : null;
    }
    const clips = await searchStockVideoBatch(req.prompt, PEXELS_CLIPS_PER_BEAT, signal);
    if (clips.length > 0) {
      return clips.map((clip) => ({
        beatId: req.beatId,
        source: "pexels" as const,
        mediaType: "video" as const,
        url: clip.url,
        durationSec: clip.duration,
        width: clip.width,
        height: clip.height,
        fallbackUsed: false,
      }));
    }
    const fb = await generateWithFallback(req, signal, undefined, imagesOnly);
    return fb ? [fb] : null;
  }

  // All other cases — single asset (possibly with fallback)
  const asset = await generateWithFallback(req, signal, undefined, imagesOnly);
  return asset ? [asset] : null;
}

async function generateWithFallback(
  req: AssetRequest,
  signal?: AbortSignal,
  _sourceImageUrl?: string,
  imagesOnly?: boolean,
): Promise<GeneratedAsset | null> {
  const label = req.shotIdx !== undefined ? `beat${req.beatId}s${req.shotIdx}` : `beat${req.beatId}`;
  // Try primary source
  try {
    return await retry(
      () => generateSingleAsset(req, signal, undefined, imagesOnly),
      `${req.source}:${label}`,
      2,
      signal,
    );
  } catch (primaryErr: any) {
    console.warn(`[AssetGen] ${label}: primary ${req.source} failed: ${primaryErr.message}`);
  }

  // Try fallback chain
  for (const fallbackSource of req.fallbackChain) {
    try {
      console.log(`[AssetGen] ${label}: trying fallback ${fallbackSource}...`);
      const fallbackReq = { ...req, source: fallbackSource };
      const asset = await generateSingleAsset(fallbackReq, signal, undefined, imagesOnly);
      return { ...asset, fallbackUsed: true, fallbackSource };
    } catch (fallbackErr: any) {
      console.warn(`[AssetGen] ${label}: fallback ${fallbackSource} also failed: ${fallbackErr.message}`);
    }
  }

  console.error(`[AssetGen] ${label}: ALL sources exhausted, no asset generated`);
  return null;
}

async function generateSingleAsset(
  req: AssetRequest,
  signal?: AbortSignal,
  _sourceImageUrl?: string,
  imagesOnly?: boolean,
): Promise<GeneratedAsset> {
  const label = req.shotIdx !== undefined ? `beat${req.beatId}s${req.shotIdx}` : `beat${req.beatId}`;

  switch (req.source) {
    case "nano_banana": {
      // Step 1: Generate sharp still image via Nano Banana
      const result = await generateImage(req.prompt, signal, req.aspectRatio);
      const imagePublicUrl = await uploadToStorage(result.imageBase64, result.mimeType, req.beatId, req.shotIdx);

      // Images-only mode: skip Veo animation, return still image directly
      if (imagesOnly) {
        console.log(`[AssetGen] ${label}: Nano Banana still (images-only mode)`);
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
      // If Veo fails, we gracefully fall back to the still image
      try {
        const motionPrompt = `Subtle cinematic motion: gentle camera movement, atmospheric lighting shifts. ${req.prompt}`;
        const veoResult = await animateImage(result.imageBase64, result.mimeType, motionPrompt, signal, req.aspectRatio);
        const videoPublicUrl = await uploadBufferToStorage(veoResult.videoBuffer, veoResult.mimeType, req.beatId, "mp4", req.shotIdx);
        console.log(`[AssetGen] ${label}: Nano Banana → Veo animation SUCCESS (${req.aspectRatio})`);
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
        console.warn(`[AssetGen] ${label}: Veo animation failed (${veoErr.message}), using still image with Ken Burns`);
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
      // Single-clip fetch for per-shot requests
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
      const publicUrl = await uploadBufferToStorage(capture.buffer, "image/png", req.beatId, "png", req.shotIdx);
      console.log(`[AssetGen] ${label}: Headless capture SUCCESS from ${url} (${capture.width}x${capture.height})`);

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
