/**
 * ffmpegCompositor.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Assembles the evolving.ai-style split-screen video carousel slides using FFmpeg.
 *
 * Each content slide layout (1080×1920 vertical):
 *   ┌──────────────────────────────────┐
 *   │  BLACK BACKGROUND (top ~45%)     │  ← Numbered headline + 2-line summary
 *   │  White text, brand watermark     │
 *   ├──────────────────────────────────┤
 *   │  B-ROLL IMAGE/VIDEO (bottom 55%) │  ← Nano Banana image or Kling video
 *   └──────────────────────────────────┘
 *
 * Cover slide layout:
 *   Full-frame image with bold headline text overlay at bottom.
 *
 * Output: MP4 files uploaded to S3, URLs returned.
 *
 * FFmpeg version: 4.4 (Ubuntu 22.04) — line_spacing NOT supported in drawtext.
 * Multi-line text is handled by stacking separate drawtext filters.
 */

import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import https from "https";
import http from "http";
import { storagePut, resolveLocalPath, isLocalUrl } from "./storage";

const execAsync = promisify(exec);

// ─── Config ───────────────────────────────────────────────────────────────────

const SLIDE_WIDTH = 1080;
const SLIDE_HEIGHT = 1920;
const SLIDE_DURATION = 5; // seconds per slide
const FPS = 30;

const HEADLINE_FONT_SIZE = 52;
const SUMMARY_FONT_SIZE = 36;
const BRAND_NAME = "SuggestedByGPT";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Download a URL to a temp file, return the local path. Handles local /uploads/ paths. */
async function downloadToTemp(url: string, ext: string): Promise<string> {
  // Handle local storage paths — just copy the file instead of HTTP request
  if (isLocalUrl(url)) {
    const localPath = resolveLocalPath(url);
    if (!localPath) throw new Error(`Local file not found: ${url}`);
    const tmpFile = path.join(os.tmpdir(), `sbgpt-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
    fs.copyFileSync(localPath, tmpFile);
    return tmpFile;
  }

  const tmpFile = path.join(
    os.tmpdir(),
    `sbgpt-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  );
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(tmpFile);
    protocol
      .get(url, (res) => {
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve(tmpFile);
        });
      })
      .on("error", (err) => {
        fs.unlink(tmpFile, () => {});
        reject(err);
      });
  });
}

/**
 * Escape text for FFmpeg drawtext filter.
 * Handles backslashes, single quotes, colons, and brackets.
 */
function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\n/g, " "); // flatten newlines — we handle multi-line via stacked filters
}

/** Wrap text to fit within a max character width, returns array of lines */
function wrapText(text: string, maxChars = 32): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > maxChars) {
      if (current) lines.push(current.trim());
      current = word;
    } else {
      current = (current + " " + word).trim();
    }
  }
  if (current) lines.push(current.trim());
  return lines;
}

// ─── Cover Slide ──────────────────────────────────────────────────────────────

/**
 * Generate the cover slide (slide 0).
 * Uses a Nano Banana background image with bold headline overlay.
 * Multi-line headline is handled by stacking separate drawtext filters
 * (FFmpeg 4.4 does NOT support line_spacing in drawtext).
 */
