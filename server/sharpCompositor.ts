/**
 * sharpCompositor.ts
 *
 * Assembles @evolving.ai-style Instagram carousel slides using Sharp.
 * - Full-bleed background image (1080×1350 portrait)
 * - Dark gradient overlay on the bottom 50%
 * - Bold ALL-CAPS white headline text (Bebas Neue / Oswald Bold)
 * - Small "SuggestedByGPT" watermark bottom-left
 * - "SWIPE →" hint on non-cover slides
 * - For video slides: returns the original video URL unchanged (Instagram plays it natively)
 * - Runs in <3 seconds per slide, zero external API calls
 */

import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";
import http from "http";
import os from "os";
import { storagePut } from "./storage";

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Constants ────────────────────────────────────────────────────────────────

const SLIDE_W = 1080;
const SLIDE_H = 1350; // 4:5 Instagram portrait ratio

// Font paths — bundled in server/fonts/
const FONTS_DIR = path.join(__dirname, "fonts");
const BEBAS_FONT = path.join(FONTS_DIR, "BebasNeue.ttf");
const OSWALD_FONT = path.join(FONTS_DIR, "Oswald-Bold.ttf");

// Pick the best available font
function getBestFont(): string {
  if (fs.existsSync(BEBAS_FONT) && fs.statSync(BEBAS_FONT).size > 10000) return BEBAS_FONT;
  if (fs.existsSync(OSWALD_FONT) && fs.statSync(OSWALD_FONT).size > 10000) return OSWALD_FONT;
  return ""; // fall back to system sans-serif
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SharpSlideInput {
  runId: number;
  slideIndex: number;
  headline: string;
  summary?: string;
  mediaUrl: string | null; // S3/CDN URL of the Nano Banana image (or Kling video)
  isVideo?: boolean;       // if true, skip image assembly and return mediaUrl directly
  isCover?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Download a URL to a temp file and return the local path. */
async function downloadToTemp(url: string, ext: string): Promise<string> {
  const tmpPath = path.join(os.tmpdir(), `sbgpt-sharp-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(tmpPath);
    const protocol = url.startsWith("https") ? https : http;
    protocol.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow one redirect
        const redirectUrl = res.headers.location;
        const proto2 = redirectUrl.startsWith("https") ? https : http;
        proto2.get(redirectUrl, (res2) => {
          res2.pipe(file);
          file.on("finish", () => { file.close(); resolve(tmpPath); });
          file.on("error", reject);
        }).on("error", reject);
      } else {
        res.pipe(file);
        file.on("finish", () => { file.close(); resolve(tmpPath); });
        file.on("error", reject);
      }
    }).on("error", reject);
  });
}

/** Wrap text into lines that fit within maxWidth characters. */
function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length <= maxCharsPerLine) {
      current = (current + " " + word).trim();
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Build the SVG overlay: gradient + headline + watermark + swipe hint */
function buildOverlaySvg(
  headline: string,
  isCover: boolean,
  fontPath: string
): string {
  const upper = headline.toUpperCase();
  // Wrap at ~18 chars per line for large font
  const lines = wrapText(upper, 18);
  const fontSize = lines.length <= 2 ? 110 : lines.length <= 3 ? 90 : 75;
  const lineHeight = fontSize * 1.1;
  const totalTextHeight = lines.length * lineHeight;

  // Position text in the lower third
  const textStartY = SLIDE_H - 220 - totalTextHeight;

  // Build tspan elements for each line
  const tspans = lines.map((line, i) => {
    const y = textStartY + i * lineHeight + fontSize;
    return `<tspan x="${SLIDE_W / 2}" y="${y}">${escapeXml(line)}</tspan>`;
  }).join("\n    ");

  // Font family string
  const fontFamily = fontPath
    ? `'${path.basename(fontPath, path.extname(fontPath))}'`
    : "Impact, 'Arial Black', sans-serif";

  // Swipe hint for non-cover slides
  const swipeHint = !isCover
    ? `<text x="${SLIDE_W / 2}" y="${SLIDE_H - 48}" font-family="${fontFamily}" font-size="32" fill="white" fill-opacity="0.7" text-anchor="middle" letter-spacing="4">SWIPE FOR MORE →</text>`
    : "";

  return `<svg width="${SLIDE_W}" height="${SLIDE_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="black" stop-opacity="0"/>
      <stop offset="40%" stop-color="black" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="black" stop-opacity="0.88"/>
    </linearGradient>
    ${fontPath ? `<style>@font-face { font-family: '${path.basename(fontPath, path.extname(fontPath))}'; src: url('${fontPath}'); }</style>` : ""}
  </defs>

  <!-- Dark gradient overlay covering bottom 65% -->
  <rect x="0" y="${SLIDE_H * 0.35}" width="${SLIDE_W}" height="${SLIDE_H * 0.65}" fill="url(#grad)"/>

  <!-- Thin accent line above text -->
  <rect x="60" y="${textStartY - 18}" width="120" height="6" fill="#6366f1" rx="3"/>

  <!-- Headline text with drop shadow -->
  <text
    font-family="${fontFamily}"
    font-size="${fontSize}"
    font-weight="bold"
    fill="black"
    fill-opacity="0.4"
    text-anchor="middle"
    letter-spacing="2"
    transform="translate(3,3)"
  >
    ${tspans}
  </text>
  <text
    font-family="${fontFamily}"
    font-size="${fontSize}"
    font-weight="bold"
    fill="white"
    text-anchor="middle"
    letter-spacing="2"
  >
    ${tspans}
  </text>

  <!-- SuggestedByGPT watermark -->
  <text x="60" y="${SLIDE_H - 52}" font-family="'Arial', sans-serif" font-size="28" fill="white" fill-opacity="0.55" font-weight="bold" letter-spacing="1">SuggestedByGPT</text>

  ${swipeHint}
</svg>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ─── Core: assemble one image slide ──────────────────────────────────────────

/**
 * Assemble a single image slide using Sharp.
 * Downloads the background image, composites the gradient+text SVG overlay,
 * uploads the result to S3, and returns the public CDN URL.
 *
 * For video slides (isVideo=true), returns the original mediaUrl unchanged.
 */
export async function assembleSlideWithSharp(
  slide: SharpSlideInput
): Promise<string | null> {
  const { runId, slideIndex, headline, mediaUrl, isVideo = false, isCover = false } = slide;

  console.log(`[SharpCompositor] Assembling slide ${slideIndex} (${isVideo ? "video" : "image"})...`);

  // ── Video slides: pass through the original URL ────────────────────────────
  // Instagram natively plays MP4 carousels. We don't need to composite anything.
  if (isVideo && mediaUrl) {
    console.log(`[SharpCompositor] Video slide — passing through: ${mediaUrl.slice(0, 80)}`);
    return mediaUrl;
  }

  // ── Image slides: download + composite + upload ────────────────────────────
  let bgImageBuffer: Buffer | null = null;

  if (mediaUrl) {
    try {
      const ext = "png";
      const tmpFile = await downloadToTemp(mediaUrl, ext);
      bgImageBuffer = fs.readFileSync(tmpFile);
      fs.unlink(tmpFile, () => {});
      console.log(`[SharpCompositor] Background image downloaded (${bgImageBuffer.length} bytes)`);
    } catch (err: any) {
      console.warn(`[SharpCompositor] Failed to download background image: ${err?.message} — using solid color fallback`);
    }
  }

  try {
    const fontPath = getBestFont();
    const overlaySvg = buildOverlaySvg(headline, isCover, fontPath);

    let pipeline: sharp.Sharp;

    if (bgImageBuffer) {
      // Resize background to exactly 1080×1350 (cover crop)
      pipeline = sharp(bgImageBuffer)
        .resize(SLIDE_W, SLIDE_H, { fit: "cover", position: "center" });
    } else {
      // Fallback: deep dark blue gradient background
      const fallbackSvg = `<svg width="${SLIDE_W}" height="${SLIDE_H}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#0f0c29"/>
            <stop offset="50%" stop-color="#302b63"/>
            <stop offset="100%" stop-color="#24243e"/>
          </linearGradient>
        </defs>
        <rect width="${SLIDE_W}" height="${SLIDE_H}" fill="url(#bg)"/>
      </svg>`;
      pipeline = sharp(Buffer.from(fallbackSvg));
    }

    const composited = await pipeline
      .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
      .png({ quality: 90, compressionLevel: 6 })
      .toBuffer();

    // Upload to S3
    const s3Key = `sharp-slides/run-${runId}-slide-${slideIndex}-${Date.now()}.png`;
    const { url } = await storagePut(s3Key, composited, "image/png");
    console.log(`[SharpCompositor] Slide ${slideIndex} uploaded to S3: ${url.slice(0, 80)}...`);
    return url;

  } catch (err: any) {
    console.error(`[SharpCompositor] Failed to assemble slide ${slideIndex}: ${err?.message}`);
    return null;
  }
}

// ─── Batch: assemble all slides for a run ────────────────────────────────────

export interface SharpAssemblyResult {
  slideIndex: number;
  url: string | null;
  isVideo: boolean;
}

/**
 * Assemble all slides for a run in parallel (Sharp is fast enough — no rate limits).
 * Returns an array of results in slideIndex order.
 */
export async function assembleAllSlides(
  slides: SharpSlideInput[]
): Promise<SharpAssemblyResult[]> {
  console.log(`[SharpCompositor] Assembling ${slides.length} slides in parallel...`);
  const start = Date.now();

  const results = await Promise.all(
    slides.map(async (slide) => {
      const url = await assembleSlideWithSharp(slide);
      return { slideIndex: slide.slideIndex, url, isVideo: slide.isVideo ?? false };
    })
  );

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const succeeded = results.filter((r) => r.url !== null).length;
  console.log(`[SharpCompositor] Done: ${succeeded}/${slides.length} slides in ${elapsed}s`);
  return results;
}
