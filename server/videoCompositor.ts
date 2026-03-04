/**
 * videoCompositor.ts
 *
 * Composites a Kling AI video into an Instagram-ready 1080×1350 MP4 with:
 * - Video fills the TOP 70% of the frame (945px), cropped/scaled to fit edge-to-edge
 * - Solid black BOTTOM 30% (405px) where the headline text lives
 * - Smooth gradient transition between video and black (starts at ~52%, fully black at 70%)
 * - Anton font headline with cyan accent words, centered in the black zone
 * - Optional insightLine chat bubble just above the headline
 * - "SuggestedByGPT" watermark + "SWIPE FOR MORE →" hint
 *
 * Approach: Sharp generates a 1080×1350 PNG overlay (transparent top, black bottom + gradient + text).
 * FFmpeg composites the Kling video underneath the Sharp overlay.
 * This avoids all FFmpeg drawtext escaping issues with %, quotes, etc.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import https from "https";
import http from "http";
import sharp from "sharp";
import { storagePut } from "./storage";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Constants ────────────────────────────────────────────────────────────────

const SLIDE_W = 1080;
const SLIDE_H = 1350;

// Top 70% = 945px for video zone, bottom 30% = 405px for text zone
const VIDEO_ZONE_H = Math.round(SLIDE_H * 0.70); // 945

const FONTS_DIR = path.join(__dirname, "fonts");
const ANTON_FONT_PATH = path.join(FONTS_DIR, "Anton-Regular.ttf");

const CYAN = "#00E5FF";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Download a URL to a temp file */
async function downloadToTemp(url: string, ext: string): Promise<string> {
  const tmpPath = path.join(os.tmpdir(), `sbgpt-vid-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(tmpPath);
    const doGet = (u: string) => {
      const protocol = u.startsWith("https") ? https : http;
      protocol.get(u, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doGet(res.headers.location);
          return;
        }
        res.pipe(file);
        file.on("finish", () => { file.close(); resolve(tmpPath); });
        file.on("error", reject);
      }).on("error", reject);
    };
    doGet(url);
  });
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

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

function getHighlightedWords(headline: string): Set<string> {
  const upper = headline.toUpperCase();
  const words = upper.split(" ");
  const highlighted = new Set<string>();

  const powerWords = new Set([
    "ILLEGAL", "SECRET", "BANNED", "EXPOSED", "LEAKED", "SHOCKING",
    "INSANE", "WILD", "MASSIVE", "BIGGEST", "WORST", "BEST", "FIRST",
    "NEVER", "ALWAYS", "EVERY", "ALL", "ZERO", "100%", "99%", "95%",
    "DEAD", "ALIVE", "DANGEROUS", "POWERFUL", "REVOLUTIONARY", "HISTORIC",
    "UNPRECEDENTED", "BREAKING", "URGENT", "CRITICAL", "EXTREME",
    "DESTROYED", "REPLACED", "ELIMINATED", "SURPASSED", "DEFEATED",
    "GOD", "GENIUS", "PERFECT", "IMPOSSIBLE", "UNSTOPPABLE",
  ]);

  for (const word of words) {
    const clean = word.replace(/[^A-Z0-9%]/g, "");
    if (powerWords.has(clean)) highlighted.add(word);
    if (/^\d+(\.\d+)?%$/.test(clean) || /^\d{2,}$/.test(clean)) highlighted.add(word);
  }

  if (highlighted.size === 0 && words.length >= 3) {
    highlighted.add(words[words.length - 1]);
    highlighted.add(words[words.length - 2]);
  }

  return highlighted;
}

/**
 * Build SVG overlay for a video slide.
 * The overlay has:
 * - Transparent top 70% (video shows through)
 * - Gradient fade from transparent to black starting at 52%
 * - Solid black bottom 30% with headline text
 * - Optional insightLine chat bubble
 * - Watermark + swipe hint
 */
function buildVideoOverlaySvg(
  headline: string,
  insightLine?: string
): string {
  const upper = headline.toUpperCase();
  const lines = wrapText(upper, 18);
  const fontSize = lines.length <= 2 ? 96 : lines.length <= 3 ? 80 : lines.length <= 4 ? 68 : 56;
  const lineHeight = fontSize * 1.22;
  const totalTextH = lines.length * lineHeight;

  // Text zone: VIDEO_ZONE_H to SLIDE_H - 100
  const textZoneTop = VIDEO_ZONE_H + 20;
  const textZoneBottom = SLIDE_H - 100;
  const textZoneH = textZoneBottom - textZoneTop;
  const textBlockTop = textZoneTop + Math.max(0, (textZoneH - totalTextH) / 2);

  const highlightedWords = getHighlightedWords(upper);

  const fontFamily = fs.existsSync(ANTON_FONT_PATH)
    ? `'Anton', Impact, 'Arial Black', sans-serif`
    : `Impact, 'Arial Black', sans-serif`;

  const fontFace = fs.existsSync(ANTON_FONT_PATH)
    ? `<style>@font-face { font-family: 'Anton'; src: url('${ANTON_FONT_PATH}'); }</style>`
    : "";

  // Build headline lines
  const shadowLines = lines.map((line, i) => {
    const y = textBlockTop + i * lineHeight + fontSize;
    return `<tspan x="${SLIDE_W / 2}" y="${y}">${escapeXml(line)}</tspan>`;
  }).join("\n    ");

  const textLines = lines.map((line, i) => {
    const y = textBlockTop + i * lineHeight + fontSize;
    const words = line.split(" ");
    const hasHighlight = words.some(w => highlightedWords.has(w));

    if (!hasHighlight) {
      return `<tspan x="${SLIDE_W / 2}" y="${y}" fill="white">${escapeXml(line)}</tspan>`;
    }

    const parts = words.map((word, wi) => {
      const color = highlightedWords.has(word) ? CYAN : "white";
      if (wi === 0) return `<tspan fill="${color}">${escapeXml(word)}</tspan>`;
      return `<tspan fill="white">&#x20;</tspan><tspan fill="${color}">${escapeXml(word)}</tspan>`;
    });
    return `<tspan x="${SLIDE_W / 2}" y="${y}" xml:space="preserve">${parts.join("")}</tspan>`;
  }).join("\n    ");

  // Insight bubble
  let insightBubbleSvg = "";
  if (insightLine && insightLine.trim().length > 3) {
    const insightWords = insightLine.trim().split(" ");
    const insightLines: string[] = [];
    let cur = "";
    for (const w of insightWords) {
      if ((cur + " " + w).trim().length <= 40) {
        cur = (cur + " " + w).trim();
      } else {
        if (cur) insightLines.push(cur);
        cur = w;
      }
    }
    if (cur) insightLines.push(cur);

    const iFontSize = 26;
    const iLineH = iFontSize + 8;
    const iPad = 16;
    const iBubbleW = Math.min(SLIDE_W - 80, 680);
    const iBubbleH = insightLines.length * iLineH + iPad * 2;
    const iBubbleX = (SLIDE_W - iBubbleW) / 2;
    const iBubbleY = textBlockTop - iBubbleH - 20;
    const iTailSize = 10;

    const iTextLines = insightLines.map((line, i) =>
      `<text x="${SLIDE_W / 2}" y="${iBubbleY + iPad + (i + 1) * iLineH - 4}" font-family="'Arial', sans-serif" font-size="${iFontSize}" fill="#0a0a0a" text-anchor="middle" font-weight="600">${escapeXml(line)}</text>`
    ).join("\n    ");

    insightBubbleSvg = `
  <rect x="${iBubbleX}" y="${iBubbleY}" width="${iBubbleW}" height="${iBubbleH}" rx="12" ry="12" fill="white" fill-opacity="0.92"/>
  <polygon points="${SLIDE_W / 2 - iTailSize},${iBubbleY + iBubbleH} ${SLIDE_W / 2 + iTailSize},${iBubbleY + iBubbleH} ${SLIDE_W / 2},${iBubbleY + iBubbleH + iTailSize * 1.5}" fill="white" fill-opacity="0.92"/>
  ${iTextLines}`;
  }

  return `<svg width="${SLIDE_W}" height="${SLIDE_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    ${fontFace}
    <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="black" stop-opacity="0"/>
      <stop offset="52%"  stop-color="black" stop-opacity="0"/>
      <stop offset="62%"  stop-color="black" stop-opacity="0.7"/>
      <stop offset="70%"  stop-color="black" stop-opacity="1"/>
      <stop offset="100%" stop-color="black" stop-opacity="1"/>
    </linearGradient>
  </defs>

  <!-- Gradient overlay: transparent top → solid black at 70% -->
  <rect x="0" y="0" width="${SLIDE_W}" height="${SLIDE_H}" fill="url(#grad)"/>

  ${insightBubbleSvg}

  <!-- Drop shadow for headline -->
  <text
    font-family="${fontFamily}"
    font-size="${fontSize}"
    font-weight="bold"
    fill="black"
    fill-opacity="0.5"
    text-anchor="middle"
    letter-spacing="1"
    transform="translate(4,4)"
  >
    ${shadowLines}
  </text>

  <!-- Headline with cyan highlights -->
  <text
    font-family="${fontFamily}"
    font-size="${fontSize}"
    font-weight="bold"
    text-anchor="middle"
    letter-spacing="1"
  >
    ${textLines}
  </text>

  <!-- SuggestedByGPT watermark -->
  <text x="52" y="${SLIDE_H - 58}" font-family="'Arial', sans-serif" font-size="26" fill="white" fill-opacity="0.6" font-weight="bold" letter-spacing="1">SuggestedByGPT</text>

  <!-- Swipe hint -->
  <text x="${SLIDE_W / 2}" y="${SLIDE_H - 28}" font-family="'Arial', sans-serif" font-size="28" fill="white" fill-opacity="0.75" text-anchor="middle" letter-spacing="5">SWIPE FOR MORE →</text>
</svg>`;
}

