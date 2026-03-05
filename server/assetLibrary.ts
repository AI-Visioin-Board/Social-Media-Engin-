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
 * Composite logo(s) as SMALL CORNER BADGES onto a background image.
 * Matches @evolving.ai style — logos are 80-110px circular badges in the
 * bottom-left corner. The AI-generated background is the main visual;
 * logos are supplementary brand identifiers, NOT the focal point.
 *
 * Layout options:
 * - "badge" (default): Single small logo badge in bottom-left corner
 * - "dual": Two small logos side by side in bottom-left
 *
 * If no backgroundBuffer is provided, creates a cinematic gradient background.
 */
export async function compositeAssetOnBackground(
  assetBuffer: Buffer,
  bgColor: string = "#0a0a1a",
  backgroundBuffer?: Buffer,
  options?: { layout?: "badge" | "dual"; secondLogoBuffer?: Buffer; secondBgColor?: string }
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

  // ── Logo sizing: SMALL corner badges (80-110px) like @evolving.ai ──
  // Background image is the hero visual; logos sit in the corner as context identifiers.
  const BADGE_SIZE = 100;  // outer circle diameter
  const BADGE_INNER = 70;  // logo itself inside the circle (with padding)
  const BADGE_MARGIN = 40; // distance from edge of image
  // Place badges in the upper-left area above the text overlay zone (bottom ~30% = text zone)
  // Position near top-left so they don't overlap text at bottom
  const BADGE_Y = 40;

  // Helper: create one circular badge at given position
  const createBadge = async (
    logoBuffer: Buffer,
    badgeBgColor: string,
    posX: number,
    posY: number,
    size: number,
    inner: number,
  ) => {
    const circleSvg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${badgeBgColor}" fill-opacity="0.85"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 2}" fill="none" stroke="white" stroke-opacity="0.25" stroke-width="1.5"/>
    </svg>`;
    composites.push({
      input: await sharp(Buffer.from(circleSvg)).png().toBuffer(),
      left: posX,
      top: posY,
    });
    const resized = await sharp(logoBuffer)
      .resize(inner, inner, { fit: "inside", withoutEnlargement: true })
      .png().toBuffer();
    const meta = await sharp(resized).metadata();
    composites.push({
      input: resized,
      left: posX + Math.round((size - (meta.width ?? inner)) / 2),
      top: posY + Math.round((size - (meta.height ?? inner)) / 2),
    });
  };

  if (options?.layout === "dual" && options.secondLogoBuffer) {
    // ── DUAL BADGE: Two small logos side by side in top-left corner ──
    const DUAL_BADGE = 90;
    const DUAL_INNER = 62;
    const gapX = 14;

    await createBadge(assetBuffer, bgColor, BADGE_MARGIN, BADGE_Y, DUAL_BADGE, DUAL_INNER);
    await createBadge(
      options.secondLogoBuffer,
      options.secondBgColor ?? "#1a1a2e",
      BADGE_MARGIN + DUAL_BADGE + gapX,
      BADGE_Y,
      DUAL_BADGE,
      DUAL_INNER,
    );
  } else {
    // ── SINGLE BADGE: One small logo in top-left corner ──
    await createBadge(assetBuffer, bgColor, BADGE_MARGIN, BADGE_Y, BADGE_SIZE, BADGE_INNER);
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

// ─── Person Composite ────────────────────────────────────────────────────────
// Composites a real person photo (ideally transparent or white-bg) onto an
// AI-generated background. Used for the "person_composite" strategy.
// The person is placed in the lower 60% of the frame, above the text zone.

/**
 * Composite a person photo onto an AI-generated background.
 * Handles non-transparent images by applying a vignette mask to blend the
 * person naturally into the scene (soft fade edges).
 *
 * @param personBuffer - The person photo (any format — transparent PNG ideal, but JPEG works)
 * @param backgroundBuffer - AI-generated 1080×1350 background scene
 * @param placement - Where to position the person: "center", "left", "right"
 * @returns Composed image buffer (1080×1350 PNG)
 */
export async function compositePersonOnBackground(
  personBuffer: Buffer,
  backgroundBuffer: Buffer,
  placement: "center" | "left" | "right" = "center",
): Promise<Buffer> {
  const W = 1080;
  const H = 1350;
  const PERSON_MAX_HEIGHT = Math.round(H * 0.55); // 55% of canvas height
  const PERSON_MAX_WIDTH = Math.round(W * 0.65);  // 65% of canvas width
  // Position person so feet are above the text zone (bottom 30% = ~405px)
  const TEXT_ZONE_TOP = H - 405;

  // Resize background
  const bg = await sharp(backgroundBuffer)
    .resize(W, H, { fit: "cover", position: "center" })
    .png()
    .toBuffer();

  // Resize person to fit within bounds
  const personResized = await sharp(personBuffer)
    .resize(PERSON_MAX_WIDTH, PERSON_MAX_HEIGHT, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();

  const personMeta = await sharp(personResized).metadata();
  const pW = personMeta.width ?? PERSON_MAX_WIDTH;
  const pH = personMeta.height ?? PERSON_MAX_HEIGHT;

  // Calculate position
  let left: number;
  switch (placement) {
    case "left":
      left = Math.round(W * 0.05);
      break;
    case "right":
      left = Math.round(W * 0.95 - pW);
      break;
    default: // center
      left = Math.round((W - pW) / 2);
  }
  // Bottom of person aligns with top of text zone
  const top = TEXT_ZONE_TOP - pH;

  // Create a soft vignette mask for non-transparent images.
  // This fades the edges of the person photo so it blends naturally.
  const maskW = pW;
  const maskH = pH;
  const feather = Math.round(Math.min(maskW, maskH) * 0.08); // 8% edge feather
  const maskSvg = `<svg width="${maskW}" height="${maskH}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="fadeTop" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="white" stop-opacity="0"/>
        <stop offset="${(feather / maskH * 100).toFixed(1)}%" stop-color="white" stop-opacity="1"/>
      </linearGradient>
      <linearGradient id="fadeBottom" x1="0" y1="0" x2="0" y2="1">
        <stop offset="${(100 - feather / maskH * 100).toFixed(1)}%" stop-color="white" stop-opacity="1"/>
        <stop offset="100%" stop-color="white" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect width="${maskW}" height="${maskH}" fill="white"/>
    <rect width="${maskW}" height="${maskH}" fill="url(#fadeTop)"/>
    <rect width="${maskW}" height="${maskH}" fill="url(#fadeBottom)"/>
  </svg>`;

  // Check if the person image has alpha channel (is already transparent)
  const hasAlpha = personMeta.channels === 4;

  let personFinal: Buffer;
  if (hasAlpha) {
    // Already transparent — use as-is
    personFinal = personResized;
  } else {
    // No transparency — apply the fade mask for soft edge blending
    const mask = await sharp(Buffer.from(maskSvg))
      .resize(pW, pH)
      .greyscale()
      .png()
      .toBuffer();

    personFinal = await sharp(personResized)
      .ensureAlpha()
      .composite([{ input: mask, blend: "dest-in" }])
      .png()
      .toBuffer();
  }

  return sharp(bg)
    .composite([{ input: personFinal, left, top }])
    .png()
    .toBuffer();
}

// ─── Product Composite ──────────────────────────────────────────────────────
// For product_shot strategy (future enhancement). Currently a simplified version.

/**
 * Composite a product image onto an AI-generated background.
 * Product is placed in the lower-center area, sized to ~35% of canvas width.
 */
export async function compositeProductOnBackground(
  productBuffer: Buffer,
  backgroundBuffer: Buffer,
  placement: "center" | "bottom-right" | "bottom-left" = "center",
): Promise<Buffer> {
  const W = 1080;
  const H = 1350;
  const PRODUCT_MAX = Math.round(W * 0.4); // 40% of canvas width
  const TEXT_ZONE_TOP = H - 405;

  const bg = await sharp(backgroundBuffer)
    .resize(W, H, { fit: "cover", position: "center" })
    .png()
    .toBuffer();

  const productResized = await sharp(productBuffer)
    .resize(PRODUCT_MAX, PRODUCT_MAX, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();

  const meta = await sharp(productResized).metadata();
  const pW = meta.width ?? PRODUCT_MAX;
  const pH = meta.height ?? PRODUCT_MAX;

  let left: number;
  switch (placement) {
    case "bottom-left":
      left = Math.round(W * 0.08);
      break;
    case "bottom-right":
      left = Math.round(W * 0.92 - pW);
      break;
    default:
      left = Math.round((W - pW) / 2);
  }
  const top = TEXT_ZONE_TOP - pH - 20;

  return sharp(bg)
    .composite([{ input: productResized, left, top }])
    .png()
    .toBuffer();
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
