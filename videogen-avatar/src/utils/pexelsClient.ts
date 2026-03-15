// ============================================================
// Pexels API Client — Free stock video footage
// Free tier: 200 req/hr, 20,000/month
// Used for "generic_action" beats (typing, office, city, etc.)
// ============================================================

import { CONFIG } from "../config.js";

interface PexelsVideo {
  id: number;
  url: string;
  duration: number;
  width: number;
  height: number;
  videoFiles: PexelsVideoFile[];
}

interface PexelsVideoFile {
  id: number;
  quality: "hd" | "sd" | "uhd";
  fileType: string;
  width: number;
  height: number;
  link: string;
}

interface PexelsSearchResult {
  total_results: number;
  videos: PexelsVideo[];
}

export async function searchStockVideo(
  query: string,
  signal?: AbortSignal,
): Promise<{ url: string; duration: number; width: number; height: number } | null> {
  if (!CONFIG.pexelsApiKey) {
    console.warn("[Pexels] No API key configured, skipping stock footage search");
    return null;
  }

  const params = new URLSearchParams({
    query,
    orientation: "portrait",
    size: "medium",
    per_page: "10",
  });

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
    return null;
  }

  const data: PexelsSearchResult = await response.json();

  if (data.videos.length === 0) {
    console.warn(`[Pexels] No results for query: "${query}"`);
    return null;
  }

  // Pick the best video: prefer portrait, HD, at least 3 seconds
  const suitable = data.videos.filter(v => v.duration >= CONFIG.pexelsMinDuration);
  const video = suitable.length > 0 ? suitable[0] : data.videos[0];

  // Find the best video file: prefer HD, portrait aspect
  const file = pickBestFile(video.videoFiles);
  if (!file) {
    console.warn(`[Pexels] No suitable video file for video ${video.id}`);
    return null;
  }

  return {
    url: file.link,
    duration: video.duration,
    width: file.width,
    height: file.height,
  };
}

function pickBestFile(files: PexelsVideoFile[]): PexelsVideoFile | null {
  // Prefer HD, then SD. Filter for mp4.
  const mp4s = files.filter(f => f.fileType === "video/mp4");
  if (mp4s.length === 0) return files[0] ?? null;

  // Prefer portrait (height > width)
  const portrait = mp4s.filter(f => f.height > f.width);
  const pool = portrait.length > 0 ? portrait : mp4s;

  // Prefer HD quality
  const hd = pool.filter(f => f.quality === "hd");
  return hd[0] ?? pool[0] ?? null;
}
