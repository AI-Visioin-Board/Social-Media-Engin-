/**
 * assetLibrary.ts
 *
 * Real-image sourcing for Instagram carousel slides.
 *
 * Two strategies:
 * 1. CURATED LOGOS — hardcoded map of top AI/tech companies → transparent PNG URLs
 *    from stable public sources (GitHub, Wikimedia, official CDNs). Free, instant.
 *
 * 2. DYNAMIC SEARCH — Google Custom Search JSON API for people, products, events.
 *    100 free queries/day (plenty for 2 posts/week × 4 slides).
 *    Requires GOOGLE_CSE_API_KEY and GOOGLE_CSE_ID env vars.
 *
 * The Marketing Brain decides per-slide: "fetch_logo" | "search_image" | "generate"
 * and this module handles the first two.
 */

import https from "https";
import http from "http";
import sharp from "sharp";
import path from "path";
import os from "os";
import fs from "fs";
import { storagePut } from "./storage";

// ─── Curated Logo Library ─────────────────────────────────────────────────────
// Maps normalized company names → transparent PNG URLs from stable public sources.
// These are official logos hosted on GitHub repos, Wikimedia, or CDNs that rarely change.
// If a URL breaks, the pipeline falls back to AI generation gracefully.

export const LOGO_LIBRARY: Record<string, { url: string; bgColor?: string; description: string }> = {
  openai: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/OpenAI_Logo.svg/1024px-OpenAI_Logo.svg.png",
    bgColor: "#000000",
    description: "OpenAI black swirl logo on white",
  },
  chatgpt: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/ChatGPT_logo.svg/1024px-ChatGPT_logo.svg.png",
    bgColor: "#10A37F",
    description: "ChatGPT green logo",
  },
  google: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/Google_2015_logo.svg/1200px-Google_2015_logo.svg.png",
    bgColor: "#FFFFFF",
    description: "Google multicolor wordmark",
  },
  gemini: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Google_Gemini_logo.svg/1024px-Google_Gemini_logo.svg.png",
    bgColor: "#000000",
    description: "Google Gemini star logo",
  },
  deepmind: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/DeepMind_new_logo.svg/1024px-DeepMind_new_logo.svg.png",
    bgColor: "#000000",
    description: "DeepMind logo",
  },
  anthropic: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/Anthropic_logo.svg/1024px-Anthropic_logo.svg.png",
    bgColor: "#D4A574",
    description: "Anthropic wordmark",
  },
  claude: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/Anthropic_logo.svg/1024px-Anthropic_logo.svg.png",
    bgColor: "#D4A574",
    description: "Claude / Anthropic logo",
  },
  meta: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Meta_Platforms_Inc._logo.svg/1200px-Meta_Platforms_Inc._logo.svg.png",
    bgColor: "#0668E1",
    description: "Meta blue infinity logo",
  },
  llama: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Meta_Platforms_Inc._logo.svg/1200px-Meta_Platforms_Inc._logo.svg.png",
    bgColor: "#0668E1",
    description: "Meta LLaMA (uses Meta logo)",
  },
  microsoft: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/Microsoft_logo_%282012%29.svg/1024px-Microsoft_logo_%282012%29.svg.png",
    bgColor: "#FFFFFF",
    description: "Microsoft 4-color grid logo",
  },
  copilot: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2a/Microsoft_365_Copilot_Icon.svg/1024px-Microsoft_365_Copilot_Icon.svg.png",
    bgColor: "#000000",
    description: "Microsoft Copilot icon",
  },
  apple: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/Apple_logo_black.svg/800px-Apple_logo_black.svg.png",
    bgColor: "#000000",
    description: "Apple black logo",
  },
  nvidia: {
    url: "https://upload.wikimedia.org/wikipedia/sco/thumb/2/21/Nvidia_logo.svg/1200px-Nvidia_logo.svg.png",
    bgColor: "#76B900",
    description: "NVIDIA green eye logo",
  },
  tesla: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bd/Tesla_Motors.svg/800px-Tesla_Motors.svg.png",
    bgColor: "#CC0000",
    description: "Tesla T logo",
  },
  xai: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/XAI-Logo.svg/1024px-XAI-Logo.svg.png",
    bgColor: "#000000",
    description: "xAI logo",
  },
  grok: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/XAI-Logo.svg/1024px-XAI-Logo.svg.png",
    bgColor: "#000000",
    description: "Grok / xAI logo",
  },
  amazon: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Amazon_logo.svg/1200px-Amazon_logo.svg.png",
    bgColor: "#FF9900",
    description: "Amazon smile logo",
  },
  aws: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Amazon_Web_Services_Logo.svg/1200px-Amazon_Web_Services_Logo.svg.png",
    bgColor: "#FF9900",
    description: "AWS logo",
  },
  samsung: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/24/Samsung_Logo.svg/1200px-Samsung_Logo.svg.png",
    bgColor: "#1428A0",
    description: "Samsung blue wordmark",
  },
  palantir: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/13/Palantir_Technologies_logo.svg/1200px-Palantir_Technologies_logo.svg.png",
    bgColor: "#000000",
    description: "Palantir logo",
  },
  huggingface: {
    url: "https://upload.wikimedia.org/wikipedia/en/thumb/4/4a/Hugging_Face_logo_%282024%29.svg/1024px-Hugging_Face_logo_%282024%29.svg.png",
    bgColor: "#FFD21E",
    description: "Hugging Face emoji logo",
  },
  stability: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/Stability_AI_logo.svg/1024px-Stability_AI_logo.svg.png",
    bgColor: "#000000",
    description: "Stability AI logo",
  },
  midjourney: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/Midjourney_Emblem.png/600px-Midjourney_Emblem.png",
    bgColor: "#000000",
    description: "Midjourney sailboat emblem",
  },
  mistral: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/Mistral_AI_logo_%282025%29.svg/1024px-Mistral_AI_logo_%282025%29.svg.png",
    bgColor: "#000000",
    description: "Mistral AI logo",
  },
  perplexity: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/Perplexity_AI_logo.svg/1024px-Perplexity_AI_logo.svg.png",
    bgColor: "#000000",
    description: "Perplexity AI logo",
  },
  ibm: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/51/IBM_logo.svg/1200px-IBM_logo.svg.png",
    bgColor: "#0530AD",
    description: "IBM blue stripes logo",
  },
  intel: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7d/Intel_logo_%282006-2020%29.svg/1200px-Intel_logo_%282006-2020%29.svg.png",
    bgColor: "#0071C5",
    description: "Intel blue logo",
  },
  qualcomm: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/Qualcomm-Logo.svg/1200px-Qualcomm-Logo.svg.png",
    bgColor: "#3253DC",
    description: "Qualcomm logo",
  },
  bytedance: {
    url: "https://upload.wikimedia.org/wikipedia/en/thumb/a/a0/ByteDance_logo_English.svg/1200px-ByteDance_logo_English.svg.png",
    bgColor: "#000000",
    description: "ByteDance logo",
  },
  baidu: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/Baidu_Logo_%282019%29.svg/1200px-Baidu_Logo_%282019%29.svg.png",
    bgColor: "#2319DC",
    description: "Baidu logo",
  },
};

