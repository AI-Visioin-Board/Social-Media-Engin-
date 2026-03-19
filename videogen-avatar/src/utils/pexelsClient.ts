// ============================================================
// Pexels API Client — Free stock video footage
// Free tier: 200 req/hr, 20,000/month
// Used for "generic_action" beats (typing, office, city, etc.)
//
// searchStockVideo() — single best clip (original behavior)
// searchStockVideoBatch() — multiple clips for rapid-fire sub-clipping
// ============================================================

import { CONFIG } from "../config.js";

interface PexelsVideo {
  id: number;
  url: string;
  duration: number;
  width: number;
  height: number;
  video_files: PexelsVideoFile[];  // Pexels API uses snake_case
}

interface PexelsVideoFile {
  id: number;
  quality: "hd" | "sd" | "uhd";
  file_type: string;   // Pexels API uses snake_case
  width: number;
  height: number;
  link: string;
}

interface PexelsSearchResult {
  total_results: number;
  videos: PexelsVideo[];
}

export interface StockClip {
  url: string;
  duration: number;
  width: number;
  height: number;
  pexelsVideoId: number;
}

// Track used video IDs to avoid duplicates within a single video generation
const usedVideoIds = new Set<number>();

export function resetUsedVideos(): void {
  usedVideoIds.clear();
}

/**
 * Search for a single stock video clip (backward compatible)
 */
export async function searchStockVideo(
  query: string,
  signal?: AbortSignal,
): Promise<StockClip | null> {
  const results = await searchStockVideoBatch(query, 1, signal);
  return results[0] ?? null;
}

/**
 * Search for multiple stock video clips for rapid-fire sub-clipping.
 * Returns up to `count` unique clips (deduplicated within this video generation).
 */
export async function searchStockVideoBatch(
  query: string,
  count: number = 3,
  signal?: AbortSignal,
): Promise<StockClip[]> {
  if (!CONFIG.pexelsApiKey) {
    console.warn("[Pexels] No API key configured, skipping stock footage search");
    return [];
  }

  // Request more results to have deduplication headroom
  const perPage = Math.min(Math.max(count * 3, 10), 30);

  const params = new URLSearchParams({
    query,
    orientation: "portrait",
    size: "medium",
    per_page: String(perPage),
  });

  try {
    const response = await fetch(
      `https://api.pexels.com/videos/search?${params}`,
      {
        headers: { Authorization: CONFIG.pexelsApiKey },
        signal,
      },
    );

    if (!response.ok) {
      const err = await response.text();
      console.error(`[Pexels] API error (${response.status}): ${err}`);
      return [];
    }

    const data: PexelsSearchResult = await response.json();

    if (data.videos.length === 0) {
      console.warn(`[Pexels] No results for query: "${query}"`);
      return [];
    }

    // Filter for suitable videos (minimum duration, not already used)
    const suitable = data.videos.filter(
      v => v.duration >= CONFIG.pexelsMinDuration && !usedVideoIds.has(v.id)
    );

    // Fall back to all videos if deduplication is too aggressive
    const pool = suitable.length >= count ? suitable : data.videos.filter(v => !usedVideoIds.has(v.id));
    const finalPool = pool.length > 0 ? pool : data.videos;

    const clips: StockClip[] = [];
    for (const video of finalPool) {
      if (clips.length >= count) break;

      const file = pickBestFile(video.video_files);
      if (!file) continue;

      usedVideoIds.add(video.id);
      clips.push({
        url: file.link,
        duration: video.duration,
        width: file.width,
        height: file.height,
        pexelsVideoId: video.id,
      });
    }

    console.log(`[Pexels] Found ${clips.length}/${count} clips for "${query}"`);
    return clips;
  } catch (err: any) {
    if (err.name === "AbortError") throw err;
    console.error(`[Pexels] Search failed for "${query}":`, err.message);
    return [];
  }
}

function pickBestFile(files: PexelsVideoFile[]): PexelsVideoFile | null {
  // Prefer HD, then SD. Filter for mp4.
  const mp4s = files.filter(f => f.file_type === "video/mp4");
  if (mp4s.length === 0) return files[0] ?? null;

  // Prefer portrait (height > width)
  const portrait = mp4s.filter(f => f.height > f.width);
  const pool = portrait.length > 0 ? portrait : mp4s;

  // Prefer HD quality
  const hd = pool.filter(f => f.quality === "hd");
  return hd[0] ?? pool[0] ?? null;
}