// ─── Main export ─────────────────────────────────────────────────────────────

export interface VideoCompositorInput {
  runId: number;
  slideIndex: number;
  videoUrl: string;
  headline: string;
  insightLine?: string;
}

/**
 * Composite a Kling video (or image fallback) into a 1080×1350 MP4 with text overlay.
 *
 * Steps:
 * 1. Download the Kling video/image to a temp file
 * 2. Generate a Sharp PNG overlay (gradient + text)
 * 3. FFmpeg: scale video to fill top 945px, overlay the Sharp PNG
 * 4. Upload the result to S3 and return the CDN URL
 */
export async function compositeVideoSlide(input: VideoCompositorInput): Promise<string> {
  const { runId, slideIndex, videoUrl, headline, insightLine } = input;

  console.log(`[VideoCompositor] Compositing slide ${slideIndex} for run ${runId}...`);

  // Detect if the "video" is actually an image
  const isActuallyImage = /\.(png|jpg|jpeg|webp)(\?|$)/i.test(videoUrl);
  const ext = isActuallyImage ? (videoUrl.includes(".jpg") || videoUrl.includes(".jpeg") ? "jpg" : "png") : "mp4";

  // 1. Download video/image
  const tmpVideoPath = await downloadToTemp(videoUrl, ext);
  console.log(`[VideoCompositor] Downloaded ${ext} (${Math.round(fs.statSync(tmpVideoPath).size / 1024)}KB)`);

  // 2. Generate Sharp overlay PNG
  const svgOverlay = buildVideoOverlaySvg(headline, insightLine);
  const overlayBuffer = await sharp(Buffer.from(svgOverlay))
    .png()
    .toBuffer();
  const tmpOverlayPath = path.join(os.tmpdir(), `sbgpt-overlay-${Date.now()}.png`);
  fs.writeFileSync(tmpOverlayPath, overlayBuffer);
  console.log(`[VideoCompositor] Sharp overlay PNG generated (${Math.round(overlayBuffer.length / 1024)}KB)`);

  // 3. FFmpeg composite
  const tmpOutputPath = path.join(os.tmpdir(), `sbgpt-composed-${Date.now()}.mp4`);

  try {
    // Filter graph:
    // [0:v] = video/image input → scale to fill 1080×945 (top zone)
    // [1:v] = Sharp overlay PNG (1080×1350, looped as static)
    // Composite: black 1080×1350 canvas → overlay video at top → overlay PNG on top
    const filterComplex = [
      `[0:v]scale=${SLIDE_W}:${VIDEO_ZONE_H}:force_original_aspect_ratio=increase,crop=${SLIDE_W}:${VIDEO_ZONE_H}[scaledVideo]`,
      `color=black:size=${SLIDE_W}x${SLIDE_H}:rate=24[blackCanvas]`,
      `[blackCanvas][scaledVideo]overlay=0:0[withVideo]`,
      `[withVideo][1:v]overlay=0:0[withOverlay]`,
    ].join("; ");

    const args = [
      "-y",
      ...(isActuallyImage ? ["-loop", "1"] : []),
      "-i", tmpVideoPath,       // [0:v] Kling video or image
      "-loop", "1",
      "-i", tmpOverlayPath,     // [1:v] Sharp overlay PNG (static, looped)
      "-filter_complex", filterComplex,
      "-map", "[withOverlay]",
      ...(isActuallyImage ? [] : ["-map", "0:a?"]),
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "22",
      "-pix_fmt", "yuv420p",
      "-t", "5",
      "-movflags", "+faststart",
      tmpOutputPath,
    ];

    console.log(`[VideoCompositor] Running FFmpeg...`);
    await execFileAsync("ffmpeg", args, { timeout: 120000 });

    const outputBuffer = fs.readFileSync(tmpOutputPath);
    console.log(`[VideoCompositor] Output: ${Math.round(outputBuffer.length / 1024)}KB`);

    // 4. Upload to S3
    const s3Key = `video-slides/run-${runId}-slide-${slideIndex}-${Date.now()}.mp4`;
    const { url } = await storagePut(s3Key, outputBuffer, "video/mp4");
    console.log(`[VideoCompositor] Uploaded → ${url.slice(0, 80)}...`);

    return url;
  } finally {
    [tmpVideoPath, tmpOverlayPath, tmpOutputPath].forEach(f => {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    });
  }
}
