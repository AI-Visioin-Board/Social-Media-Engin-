/**
 * geminiCompositor.ts
 *
 * HTML templates + Puppeteer slide capture + FFmpeg video overlay.
 * Replaces sharpCompositor, htmlCompositor, coverTemplateCompositor, and videoCompositor.
 *
 * Uses Tailwind CDN + Google Fonts in HTML templates — exactly matching the
 * reference Gemini pipeline implementation.
 *
 * IMPORTANT: Uses `puppeteer` (full package with bundled Chromium), NOT
 * `puppeteer-core` + `@sparticuz/chromium` which only works on AWS Lambda.
 */

import puppeteer from "puppeteer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import fs from "fs";
import path from "path";

ffmpeg.setFfmpegPath(ffmpegStatic!);

// ─── Helpers ────────────────────────────────────────────────────────────────

function splitHeadline(headline: string): { prefix: string; highlight: string } {
  const words = headline.split(" ");
  if (words.length <= 2) return { prefix: "", highlight: headline };
  const highlight = words.slice(-2).join(" ");
  const prefix = words.slice(0, -2).join(" ");
  return { prefix, highlight };
}

// ─── Cover Template ─────────────────────────────────────────────────────────

export function getCoverHtml(bgBase64: string, headline: string): string {
  const { prefix, highlight } = splitHeadline(headline);

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
        body { margin: 0; padding: 0; width: 1080px; height: 1350px; overflow: hidden; background: #050505; }
        .font-anton { font-family: 'Anton', sans-serif; }
        .font-inter { font-family: 'Inter', sans-serif; }
      </style>
    </head>
    <body>
      <div class="relative w-full h-full flex flex-col">
        <!-- Top 70% Image Zone — object-position top so subjects stay visible -->
        <div class="absolute top-0 left-0 w-full h-[70%] z-0">
          <img src="${bgBase64}" class="w-full h-full object-cover" style="object-position: center 25%;" />
          <!-- Smooth gradient blending into the black bottom -->
          <div class="absolute bottom-0 left-0 w-full h-48 bg-gradient-to-t from-black to-transparent"></div>
        </div>

        <!-- Bottom 40% Solid Black Text Zone (overlaps image slightly for blended look) -->
        <div class="absolute bottom-0 left-0 w-full h-[40%] bg-black z-10"></div>

        <!-- Text Content (overlays the boundary) -->
        <div class="absolute bottom-0 left-0 w-full z-30 px-16 pb-16 pt-8 flex flex-col items-center text-center">

          <div class="w-full h-[2px] bg-white/30 mb-10 relative">
             <div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-black px-4 text-white/50 text-xl font-inter tracking-widest">Ai</div>
          </div>

          <h1 class="text-white text-[90px] leading-[1.05] tracking-tight uppercase w-full font-anton drop-shadow-2xl">
            ${prefix} <span class="text-[#00E5FF]">${highlight}</span>
          </h1>

          <div class="w-full flex justify-between items-center mt-12">
            <div class="flex items-center">
               <span class="text-white/90 text-[28px] font-inter font-bold tracking-wide">SuggestedByGPT.com</span>
            </div>
            <div class="flex items-center gap-3 bg-black/40 backdrop-blur-md rounded-full pl-6 pr-2 py-2 border border-white/10">
              <span class="text-white text-xl font-bold uppercase tracking-wider font-inter">Swipe For More</span>
              <div class="w-12 h-12 rounded-full bg-white flex items-center justify-center">
                <svg class="w-6 h-6 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

// ─── Content Slide Template ─────────────────────────────────────────────────

export function getContentHtml(bgBase64: string, headline: string, summary: string): string {
  const { prefix, highlight } = splitHeadline(headline);

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
        body { margin: 0; padding: 0; width: 1080px; height: 1350px; overflow: hidden; background: black; }
        .font-anton { font-family: 'Anton', sans-serif; }
        .font-inter { font-family: 'Inter', sans-serif; }
      </style>
    </head>
    <body>
      <div class="relative w-full h-full flex flex-col">

        <!-- Top 55% Image Zone -->
        <div class="absolute top-0 left-0 w-full h-[55%] z-0">
          <img src="${bgBase64}" class="w-full h-full object-cover" />
          <!-- Gradient fading into the black bottom -->
          <div class="absolute inset-0 bg-gradient-to-t from-black to-transparent h-40 mt-auto"></div>
        </div>

        <!-- Bottom 45% Text Zone -->
        <div class="absolute bottom-0 left-0 w-full h-[45%] bg-black z-10 flex flex-col items-center px-16 pb-16 pt-8 text-center">

          <!-- Divider -->
          <div class="w-full h-[1px] bg-white/20 mb-8"></div>

          <h1 class="text-white text-[75px] leading-[1.05] tracking-tight uppercase w-full font-anton mb-6">
            ${prefix} <span class="text-[#00E5FF]">${highlight}</span>
          </h1>

          <p class="text-white/80 text-[32px] leading-snug font-inter font-medium max-w-[90%]">
            ${summary}
          </p>

          <!-- Footer -->
          <div class="w-full flex justify-between items-center mt-auto">
            <span class="text-white/90 text-[28px] font-inter font-bold tracking-wide">SuggestedByGPT.com</span>
            <span class="text-white/80 text-2xl font-inter font-bold tracking-widest uppercase flex items-center gap-2">
              Swipe <span class="text-3xl">›</span>
            </span>
          </div>

        </div>
      </div>
    </body>
    </html>
  `;
}

// ─── Video Overlay Template (Transparent Top) ───────────────────────────────

export function getVideoOverlayHtml(headline: string, summary: string): string {
  const { prefix, highlight } = splitHeadline(headline);

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
        body { margin: 0; padding: 0; width: 1080px; height: 1350px; overflow: hidden; background: transparent; }
        .font-anton { font-family: 'Anton', sans-serif; }
        .font-inter { font-family: 'Inter', sans-serif; }
      </style>
    </head>
    <body>
      <div class="relative w-full h-full flex flex-col">

        <!-- Top 55% Transparent Zone -->
        <div class="absolute top-0 left-0 w-full h-[55%] z-0">
          <!-- Gradient fading into the black bottom -->
          <div class="absolute inset-0 bg-gradient-to-t from-black to-transparent h-40 mt-auto"></div>
        </div>

        <!-- Bottom 45% Text Zone -->
        <div class="absolute bottom-0 left-0 w-full h-[45%] bg-black z-10 flex flex-col items-center px-16 pb-16 pt-8 text-center">

          <!-- Divider -->
          <div class="w-full h-[1px] bg-white/20 mb-8"></div>

          <h1 class="text-white text-[75px] leading-[1.05] tracking-tight uppercase w-full font-anton mb-6">
            ${prefix} <span class="text-[#00E5FF]">${highlight}</span>
          </h1>

          <p class="text-white/80 text-[32px] leading-snug font-inter font-medium max-w-[90%]">
            ${summary}
          </p>

          <!-- Footer -->
          <div class="w-full flex justify-between items-center mt-auto">
            <span class="text-white/90 text-[28px] font-inter font-bold tracking-wide">SuggestedByGPT.com</span>
            <span class="text-white/80 text-2xl font-inter font-bold tracking-widest uppercase flex items-center gap-2">
              Swipe <span class="text-3xl">›</span>
            </span>
          </div>

        </div>
      </div>
    </body>
    </html>
  `;
}

// ─── Slide Compositor (Puppeteer) ───────────────────────────────────────────

/**
 * Takes a raw HTML string (with Tailwind CDN), loads it in a headless browser,
 * and takes a 1080x1350 screenshot. Returns the image as a base64 data URI.
 *
 * Matches the reference Gemini pipeline: uses full `puppeteer` package
 * (bundles Chromium), launches per call, JPEG output, networkidle2.
 */
export async function compositeGeminiSlide(html: string): Promise<string> {
  const browser = await puppeteer.launch({
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });
    await page.setContent(html, {
      waitUntil: "networkidle2",
      timeout: 30_000,
    });

    const buffer = await page.screenshot({
      type: "jpeg",
      quality: 90,
    });

    return `data:image/jpeg;base64,${Buffer.from(buffer).toString("base64")}`;
  } finally {
    await browser.close();
  }
}

// ─── Video Compositor (FFmpeg) ──────────────────────────────────────────────

/**
 * Composite a video with an HTML text overlay.
 * 1. Renders the overlay HTML as a transparent PNG via Puppeteer
 * 2. Uses FFmpeg to scale/crop the video to 1080x1350 and overlay the PNG
 *
 * Returns a base64 data URI for the composited video.
 */
export async function compositeGeminiVideo(
  videoBuffer: Buffer,
  overlayHtml: string,
): Promise<string> {
  const tempDir = path.join(process.cwd(), "temp");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const ts = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const videoPath = path.join(tempDir, `input_${ts}.mp4`);
  const overlayPath = path.join(tempDir, `overlay_${ts}.png`);
  const outputPath = path.join(tempDir, `output_${ts}.mp4`);

  fs.writeFileSync(videoPath, videoBuffer);

  // 1. Generate transparent overlay PNG via Puppeteer
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });
    await page.setContent(overlayHtml, {
      waitUntil: "networkidle2",
      timeout: 30_000,
    });
    await page.screenshot({
      path: overlayPath,
      type: "png",
      omitBackground: true,
    });
  } finally {
    await browser.close();
  }

  // 2. Composite with FFmpeg
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("FFmpeg processing timed out after 60 seconds"));
    }, 60_000);

    ffmpeg(videoPath)
      .input(overlayPath)
      .complexFilter([
        "[0:v]scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350[bg]",
        "[bg][1:v]overlay=0:0[outv]",
      ])
      .outputOptions([
        "-map [outv]",
        "-map 0:a?",
        "-c:v libx264",
        "-preset fast",
        "-crf 23",
        "-pix_fmt yuv420p",
        "-movflags +faststart",
      ])
      .save(outputPath)
      .on("end", () => {
        clearTimeout(timeout);
        const outBuffer = fs.readFileSync(outputPath);
        try {
          fs.unlinkSync(videoPath);
          fs.unlinkSync(overlayPath);
          fs.unlinkSync(outputPath);
        } catch (e) {
          console.error("[GeminiCompositor] Cleanup error:", e);
        }
        resolve(`data:video/mp4;base64,${outBuffer.toString("base64")}`);
      })
      .on("error", (err) => {
        clearTimeout(timeout);
        console.error("[GeminiCompositor] FFmpeg error:", err);
        try {
          if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
          if (fs.existsSync(overlayPath)) fs.unlinkSync(overlayPath);
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        } catch {}
        reject(err);
      });
  });
}
