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
 *   │  B-ROLL VIDEO CLIP (bottom ~55%) │  ← Seedance-generated or stock clip
 *   └──────────────────────────────────┘
 *
 * Cover slide layout:
 *   Full-frame image with bold headline text overlay at bottom.
 *
 * Output: MP4 files uploaded to S3, URLs returned.
 */

import { execSync, exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import https from "https";
import http from "http";
import { storagePut } from "./storage";

const execAsync = promisify(exec);

// ─── Config ───────────────────────────────────────────────────────────────────

const SLIDE_WIDTH = 1080;
const SLIDE_HEIGHT = 1920;
const SLIDE_DURATION = 5; // seconds per slide
const FPS = 30;

// Text styling
const HEADLINE_FONT_SIZE = 52;
const SUMMARY_FONT_SIZE = 38;
const TEXT_COLOR = "white";
const BG_COLOR = "black";
const BRAND_NAME = "SuggestedByGPT";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Download a URL to a temp file, return the local path */
async function downloadToTemp(url: string, ext: string): Promise<string> {
  const tmpFile = path.join(os.tmpdir(), `sbgpt-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(tmpFile);
    protocol.get(url, (res) => {
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(tmpFile); });
    }).on("error", (err) => {
      fs.unlink(tmpFile, () => {});
      reject(err);
    });
  });
}

/** Escape text for FFmpeg drawtext filter */
function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

/** Wrap text to fit within a max character width */
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
 * Generate the cover slide (slide 1/N).
 * Uses a dark AI-themed background image with bold headline overlay.
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
    const headlineLines = wrapText(params.headline.toUpperCase(), 28);
    const headlineText = headlineLines.join("\\n");

    let videoInput = "";
    let inputArgs = "";
    let bgFilter = "";

    if (params.backgroundImageUrl) {
      const imgPath = await downloadToTemp(params.backgroundImageUrl, "jpg");
      inputArgs = `-loop 1 -t ${SLIDE_DURATION} -i "${imgPath}"`;
      bgFilter = `[0:v]scale=${SLIDE_WIDTH}:${SLIDE_HEIGHT}:force_original_aspect_ratio=increase,crop=${SLIDE_WIDTH}:${SLIDE_HEIGHT},setsar=1[bg];`;
      videoInput = "[bg]";
    } else {
      // Generate a dark gradient background
      inputArgs = `-f lavfi -i "color=c=0x0a0a0a:size=${SLIDE_WIDTH}x${SLIDE_HEIGHT}:rate=${FPS}:duration=${SLIDE_DURATION}"`;
      bgFilter = `[0:v]setsar=1[bg];`;
      videoInput = "[bg]";
    }

    // Overlay gradient at bottom for text readability
    const gradientFilter = `${videoInput}drawbox=x=0:y=${SLIDE_HEIGHT * 0.55}:w=${SLIDE_WIDTH}:h=${SLIDE_HEIGHT * 0.45}:color=black@0.75:t=fill[withgrad];`;

    // Brand name (centered top area)
    const brandFilter = `[withgrad]drawtext=text='${escapeDrawtext(brand)}':fontsize=36:fontcolor=white@0.7:x=(w-text_w)/2:y=${SLIDE_HEIGHT * 0.08}:font=sans[withbrand];`;

    // Main headline (bottom area)
    const headlineFilter = `[withbrand]drawtext=text='${escapeDrawtext(headlineText)}':fontsize=${HEADLINE_FONT_SIZE}:fontcolor=white:x=(w-text_w)/2:y=${SLIDE_HEIGHT * 0.62}:font=sans:line_spacing=12[withhl];`;

    // "SWIPE FOR MORE" CTA
    const ctaFilter = `[withhl]drawtext=text='SWIPE FOR MORE':fontsize=32:fontcolor=white@0.8:x=(w-text_w)/2:y=${SLIDE_HEIGHT * 0.88}:font=sans[out]`;

    const filterComplex = `${bgFilter}${gradientFilter}${brandFilter}${headlineFilter}${ctaFilter}`;

    const cmd = [
      "ffmpeg -y",
      inputArgs,
      `-filter_complex "${filterComplex}"`,
      `-map "[out]"`,
      `-c:v libx264 -preset fast -crf 23`,
      `-t ${SLIDE_DURATION} -r ${FPS}`,
      `-pix_fmt yuv420p`,
      outputPath,
    ].join(" ");

    await execAsync(cmd);

    // Upload to S3
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
 * - Bottom 55%: B-roll video clip (or solid dark bg if no video)
 */
export async function generateContentSlide(params: {
  slideNumber: number;
  totalSlides: number;
  headline: string;
  summary: string;
  videoUrl?: string;
  brandName?: string;
}): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `sbgpt-slide${params.slideNumber}-`));
  const outputPath = path.join(tmpDir, `slide-${params.slideNumber}.mp4`);

  try {
    const brand = params.brandName ?? BRAND_NAME;
    const topH = Math.round(SLIDE_HEIGHT * 0.45);
    const bottomH = SLIDE_HEIGHT - topH;

    // Headline text (numbered)
    const fullHeadline = `${params.slideNumber}. ${params.headline}`;
    const headlineLines = wrapText(fullHeadline, 34);
    const summaryLines = wrapText(params.summary, 40);

    // Build filter complex
    let inputs = "";
    let filterLines: string[] = [];

    // Input 0: Black top panel
    inputs += `-f lavfi -i "color=c=black:size=${SLIDE_WIDTH}x${topH}:rate=${FPS}:duration=${SLIDE_DURATION}" `;

    // Input 1: Bottom video or dark panel
    let bottomInput = "";
    let bottomVideoPath: string | null = null;
    if (params.videoUrl) {
      try {
        bottomVideoPath = await downloadToTemp(params.videoUrl, "mp4");
        inputs += `-i "${bottomVideoPath}" `;
        bottomInput = `[1:v]scale=${SLIDE_WIDTH}:${bottomH}:force_original_aspect_ratio=increase,crop=${SLIDE_WIDTH}:${bottomH},setsar=1,trim=duration=${SLIDE_DURATION},setpts=PTS-STARTPTS[bvid];`;
      } catch {
        // Fall back to dark panel if video download fails
        inputs += `-f lavfi -i "color=c=0x111111:size=${SLIDE_WIDTH}x${bottomH}:rate=${FPS}:duration=${SLIDE_DURATION}" `;
        bottomInput = `[1:v]setsar=1[bvid];`;
      }
    } else {
      inputs += `-f lavfi -i "color=c=0x111111:size=${SLIDE_WIDTH}x${bottomH}:rate=${FPS}:duration=${SLIDE_DURATION}" `;
      bottomInput = `[1:v]setsar=1[bvid];`;
    }

    filterLines.push(bottomInput);

    // Stack top + bottom panels
    filterLines.push(`[0:v][bvid]vstack=inputs=2[stacked];`);

    // Slide counter (top-right)
    const counterText = `${params.slideNumber + 1}/${params.totalSlides}`;
    filterLines.push(`[stacked]drawtext=text='${escapeDrawtext(counterText)}':fontsize=34:fontcolor=white@0.8:x=w-text_w-30:y=30:font=sans[withcounter];`);

    // Brand watermark (bottom-left of top panel)
    filterLines.push(`[withcounter]drawtext=text='${escapeDrawtext(brand)}':fontsize=28:fontcolor=white@0.5:x=30:y=${topH - 50}:font=sans[withbrand];`);

    // Headline text (top panel, upper area)
    let yOffset = 60;
    let currentNode = "withbrand";
    for (let i = 0; i < Math.min(headlineLines.length, 3); i++) {
      const line = headlineLines[i];
      const nextNode = `hl${i}`;
      filterLines.push(`[${currentNode}]drawtext=text='${escapeDrawtext(line)}':fontsize=${HEADLINE_FONT_SIZE}:fontcolor=white:x=40:y=${yOffset}:font=sans[${nextNode}];`);
      yOffset += HEADLINE_FONT_SIZE + 14;
      currentNode = nextNode;
    }

    // Summary text (below headline)
    yOffset += 20;
    for (let i = 0; i < Math.min(summaryLines.length, 4); i++) {
      const line = summaryLines[i];
      const nextNode = `sum${i}`;
      filterLines.push(`[${currentNode}]drawtext=text='${escapeDrawtext(line)}':fontsize=${SUMMARY_FONT_SIZE}:fontcolor=white@0.85:x=40:y=${yOffset}:font=sans[${nextNode}];`);
      yOffset += SUMMARY_FONT_SIZE + 10;
      currentNode = nextNode;
    }

    // Rename final node to [out]
    // Remove trailing semicolon from last filter and add [out]
    const lastFilter = filterLines[filterLines.length - 1];
    filterLines[filterLines.length - 1] = lastFilter.replace(`[${currentNode}];`, `[out]`);

    const filterComplex = filterLines.join("\n");

    const cmd = [
      "ffmpeg -y",
      inputs.trim(),
      `-filter_complex "${filterComplex}"`,
      `-map "[out]"`,
      `-c:v libx264 -preset fast -crf 23`,
      `-t ${SLIDE_DURATION} -r ${FPS}`,
      `-pix_fmt yuv420p`,
      outputPath,
    ].join(" ");

    await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });

    // Upload to S3
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
  iscover?: boolean;
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
        // Cover slide
        url = await generateCoverSlide({
          headline: slide.headline,
          brandName,
          backgroundImageUrl: slide.backgroundImageUrl,
          slideCount: totalSlides,
        });
      } else {
        // Content slide
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

      console.log(`[FFmpegCompositor] Slide ${slide.slideIndex + 1}/${totalSlides} assembled → ${url}`);
    } catch (err: any) {
      console.error(`[FFmpegCompositor] Failed to assemble slide ${slide.slideIndex}:`, err?.message);
      // Don't fail the whole run — skip this slide
    }
  }

  return results;
}
