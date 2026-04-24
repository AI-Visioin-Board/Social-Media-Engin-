/**
 * geminiCompositor.ts
 *
 * HTML templates + Puppeteer slide capture + FFmpeg video overlay.
 * Replaces sharpCompositor, htmlCompositor, coverTemplateCompositor, and videoCompositor.
 *
 * Uses pure inline CSS + Google Fonts in HTML templates — no external CDN dependencies.
 * This ensures reliable rendering in Railway's headless Chromium environment.
 *
 * IMPORTANT: Uses `puppeteer` (full package with bundled Chromium), NOT
 * `puppeteer-core` + `@sparticuz/chromium` which only works on AWS Lambda.
 */

import puppeteer from "puppeteer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

// Use ffmpeg-static if available, fall back to system ffmpeg
const ffmpegPath = (() => {
  if (ffmpegStatic && fs.existsSync(ffmpegStatic)) return ffmpegStatic;
  try {
    return execFileSync("/usr/bin/which", ["ffmpeg"], { encoding: "utf-8" }).trim();
  } catch {
    console.warn("[GeminiCompositor] No ffmpeg found — video compositing will fail");
    return "ffmpeg";
  }
})();
ffmpeg.setFfmpegPath(ffmpegPath);

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
      <link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { width: 1080px; height: 1350px; overflow: hidden; background: #050505; font-family: 'Inter', sans-serif; }
      </style>
    </head>
    <body>
      <div style="position: relative; width: 100%; height: 100%; display: flex; flex-direction: column;">
        <!-- Top 70% Image Zone -->
        <div style="position: absolute; top: 0; left: 0; width: 100%; height: 70%; z-index: 0;">
          <img src="${bgBase64}" style="width: 100%; height: 100%; object-fit: cover; object-position: center 25%;" />
          <!-- Gradient blending into black bottom -->
          <div style="position: absolute; bottom: 0; left: 0; width: 100%; height: 192px; background: linear-gradient(to top, black, transparent);"></div>
        </div>

        <!-- Bottom 40% Solid Black Zone -->
        <div style="position: absolute; bottom: 0; left: 0; width: 100%; height: 40%; background: black; z-index: 10;"></div>

        <!-- Text Content -->
        <div style="position: absolute; bottom: 0; left: 0; width: 100%; z-index: 30; padding: 32px 64px 64px; display: flex; flex-direction: column; align-items: center; text-align: center;">

          <div style="width: 100%; height: 2px; background: rgba(255,255,255,0.3); margin-bottom: 40px; position: relative;">
             <div style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); background: black; padding: 0 16px; color: rgba(255,255,255,0.5); font-size: 20px; font-family: 'Inter', sans-serif; letter-spacing: 0.15em;">Ai</div>
          </div>

          <h1 style="color: white; font-size: 90px; line-height: 1.05; letter-spacing: 0.01em; text-transform: uppercase; width: 100%; font-family: 'Anton', sans-serif; text-shadow: 0 4px 12px rgba(0,0,0,0.5);">
            ${prefix} <span style="color: #00E5FF;">${highlight}</span>
          </h1>

          <div style="width: 100%; display: flex; justify-content: space-between; align-items: center; margin-top: 48px;">
            <div style="display: flex; align-items: center;">
               <span style="color: rgba(255,255,255,0.9); font-size: 28px; font-family: 'Inter', sans-serif; font-weight: 700; letter-spacing: 0.05em;">SuggestedByGPT.com</span>
            </div>
            <div style="display: flex; align-items: center; gap: 12px; background: rgba(0,0,0,0.4); backdrop-filter: blur(12px); border-radius: 9999px; padding: 8px 8px 8px 24px; border: 1px solid rgba(255,255,255,0.1);">
              <span style="color: white; font-size: 20px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; font-family: 'Inter', sans-serif;">Swipe For More</span>
              <div style="width: 48px; height: 48px; border-radius: 50%; background: white; display: flex; align-items: center; justify-content: center;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7" /></svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

// ─── Cover Video Overlay Template (Transparent Top, Cover Styling) ──────────

