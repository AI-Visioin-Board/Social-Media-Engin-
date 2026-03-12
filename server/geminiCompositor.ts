/**
 * geminiCompositor.ts
 *
 * HTML templates + Puppeteer slide capture + FFmpeg video overlay.
 * Replaces sharpCompositor, htmlCompositor, coverTemplateCompositor, and videoCompositor.
 *
 * All HTML uses inline CSS (no Tailwind CDN) for Railway container reliability.
 * Google Fonts (Anton + Inter) loaded via <link> tags — works in Puppeteer's Chromium.
 */

import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import fs from "fs";
import path from "path";
import { captureHtmlToImage } from "./screenshot";

ffmpeg.setFfmpegPath(ffmpegStatic!);

// ─── Helpers ────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function splitHeadline(headline: string): { prefix: string; highlight: string } {
  const words = headline.split(" ");
  if (words.length <= 2) return { prefix: "", highlight: headline };
  const highlight = words.slice(-2).join(" ");
  const prefix = words.slice(0, -2).join(" ");
  return { prefix, highlight };
}

// ─── Shared Styles ──────────────────────────────────────────────────────────

const SHARED_HEAD = `
  <link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { width: 1080px; height: 1350px; overflow: hidden; font-family: 'Inter', sans-serif; }
    .font-anton { font-family: 'Anton', sans-serif; }
  </style>
`;

// ─── Cover Template ─────────────────────────────────────────────────────────