export async function generateCoverSlide(params: {
  headline: string;
  brandName?: string;
  backgroundImageUrl?: string;
  slideCount: number;
}): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sbgpt-cover-"));
  const outputPath = path.join(tmpDir, "cover.mp4");

  try {
    const brand = params.brandName ?? BRAND_NAME;
    const headlineLines = wrapText(params.headline.toUpperCase(), 26);

    // ── Inputs ────────────────────────────────────────────────────────────────
    let inputArgs: string;
    let bgFilter: string;

    if (params.backgroundImageUrl) {
      const imgPath = await downloadToTemp(params.backgroundImageUrl, "jpg");
      inputArgs = `-loop 1 -t ${SLIDE_DURATION} -i "${imgPath}"`;
      bgFilter = `[0:v]scale=${SLIDE_WIDTH}:${SLIDE_HEIGHT}:force_original_aspect_ratio=increase,crop=${SLIDE_WIDTH}:${SLIDE_HEIGHT},setsar=1[bg];`;
    } else {
      inputArgs = `-f lavfi -i "color=c=0x0a0a0a:size=${SLIDE_WIDTH}x${SLIDE_HEIGHT}:rate=${FPS}:duration=${SLIDE_DURATION}"`;
      bgFilter = `[0:v]setsar=1[bg];`;
    }

    // ── Filter chain ──────────────────────────────────────────────────────────
    // Build a sequential chain: bg → grad → brand → hl0 → hl1 → ... → cta[out]
    // Each node is named explicitly to avoid any renaming logic bugs.
    const filters: string[] = [];
    filters.push(bgFilter);

    // Dark gradient overlay at bottom 45% for text readability
    const gradY = Math.round(SLIDE_HEIGHT * 0.55);
    const gradH = SLIDE_HEIGHT - gradY;
    filters.push(`[bg]drawbox=x=0:y=${gradY}:w=${SLIDE_WIDTH}:h=${gradH}:color=black@0.80:t=fill[n0];`);

    // Brand name — centered, top 8%
    const brandY = Math.round(SLIDE_HEIGHT * 0.08);
    filters.push(`[n0]drawtext=text='${escapeDrawtext(brand)}':fontsize=36:fontcolor=white@0.7:x=(w-text_w)/2:y=${brandY}:font=sans[n1];`);

    // Headline lines — stacked individually starting at 62% down
    let nodeIdx = 2;
    let yPos = Math.round(SLIDE_HEIGHT * 0.62);
    const lineSpacing = HEADLINE_FONT_SIZE + 16;
    const hlCount = Math.min(headlineLines.length, 4);

    for (let i = 0; i < hlCount; i++) {
      const inNode = `n${nodeIdx - 1}`;
      const outNode = `n${nodeIdx}`;
      filters.push(`[${inNode}]drawtext=text='${escapeDrawtext(headlineLines[i])}':fontsize=${HEADLINE_FONT_SIZE}:fontcolor=white:x=(w-text_w)/2:y=${yPos}:font=sans[${outNode}];`);
      yPos += lineSpacing;
      nodeIdx++;
    }

    // "SWIPE FOR MORE" CTA — 88% down (final node outputs [out])
    const ctaY = Math.round(SLIDE_HEIGHT * 0.88);
    filters.push(`[n${nodeIdx - 1}]drawtext=text='SWIPE FOR MORE':fontsize=32:fontcolor=white@0.8:x=(w-text_w)/2:y=${ctaY}:font=sans[out]`);

    // Join with semicolons (NOT newlines) — FFmpeg needs a single continuous filter string
    const filterComplex = filters.map(f => f.replace(/;\s*$/, '')).join(';');

    const cmd = [
      "ffmpeg -y",
      inputArgs,
      `-filter_complex "${filterComplex}"`,
      `-map "[out]"`,
      `-c:v libx264 -preset fast -crf 23`,
      `-t ${SLIDE_DURATION} -r ${FPS}`,
      `-pix_fmt yuv420p`,
      `"${outputPath}"`,
    ].join(" ");

    await execAsync(cmd, { maxBuffer: 20 * 1024 * 1024 });

    const fileBuffer = fs.readFileSync(outputPath);
    const key = `content-studio/slides/cover-${Date.now()}.mp4`;
    const { url } = await storagePut(key, fileBuffer, "video/mp4");
    return url;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ─── Content Slide ────────────────────────────────────────────────────────────

/**
 * Generate a single content slide with split-screen layout:
 * - Top 45%: black background with numbered headline + summary text
 * - Bottom 55%: Nano Banana image or Kling video (or solid dark bg fallback)
 *
 * Multi-line text handled by stacking separate drawtext filters.
 */
export async function generateContentSlide(params: {
  slideNumber: number;
  totalSlides: number;
  headline: string;
  summary: string;
  videoUrl?: string;
  brandName?: string;
}): Promise<string> {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `sbgpt-slide${params.slideNumber}-`)
  );
  const outputPath = path.join(tmpDir, `slide-${params.slideNumber}.mp4`);

  try {
    const brand = params.brandName ?? BRAND_NAME;
    const topH = Math.round(SLIDE_HEIGHT * 0.45);
    const bottomH = SLIDE_HEIGHT - topH;

    const fullHeadline = `${params.slideNumber}. ${params.headline}`;
    const headlineLines = wrapText(fullHeadline, 30);
    const summaryLines = wrapText(params.summary, 38);

    // ── Inputs ────────────────────────────────────────────────────────────────
    const inputParts: string[] = [];

    // Input 0: black top panel
    inputParts.push(`-f lavfi -i "color=c=black:size=${SLIDE_WIDTH}x${topH}:rate=${FPS}:duration=${SLIDE_DURATION}"`);

    // Input 1: bottom visual (image, video, or fallback dark panel)
    let bottomImagePath: string | null = null;
    let isImageBottom = false;

    if (params.videoUrl) {
      try {
        const isImage =
          /\.(png|jpg|jpeg|webp|gif)(\?|$)/i.test(params.videoUrl) ||
          params.videoUrl.includes("image") ||
          params.videoUrl.includes("generated");

        if (isImage) {
          bottomImagePath = await downloadToTemp(params.videoUrl, "png");
          inputParts.push(`-loop 1 -t ${SLIDE_DURATION} -i "${bottomImagePath}"`);
          isImageBottom = true;
        } else {
          bottomImagePath = await downloadToTemp(params.videoUrl, "mp4");
          inputParts.push(`-i "${bottomImagePath}"`);
          isImageBottom = false;
        }
      } catch {
        // fallback
        inputParts.push(
          `-f lavfi -i "color=c=0x111111:size=${SLIDE_WIDTH}x${bottomH}:rate=${FPS}:duration=${SLIDE_DURATION}"`
        );
      }
    } else {
      inputParts.push(
        `-f lavfi -i "color=c=0x111111:size=${SLIDE_WIDTH}x${bottomH}:rate=${FPS}:duration=${SLIDE_DURATION}"`
      );
    }

    const inputArgs = inputParts.join(" ");

    // ── Filter chain ──────────────────────────────────────────────────────────
    const filters: string[] = [];

    // Scale bottom panel to exact dimensions
    if (isImageBottom) {
      filters.push(
        `[1:v]scale=${SLIDE_WIDTH}:${bottomH}:force_original_aspect_ratio=increase,crop=${SLIDE_WIDTH}:${bottomH},setsar=1,fps=${FPS}[bvid];`
      );
    } else {
      filters.push(
        `[1:v]scale=${SLIDE_WIDTH}:${bottomH}:force_original_aspect_ratio=increase,crop=${SLIDE_WIDTH}:${bottomH},setsar=1,trim=duration=${SLIDE_DURATION},setpts=PTS-STARTPTS[bvid];`
      );
    }

    // Stack top + bottom
    filters.push(`[0:v][bvid]vstack=inputs=2[stacked];`);

    // Slide counter top-right
    const counterText = `${params.slideNumber + 1}/${params.totalSlides}`;
    filters.push(
      `[stacked]drawtext=text='${escapeDrawtext(counterText)}':fontsize=34:fontcolor=white@0.8:x=w-text_w-30:y=30:font=sans[withcounter];`
    );

    // Brand watermark bottom-left of top panel
    filters.push(
      `[withcounter]drawtext=text='${escapeDrawtext(brand)}':fontsize=28:fontcolor=white@0.5:x=30:y=${topH - 50}:font=sans[withbrand];`
    );

    // Headline lines — stacked individually
    let currentNode = "withbrand";
    let yPos = 60;
    const hlSpacing = HEADLINE_FONT_SIZE + 14;
    const hlCount = Math.min(headlineLines.length, 3);

    for (let i = 0; i < hlCount; i++) {
      const nextNode = `hl${i}`;
      filters.push(
        `[${currentNode}]drawtext=text='${escapeDrawtext(headlineLines[i])}':fontsize=${HEADLINE_FONT_SIZE}:fontcolor=white:x=40:y=${yPos}:font=sans[${nextNode}];`
      );
      yPos += hlSpacing;
      currentNode = nextNode;
    }

    // Summary lines — stacked individually
    yPos += 20;
    const sumCount = Math.min(summaryLines.length, 4);

    for (let i = 0; i < sumCount; i++) {
      const nextNode = `sum${i}`;
      filters.push(
        `[${currentNode}]drawtext=text='${escapeDrawtext(summaryLines[i])}':fontsize=${SUMMARY_FONT_SIZE}:fontcolor=white@0.85:x=40:y=${yPos}:font=sans[${nextNode}];`
      );
      yPos += SUMMARY_FONT_SIZE + 10;
      currentNode = nextNode;
    }

    // Rename final node to [out] — remove trailing semicolon and add [out]
    const lastIdx = filters.length - 1;
    filters[lastIdx] = filters[lastIdx].replace(/\[([^\]]+)\];?$/, "[out]");

    // Join with semicolons (NOT newlines) — FFmpeg needs a single continuous filter string
    const filterComplex = filters.map(f => f.replace(/;\s*$/, '')).join(';');

    const cmd = [
      "ffmpeg -y",
      inputArgs,
      `-filter_complex "${filterComplex}"`,
      `-map "[out]"`,
      `-c:v libx264 -preset fast -crf 23`,
      `-t ${SLIDE_DURATION} -r ${FPS}`,
      `-pix_fmt yuv420p`,
      `"${outputPath}"`,
    ].join(" ");

    await execAsync(cmd, { maxBuffer: 20 * 1024 * 1024 });

    const fileBuffer = fs.readFileSync(outputPath);
    const key = `content-studio/slides/slide-${params.slideNumber}-${Date.now()}.mp4`;
    const { url } = await storagePut(key, fileBuffer, "video/mp4");
    return url;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ─── Batch Assembly ───────────────────────────────────────────────────────────