// ─── Company name normalization ────────────────────────────────────────────────

const COMPANY_ALIASES: Record<string, string> = {
  "open ai": "openai", "open-ai": "openai", "gpt": "openai", "gpt-4": "openai",
  "gpt-5": "openai", "gpt4o": "openai", "gpt5": "openai", "dall-e": "openai",
  "sora": "openai", "o1": "openai", "o3": "openai",
  "chat gpt": "chatgpt", "chat-gpt": "chatgpt",
  "google ai": "google", "google deepmind": "deepmind", "deep mind": "deepmind",
  "google gemini": "gemini",
  "claude ai": "claude", "claude 3": "claude", "claude 4": "claude",
  "meta ai": "meta", "meta llama": "llama", "llama 3": "llama", "llama 4": "llama",
  "facebook": "meta",
  "copilot ai": "copilot", "microsoft copilot": "copilot",
  "bing ai": "microsoft", "azure ai": "microsoft",
  "apple intelligence": "apple", "apple ai": "apple", "siri": "apple",
  "elon musk": "xai", "elon": "xai", "musk": "xai",
  "grok ai": "grok",
  "amazon ai": "amazon", "alexa": "amazon", "bedrock": "aws",
  "hugging face": "huggingface",
  "stable diffusion": "stability", "stability ai": "stability",
  "mid journey": "midjourney", "mid-journey": "midjourney",
  "mistral ai": "mistral",
  "perplexity ai": "perplexity",
  "ibm watson": "ibm", "watson": "ibm", "watsonx": "ibm",
  "tiktok": "bytedance", "tik tok": "bytedance",
};