export function getCoverVideoOverlayHtml(headline: string): string {
  const { prefix, highlight } = splitHeadline(headline);

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { width: 1080px; height: 1350px; overflow: hidden; background: transparent; font-family: 'Inter', sans-serif; }
      </style>
    </head>
    <body>
      <div style="position: relative; width: 100%; height: 100%; display: flex; flex-direction: column;">
        <!-- Top 70% Transparent Zone (video shows through) -->
        <div style="position: absolute; top: 0; left: 0; width: 100%; height: 70%; z-index: 0;">
          <div style="position: absolute; bottom: 0; left: 0; width: 100%; height: 192px; background: linear-gradient(to top, black, transparent);"></div>
        </div>

        <!-- Bottom 40% Solid Black Zone -->
        <div style="position: absolute; bottom: 0; left: 0; width: 100%; height: 40%; background: black; z-index: 10;"></div>

        <!-- Text Content (matches getCoverHtml exactly) -->
        <div style="position: absolute; bottom: 0; left: 0; width: 100%; z-index: 30; padding: 32px 64px 64px; display: flex; flex-direction: column; align-items: center; text-align: center;">

          <div style="width: 100%; height: 2px; background: rgba(255,255,255,0.3); margin-bottom: 40px; position: relative;">
             <div style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); background: black; padding: 0 16px; color: rgba(255,255,255,0.5); font-size: 20px; font-family: 'Inter', sans-serif; letter-spacing: 0.15em;">Ai</div>
          </div>

          <h1 style="color: white; font-size: 90px; line-height: 1.05; letter-spacing: 0.01em; text-transform: uppercase; width: 100%; font-family: 'Anton', sans-serif; text-shadow: 0 4px 12px rgba(0,0,0,0.5);">
            ${prefix} <span style="color: #00E5FF;">${highlight}</span>
          </h1>

          <div style="width: 100%; display: flex; justify-content: space-between; align-items: center; margin-top: 48px;">
            <div style="display: flex; align-items: center;">
               <span style="color: rgba(255,255,255,0.9); font-size: 28px; font-family: 'Inter', sans-serif; font-weight: 700; letter-spacing: 0.05em;">SuggestedByGPT.com</span>
            </div>
            <div style="display: flex; align-items: center; gap: 12px; background: rgba(0,0,0,0.4); backdrop-filter: blur(12px); border-radius: 9999px; padding: 8px 8px 8px 24px; border: 1px solid rgba(255,255,255,0.1);">
              <span style="color: white; font-size: 20px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; font-family: 'Inter', sans-serif;">Swipe For More</span>
              <div style="width: 48px; height: 48px; border-radius: 50%; background: white; display: flex; align-items: center; justify-content: center;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7" /></svg>
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
      <link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { width: 1080px; height: 1350px; overflow: hidden; background: black; font-family: 'Inter', sans-serif; }
      </style>
    </head>
    <body>
      <div style="position: relative; width: 100%; height: 100%; display: flex; flex-direction: column;">

        <!-- Top 55% Image Zone -->
        <div style="position: absolute; top: 0; left: 0; width: 100%; height: 55%; z-index: 0;">
          <img src="${bgBase64}" style="width: 100%; height: 100%; object-fit: cover;" />
          <!-- Gradient fading into the black bottom -->
          <div style="position: absolute; bottom: 0; left: 0; width: 100%; height: 160px; background: linear-gradient(to top, black, transparent);"></div>
        </div>

        <!-- Bottom 45% Text Zone -->
        <div style="position: absolute; bottom: 0; left: 0; width: 100%; height: 45%; background: black; z-index: 10; display: flex; flex-direction: column; align-items: center; padding: 32px 64px 64px; text-align: center;">

          <!-- Divider -->
          <div style="width: 100%; height: 1px; background: rgba(255,255,255,0.2); margin-bottom: 32px;"></div>

          <h1 style="color: white; font-size: 75px; line-height: 1.05; letter-spacing: 0.01em; text-transform: uppercase; width: 100%; font-family: 'Anton', sans-serif; margin-bottom: 24px;">
            ${prefix} <span style="color: #00E5FF;">${highlight}</span>
          </h1>

          <p style="color: rgba(255,255,255,0.8); font-size: 32px; line-height: 1.4; font-family: 'Inter', sans-serif; font-weight: 500; max-width: 90%;">
            ${summary}
          </p>

          <!-- Footer -->
          <div style="width: 100%; display: flex; justify-content: space-between; align-items: center; margin-top: auto;">
            <span style="color: rgba(255,255,255,0.9); font-size: 28px; font-family: 'Inter', sans-serif; font-weight: 700; letter-spacing: 0.05em;">SuggestedByGPT.com</span>
            <span style="color: rgba(255,255,255,0.8); font-size: 24px; font-family: 'Inter', sans-serif; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; display: flex; align-items: center; gap: 8px;">
              Swipe <span style="font-size: 30px;">&#8250;</span>
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
      <link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { width: 1080px; height: 1350px; overflow: hidden; background: transparent; font-family: 'Inter', sans-serif; }
      </style>
    </head>
    <body>
      <div style="position: relative; width: 100%; height: 100%; display: flex; flex-direction: column;">

        <!-- Top 55% Transparent Zone -->
        <div style="position: absolute; top: 0; left: 0; width: 100%; height: 55%; z-index: 0;">
          <!-- Gradient fading into the black bottom -->
          <div style="position: absolute; bottom: 0; left: 0; width: 100%; height: 160px; background: linear-gradient(to top, black, transparent);"></div>
        </div>

        <!-- Bottom 45% Text Zone -->
        <div style="position: absolute; bottom: 0; left: 0; width: 100%; height: 45%; background: black; z-index: 10; display: flex; flex-direction: column; align-items: center; padding: 32px 64px 64px; text-align: center;">

          <!-- Divider -->
          <div style="width: 100%; height: 1px; background: rgba(255,255,255,0.2); margin-bottom: 32px;"></div>

          <h1 style="color: white; font-size: 75px; line-height: 1.05; letter-spacing: 0.01em; text-transform: uppercase; width: 100%; font-family: 'Anton', sans-serif; margin-bottom: 24px;">
            ${prefix} <span style="color: #00E5FF;">${highlight}</span>
          </h1>

          <p style="color: rgba(255,255,255,0.8); font-size: 32px; line-height: 1.4; font-family: 'Inter', sans-serif; font-weight: 500; max-width: 90%;">
            ${summary}
          </p>

          <!-- Footer -->
          <div style="width: 100%; display: flex; justify-content: space-between; align-items: center; margin-top: auto;">
            <span style="color: rgba(255,255,255,0.9); font-size: 28px; font-family: 'Inter', sans-serif; font-weight: 700; letter-spacing: 0.05em;">SuggestedByGPT.com</span>
            <span style="color: rgba(255,255,255,0.8); font-size: 24px; font-family: 'Inter', sans-serif; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; display: flex; align-items: center; gap: 8px;">
              Swipe <span style="font-size: 30px;">&#8250;</span>
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
 * Takes a raw HTML string, loads it in a headless browser,
 * and takes a 1080x1350 screenshot. Returns the image as a base64 data URI.
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

  // STEP 1: Validate buffer is a real MP4 (starts with ftyp box)
  if (!videoBuffer || videoBuffer.length < 1000) {
    throw new Error(`invalid video buffer: ${videoBuffer?.length ?? 0} bytes`);
  }
  // MP4 files have "ftyp" at byte 4
  const ftypCheck = videoBuffer.slice(4, 8).toString("ascii");
  if (ftypCheck !== "ftyp") {
    throw new Error(`buffer is not MP4 (got "${ftypCheck}" at byte 4, size=${videoBuffer.length})`);
  }
  console.log(`[GeminiCompositor] Video buffer: ${videoBuffer.length} bytes, ftyp OK`);

  try {
    fs.writeFileSync(videoPath, videoBuffer);
  } catch (err: any) {
    throw new Error(`video write failed: ${err?.message}`);
  }

  // STEP 2: Generate transparent overlay PNG via Puppeteer
  // Switched from networkidle2 to domcontentloaded — avoids hanging when Google Fonts are slow
  try {
    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      headless: true,
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });
      await page.setContent(overlayHtml, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
      // Give fonts a moment to load but don't block on networkidle
      await new Promise((r) => setTimeout(r, 1500));
      await page.screenshot({
        path: overlayPath,
        type: "png",
        omitBackground: true,
      });
    } finally {
      await browser.close();
    }
  } catch (err: any) {
    // Cleanup video file on Puppeteer failure
    try { if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath); } catch {}
    throw new Error(`puppeteer overlay render failed: ${err?.message}`);
  }

  if (!fs.existsSync(overlayPath) || fs.statSync(overlayPath).size < 100) {
    try { if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath); } catch {}
    throw new Error(`overlay PNG missing or empty: ${overlayPath}`);
  }

  // STEP 3: Composite with FFmpeg
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("FFmpeg processing timed out after 90 seconds"));
    }, 90_000);

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
      .on("error", (err: any) => {
        clearTimeout(timeout);
        console.error("[GeminiCompositor] FFmpeg error:", err);
        try {
          if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
          if (fs.existsSync(overlayPath)) fs.unlinkSync(overlayPath);
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        } catch {}
        reject(new Error(`ffmpeg: ${err?.message ?? String(err)}`));
      });
  });
}