export interface SlideInput {
  slideIndex: number; // 0 = cover
  headline: string;
  summary?: string;
  videoUrl?: string;
  backgroundImageUrl?: string;
}

export interface AssembledSlide {
  slideIndex: number;
  headline: string;
  assembledUrl: string;
  status: "ready";
}

/**
 * Assemble all slides for a content run.
 * Returns assembled slide data with S3 URLs.
 */
export async function assembleSlides(
  slides: SlideInput[],
  brandName = BRAND_NAME
): Promise<AssembledSlide[]> {
  const totalSlides = slides.length;
  const results: AssembledSlide[] = [];

  for (const slide of slides) {
    try {
      let url: string;

      if (slide.slideIndex === 0) {
        url = await generateCoverSlide({
          headline: slide.headline,
          brandName,
          backgroundImageUrl: slide.backgroundImageUrl ?? slide.videoUrl,
          slideCount: totalSlides,
        });
      } else {
        url = await generateContentSlide({
          slideNumber: slide.slideIndex,
          totalSlides,
          headline: slide.headline,
          summary: slide.summary ?? "",
          videoUrl: slide.videoUrl,
          brandName,
        });
      }

      results.push({
        slideIndex: slide.slideIndex,
        headline: slide.headline,
        assembledUrl: url,
        status: "ready",
      });

      console.log(
        `[FFmpegCompositor] Slide ${slide.slideIndex + 1}/${totalSlides} assembled → ${url}`
      );
    } catch (err: any) {
      console.error(
        `[FFmpegCompositor] Failed to assemble slide ${slide.slideIndex}:`,
        err?.message
      );
      // Don't fail the whole run — skip this slide and continue
    }
  }

  return results;
}