/** Try to find a curated logo for a company mentioned in the text */
export function findLogoForText(text: string): { url: string; bgColor?: string; description: string } | null {
  const results = findAllLogosForText(text);
  return results.length > 0 ? results[0] : null;
}

/**
 * Find ALL matching logos in the text (for dual-logo competition slides).
 * Returns up to 2 matches, ordered by position in text (first mentioned = first returned).
 */
export function findAllLogosForText(text: string): Array<{ url: string; bgColor?: string; description: string; key: string }> {
  const lower = text.toLowerCase();
  const found: Array<{ url: string; bgColor?: string; description: string; key: string; pos: number }> = [];
  const seenKeys = new Set<string>();

  // Direct match
  for (const key of Object.keys(LOGO_LIBRARY)) {
    const pos = lower.indexOf(key);
    if (pos >= 0 && !seenKeys.has(key)) {
      seenKeys.add(key);
      found.push({ ...LOGO_LIBRARY[key], key, pos });
    }
  }

  // Alias match
  for (const [alias, canonical] of Object.entries(COMPANY_ALIASES)) {
    const pos = lower.indexOf(alias);
    if (pos >= 0 && !seenKeys.has(canonical)) {
      seenKeys.add(canonical);
      const entry = LOGO_LIBRARY[canonical];
      if (entry) found.push({ ...entry, key: canonical, pos });
    }
  }

  // Sort by position in text, return first 2
  found.sort((a, b) => a.pos - b.pos);
  return found.slice(0, 2);
}

// ─── Google Custom Search Image API ────────────────────────────────────────────
// 100 free queries/day. Set GOOGLE_CSE_API_KEY and GOOGLE_CSE_ID env vars.

interface ImageSearchResult {
  url: string;
  title: string;
  width: number;
  height: number;
}

/**
 * Search Google Images for a specific query and return the top result.
 * Returns null if no API keys configured or no results found.
 */
export async function searchImage(
  query: string,
  opts: { transparent?: boolean; portrait?: boolean } = {}
): Promise<ImageSearchResult | null> {
  let apiKey = process.env.GOOGLE_CSE_API_KEY;
  let cseId = process.env.GOOGLE_CSE_ID;

  // Fall back to DB-stored credentials if env vars not set
  if (!apiKey || !cseId) {
    try {
      const { getDb } = await import("./db");
      const { appSettings } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const db = await getDb();
      if (db) {
        const [ak] = await db.select().from(appSettings).where(eq(appSettings.key, "google_cse_api_key"));
        const [ci] = await db.select().from(appSettings).where(eq(appSettings.key, "google_cse_id"));
        if (ak?.value) apiKey = ak.value;
        if (ci?.value) cseId = ci.value;
      }
    } catch { /* ignore */ }
  }

  if (!apiKey || !cseId) {
    console.log("[AssetLibrary] Google CSE not configured — skipping image search");
    return null;
  }

  const params = new URLSearchParams({
    key: apiKey,
    cx: cseId,
    q: query,
    searchType: "image",
    num: "3",
    safe: "active",
    imgSize: "large",
    ...(opts.transparent ? { imgType: "clipart" } : {}),
    ...(opts.portrait ? { imgType: "photo" } : {}),
  });

  try {
    const url = `https://www.googleapis.com/customsearch/v1?${params}`;
    const res = await fetchJson(url);

    if (!res.items || res.items.length === 0) return null;

    // Pick the best result (prefer larger images)
    const item = res.items[0];
    return {
      url: item.link,
      title: item.title ?? query,
      width: item.image?.width ?? 800,
      height: item.image?.height ?? 800,
    };
  } catch (err: any) {
    console.warn(`[AssetLibrary] Google CSE search failed: ${err?.message}`);
    return null;
  }
}

// ─── Image download + processing ─────────────────────────────────────────────

