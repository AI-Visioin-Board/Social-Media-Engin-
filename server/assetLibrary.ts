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
  const lower = text.toLowerCase();

  // Direct match
  for (const key of Object.keys(LOGO_LIBRARY)) {
    if (lower.includes(key)) return LOGO_LIBRARY[key];
  }

  // Alias match
  for (const [alias, canonical] of Object.entries(COMPANY_ALIASES)) {
    if (lower.includes(alias)) return LOGO_LIBRARY[canonical] ?? null;
  }

  return null;
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
  const apiKey = process.env.GOOGLE_CSE_API_KEY;
  const cseId = process.env.GOOGLE_CSE_ID;

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
 * Composite a logo/asset onto a dark background, ready for use as a slide background.
 * Creates a 1080×1350 image with the logo centered in the upper 60% of the frame.
 */
export async function compositeAssetOnBackground(
  assetBuffer: Buffer,
  bgColor: string = "#0a0a1a"
): Promise<Buffer> {
  // Create dark background
  const bg = sharp({
    create: {
      width: 1080,
      height: 1350,
      channels: 4,
      background: bgColor,
    },
  }).png();

  // Resize asset to fit in center (max 600px wide, 500px tall)
  const resizedAsset = await sharp(assetBuffer)
    .resize(600, 500, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();

  const assetMeta = await sharp(resizedAsset).metadata();
  const assetW = assetMeta.width ?? 600;
  const assetH = assetMeta.height ?? 500;

  // Center in upper 60% of frame
  const left = Math.round((1080 - assetW) / 2);
  const top = Math.round((1350 * 0.6 - assetH) / 2);  // center in upper 60%

  return bg
    .composite([{ input: resizedAsset, left, top }])
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