export function getCoverHtml(bgBase64: string, headline: string): string {
  const { prefix, highlight } = splitHeadline(headline);

  return `<!DOCTYPE html>
<html>
<head>${SHARED_HEAD}
<style>
  body { background: #050505; }
</style>
</head>
<body>
  <div style="position:relative; width:100%; height:100%; display:flex; flex-direction:column; justify-content:flex-end;">
    <!-- Background Image -->
    <div style="position:absolute; inset:0; z-index:0;">
      <img src="${bgBase64}" style="width:100%; height:100%; object-fit:cover;" />
    </div>

    <!-- Gradient Protection -->
    <div style="position:absolute; bottom:0; left:0; right:0; z-index:20; height:60%; background:linear-gradient(to top, black 0%, rgba(0,0,0,0.8) 50%, transparent 100%);"></div>

    <!-- Text Content -->
    <div style="position:relative; z-index:30; padding:96px 64px 64px 64px; display:flex; flex-direction:column; align-items:center; text-align:center; width:100%;">

      <!-- Divider -->
      <div style="width:100%; height:2px; background:rgba(255,255,255,0.3); margin-bottom:40px; position:relative;">
        <div style="position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); background:black; padding:0 16px; color:rgba(255,255,255,0.5); font-size:20px; letter-spacing:0.15em;">Ai</div>
      </div>

      <!-- Headline -->
      <h1 class="font-anton" style="color:white; font-size:90px; line-height:1.05; letter-spacing:-0.01em; text-transform:uppercase; width:100%; filter:drop-shadow(0 4px 8px rgba(0,0,0,0.5));">
        ${escapeHtml(prefix)} <span style="color:#00E5FF;">${escapeHtml(highlight)}</span>
      </h1>

      <!-- Footer -->
      <div style="width:100%; display:flex; justify-content:space-between; align-items:center; margin-top:48px;">
        <div style="display:flex; align-items:center;">
          <span style="color:rgba(255,255,255,0.9); font-size:28px; font-weight:700; letter-spacing:0.05em;">SuggestedByGPT.com</span>
        </div>
        <div style="display:flex; align-items:center; gap:12px; background:rgba(0,0,0,0.4); backdrop-filter:blur(12px); border-radius:9999px; padding:8px 8px 8px 24px; border:1px solid rgba(255,255,255,0.1);">
          <span style="color:white; font-size:20px; font-weight:700; text-transform:uppercase; letter-spacing:0.1em;">Swipe For More</span>
          <div style="width:48px; height:48px; border-radius:50%; background:white; display:flex; align-items:center; justify-content:center;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ─── Content Slide Template ─────────────────────────────────────────────────

export function getContentHtml(bgBase64: string, headline: string, summary: string): string {
  const { prefix, highlight } = splitHeadline(headline);

  return `<!DOCTYPE html>
<html>
<head>${SHARED_HEAD}
<style>
  body { background: black; }
</style>
</head>
<body>
  <div style="position:relative; width:100%; height:100%; display:flex; flex-direction:column;">

    <!-- Top 55% Image Zone -->
    <div style="position:absolute; top:0; left:0; width:100%; height:55%; z-index:0;">
      <img src="${bgBase64}" style="width:100%; height:100%; object-fit:cover;" />
      <!-- Gradient fade into black bottom -->
      <div style="position:absolute; bottom:0; left:0; right:0; height:160px; background:linear-gradient(to top, black, transparent);"></div>
    </div>

    <!-- Bottom 45% Text Zone -->
    <div style="position:absolute; bottom:0; left:0; width:100%; height:45%; background:black; z-index:10; display:flex; flex-direction:column; align-items:center; padding:32px 64px 64px 64px; text-align:center;">

      <!-- Divider -->
      <div style="width:100%; height:1px; background:rgba(255,255,255,0.2); margin-bottom:32px;"></div>

      <!-- Headline -->
      <h1 class="font-anton" style="color:white; font-size:75px; line-height:1.05; letter-spacing:-0.01em; text-transform:uppercase; width:100%; margin-bottom:24px;">
        ${escapeHtml(prefix)} <span style="color:#00E5FF;">${escapeHtml(highlight)}</span>
      </h1>

      <!-- Summary -->
      <p style="color:rgba(255,255,255,0.8); font-size:32px; line-height:1.4; font-weight:500; max-width:90%;">
        ${escapeHtml(summary)}
      </p>

      <!-- Footer -->
      <div style="width:100%; display:flex; justify-content:space-between; align-items:center; margin-top:auto;">
        <span style="color:rgba(255,255,255,0.9); font-size:28px; font-weight:700; letter-spacing:0.05em;">SuggestedByGPT.com</span>
        <span style="color:rgba(255,255,255,0.8); font-size:24px; font-weight:700; letter-spacing:0.15em; text-transform:uppercase; display:flex; align-items:center; gap:8px;">
          Swipe <span style="font-size:30px;">›</span>
        </span>
      </div>

    </div>
  </div>
</body>
</html>`;
}

// ─── Video Overlay Template (Transparent Top) ───────────────────────────────

export function getVideoOverlayHtml(headline: string, summary: string): string {
  const { prefix, highlight } = splitHeadline(headline);

  return `<!DOCTYPE html>
<html>
<head>${SHARED_HEAD}
<style>
  body { background: transparent; }
</style>
</head>
<body>
  <div style="position:relative; width:100%; height:100%; display:flex; flex-direction:column;">

    <!-- Top 55% Transparent Zone -->
    <div style="position:absolute; top:0; left:0; width:100%; height:55%; z-index:0;">
      <!-- Gradient fading into the black bottom -->
      <div style="position:absolute; bottom:0; left:0; right:0; height:160px; background:linear-gradient(to top, black, transparent);"></div>
    </div>

    <!-- Bottom 45% Text Zone -->
    <div style="position:absolute; bottom:0; left:0; width:100%; height:45%; background:black; z-index:10; display:flex; flex-direction:column; align-items:center; padding:32px 64px 64px 64px; text-align:center;">

      <!-- Divider -->
      <div style="width:100%; height:1px; background:rgba(255,255,255,0.2); margin-bottom:32px;"></div>

      <!-- Headline -->
      <h1 class="font-anton" style="color:white; font-size:75px; line-height:1.05; letter-spacing:-0.01em; text-transform:uppercase; width:100%; margin-bottom:24px;">
        ${escapeHtml(prefix)} <span style="color:#00E5FF;">${escapeHtml(highlight)}</span>
      </h1>

      <!-- Summary -->
      <p style="color:rgba(255,255,255,0.8); font-size:32px; line-height:1.4; font-weight:500; max-width:90%;">
        ${escapeHtml(summary)}
      </p>

      <!-- Footer -->
      <div style="width:100%; display:flex; justify-content:space-between; align-items:center; margin-top:auto;">
        <span style="color:rgba(255,255,255,0.9); font-size:28px; font-weight:700; letter-spacing:0.05em;">SuggestedByGPT.com</span>
        <span style="color:rgba(255,255,255,0.8); font-size:24px; font-weight:700; letter-spacing:0.15em; text-transform:uppercase; display:flex; align-items:center; gap:8px;">
          Swipe <span style="font-size:30px;">›</span>
        </span>
      </div>

    </div>
  </div>
</body>
</html>`;
}

// ─── Slide Compositor (Puppeteer) ───────────────────────────────────────────

/**
 * Render an HTML slide template to a PNG base64 data URI using the
 * existing Puppeteer singleton from screenshot.ts.
 */
export async function compositeGeminiSlide(html: string): Promise<string> {
  const buffer = await captureHtmlToImage(html, {
    width: 1080,
    height: 1350,
    transparent: false,
  });
  return `data:image/png;base64,${buffer.toString("base64")}`;
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

  // Write video to temp file
  fs.writeFileSync(videoPath, videoBuffer);

  // Render transparent overlay PNG via Puppeteer
  const overlayBuffer = await captureHtmlToImage(overlayHtml, {
    width: 1080,
    height: 1350,
    transparent: true,
  });
  fs.writeFileSync(overlayPath, overlayBuffer);

  // Composite with FFmpeg
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("FFmpeg processing timed out after 60 seconds"));
    }, 60_000);

    ffmpeg(videoPath)
      .input(overlayPath)
      .complexFilter([
        // Scale and crop video to 1080x1350
        "[0:v]scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350[bg]",
        // Overlay the PNG
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
        // Clean up temp files
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
        // Clean up on error too
        try {
          if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
          if (fs.existsSync(overlayPath)) fs.unlinkSync(overlayPath);
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        } catch {}
        reject(err);
      });
  });
}