/** Download an image URL and return a Sharp buffer ready for compositing */
export async function downloadImage(imageUrl: string): Promise<Buffer | null> {
  try {
    const tmpPath = path.join(os.tmpdir(), `sbgpt-asset-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);

    await new Promise<void>((resolve, reject) => {
      const doGet = (u: string, redirects = 0) => {
        if (redirects > 3) { reject(new Error("Too many redirects")); return; }
        const protocol = u.startsWith("https") ? https : http;
        protocol.get(u, { headers: { "User-Agent": "SuggestedByGPT/1.0" } }, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            doGet(res.headers.location, redirects + 1);
            return;
          }
          if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
          const file = fs.createWriteStream(tmpPath);
          res.pipe(file);
          file.on("finish", () => { file.close(); resolve(); });
          file.on("error", reject);
        }).on("error", reject);
      };
      doGet(imageUrl);
    });

    // Process with Sharp: resize to max 800px, convert to PNG
    const processed = await sharp(tmpPath)
      .resize(800, 800, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();

    fs.unlink(tmpPath, () => {});
    return processed;
  } catch (err: any) {
    console.warn(`[AssetLibrary] Download failed: ${err?.message}`);
    return null;
  }
}

/**
 * Composite a logo/asset as a LARGE, PROMINENT circular overlay onto a background image.
 * Inspired by @evolving.ai / @airesearches style — logos are 300-400px, placed in the
 * upper portion of the image as a major visual element (not a small badge).
 *
 * Layout options:
 * - "hero": Single large logo centered in upper-third (default)
 * - "dual": Two logos side by side (for competition/comparison stories)
 *
 * If no backgroundBuffer is provided, creates a cinematic gradient background.
 */
export async function compositeAssetOnBackground(
  assetBuffer: Buffer,
  bgColor: string = "#0a0a1a",
  backgroundBuffer?: Buffer,
  options?: { layout?: "hero" | "dual"; secondLogoBuffer?: Buffer; secondBgColor?: string }
): Promise<Buffer> {
  const W = 1080;
  const H = 1350;
  let bgPipeline: sharp.Sharp;

  if (backgroundBuffer) {
    bgPipeline = sharp(backgroundBuffer)
      .resize(W, H, { fit: "cover", position: "center" });
  } else {
    const gradientSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="glow" cx="50%" cy="30%" r="65%">
          <stop offset="0%" stop-color="${bgColor}" stop-opacity="0.35"/>
          <stop offset="50%" stop-color="#0a0a1a" stop-opacity="0.85"/>
          <stop offset="100%" stop-color="#000000" stop-opacity="1"/>
        </radialGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="#050510"/>
      <rect width="${W}" height="${H}" fill="url(#glow)"/>
    </svg>`;
    bgPipeline = sharp(Buffer.from(gradientSvg));
  }

  const bgBuffer = await bgPipeline.png().toBuffer();
  const composites: sharp.OverlayOptions[] = [];

  // ── Logo sizing: LARGE and prominent (300-380px) like @evolving.ai ──
  const LOGO_SIZE = 340; // diameter of the circular logo container
  const LOGO_INNER = LOGO_SIZE - 40; // logo itself inside the circle (with padding)

  // Resize main logo to fit inside the circle
  const resizedAsset = await sharp(assetBuffer)
    .resize(LOGO_INNER, LOGO_INNER, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();

  const assetMeta = await sharp(resizedAsset).metadata();
  const assetW = assetMeta.width ?? LOGO_INNER;
  const assetH = assetMeta.height ?? LOGO_INNER;

  if (options?.layout === "dual" && options.secondLogoBuffer) {
    // ── DUAL LAYOUT: Two logos side by side (competition stories) ──
    const DUAL_SIZE = 260;
    const DUAL_INNER = DUAL_SIZE - 30;
    const gapX = 80; // gap between circles
    const leftCenterX = Math.round(W / 2 - DUAL_SIZE / 2 - gapX / 2);
    const rightCenterX = Math.round(W / 2 + DUAL_SIZE / 2 + gapX / 2);
    const centerY = Math.round(H * 0.22); // 22% from top

    // Left circle (main logo)
    const leftCircleSvg = `<svg width="${DUAL_SIZE}" height="${DUAL_SIZE}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${DUAL_SIZE / 2}" cy="${DUAL_SIZE / 2}" r="${DUAL_SIZE / 2}" fill="${bgColor}" fill-opacity="0.85"/>
      <circle cx="${DUAL_SIZE / 2}" cy="${DUAL_SIZE / 2}" r="${DUAL_SIZE / 2 - 3}" fill="none" stroke="white" stroke-opacity="0.2" stroke-width="2"/>
    </svg>`;
    composites.push({
      input: await sharp(Buffer.from(leftCircleSvg)).png().toBuffer(),
      left: leftCenterX - DUAL_SIZE / 2,
      top: centerY - DUAL_SIZE / 2,
    });

    const resizedLeft = await sharp(assetBuffer)
      .resize(DUAL_INNER, DUAL_INNER, { fit: "inside", withoutEnlargement: true })
      .png().toBuffer();
    const leftMeta = await sharp(resizedLeft).metadata();
    composites.push({
      input: resizedLeft,
      left: leftCenterX - Math.round((leftMeta.width ?? DUAL_INNER) / 2),
      top: centerY - Math.round((leftMeta.height ?? DUAL_INNER) / 2),
    });

    // Right circle (second logo)
    const secondColor = options.secondBgColor ?? "#1a1a2e";
    const rightCircleSvg = `<svg width="${DUAL_SIZE}" height="${DUAL_SIZE}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${DUAL_SIZE / 2}" cy="${DUAL_SIZE / 2}" r="${DUAL_SIZE / 2}" fill="${secondColor}" fill-opacity="0.85"/>
      <circle cx="${DUAL_SIZE / 2}" cy="${DUAL_SIZE / 2}" r="${DUAL_SIZE / 2 - 3}" fill="none" stroke="white" stroke-opacity="0.2" stroke-width="2"/>
    </svg>`;
    composites.push({
      input: await sharp(Buffer.from(rightCircleSvg)).png().toBuffer(),
      left: rightCenterX - DUAL_SIZE / 2,
      top: centerY - DUAL_SIZE / 2,
    });

    const resizedRight = await sharp(options.secondLogoBuffer)
      .resize(DUAL_INNER, DUAL_INNER, { fit: "inside", withoutEnlargement: true })
      .png().toBuffer();
    const rightMeta = await sharp(resizedRight).metadata();
    composites.push({
      input: resizedRight,
      left: rightCenterX - Math.round((rightMeta.width ?? DUAL_INNER) / 2),
      top: centerY - Math.round((rightMeta.height ?? DUAL_INNER) / 2),
    });
  } else {
    // ── HERO LAYOUT: Single large centered logo ──
    const centerX = Math.round(W / 2);
    const centerY = Math.round(H * 0.22); // upper third

    // Dark circle backdrop with subtle border (like @evolving.ai style)
    const circleSvg = `<svg width="${LOGO_SIZE}" height="${LOGO_SIZE}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${LOGO_SIZE / 2}" cy="${LOGO_SIZE / 2}" r="${LOGO_SIZE / 2}" fill="${bgColor}" fill-opacity="0.85"/>
      <circle cx="${LOGO_SIZE / 2}" cy="${LOGO_SIZE / 2}" r="${LOGO_SIZE / 2 - 3}" fill="none" stroke="white" stroke-opacity="0.15" stroke-width="2"/>
    </svg>`;
    composites.push({
      input: await sharp(Buffer.from(circleSvg)).png().toBuffer(),
      left: centerX - LOGO_SIZE / 2,
      top: centerY - LOGO_SIZE / 2,
    });

    // Center the logo inside the circle
    composites.push({
      input: resizedAsset,
      left: centerX - Math.round(assetW / 2),
      top: centerY - Math.round(assetH / 2),
    });
  }

  return sharp(bgBuffer)
    .composite(composites)
    .png()
    .toBuffer();
}

/**
 * Upload a composed asset to S3 and return the public URL.
 */
export async function uploadAsset(buffer: Buffer, runId: number, slideIndex: number): Promise<string> {
  const key = `assets/run-${runId}-slide-${slideIndex}-${Date.now()}.png`;
  const { url } = await storagePut(key, buffer, "image/png");
  return url;
}

// ─── Marketing Brain image strategy types ─────────────────────────────────────

export type ImageStrategy =
  | { type: "generate"; prompt: string }           // Use AI image generation (existing flow)
  | { type: "fetch_logo"; company: string }         // Use curated logo library
  | { type: "search_image"; query: string }         // Google Custom Search for dynamic images
  | { type: "logo_with_scene"; company: string; scenePrompt: string }; // Logo composited onto generated background

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    protocol.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error("Invalid JSON")); }
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}
