/**
 * canvaCompositor.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Assembles @evolving.ai-style Instagram carousel slides using the Canva MCP.
 *
 * Pipeline per slide:
 *   1. Upload the AI-generated image or video URL to Canva (upload-asset-from-url)
 *   2. Generate a full-bleed Instagram post design with the asset + headline
 *      (generate-design with asset_ids)
 *   3. Convert the best candidate to an editable design (create-design-from-candidate)
 *   4. Export as PNG (image slide) or MP4 (video slide) (export-design)
 *   5. Upload the exported file to S3 and return the public URL
 *
 * Style target: @evolving.ai
 *   - Full-bleed background image/video fills entire frame
 *   - Bold ALL-CAPS white headline text with dark gradient overlay
 *   - Minimal, cinematic, no borders or boxes
 *   - Small "SuggestedByGPT" watermark bottom-left
 *
 * Fallback: if any Canva step fails, returns null so the pipeline can
 * fall back to the FFmpeg compositor.
 */

import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import https from "https";
import http from "http";
import { storagePut } from "./storage";

const execAsync = promisify(exec);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CanvaSlideInput {
  slideIndex: number;
  headline: string;
  summary?: string;
  mediaUrl?: string; // URL to Nano Banana image or Kling video
  isVideo?: boolean; // true = Kling MP4, false = still image
  isCover?: boolean;
}

export interface CanvaSlideResult {
  slideIndex: number;
  assembledUrl: string;
  canvaDesignId?: string;
}

// ─── MCP CLI helper ───────────────────────────────────────────────────────────

/**
 * Call a Canva MCP tool and return the parsed JSON result.
 * Throws on non-success status.
 */
async function callCanvaTool(toolName: string, input: Record<string, unknown>, retries = 1): Promise<unknown> {
  const inputJson = JSON.stringify(input).replace(/'/g, "'\\''")
  const cmd = `manus-mcp-cli tool call ${toolName} --server canva --input '${inputJson}'`;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { stdout, stderr } = await execAsync(cmd, { timeout: 180_000 });
      const match = stdout.match(/Tool execution result:\s*\n([\s\S]+)/);
      if (!match) throw new Error(`Canva MCP ${toolName}: no result in output. stderr: ${stderr}`);
      const resultText = match[1].trim();
      if (resultText.startsWith("Error:")) throw new Error(`Canva MCP ${toolName} error: ${resultText}`);
      return JSON.parse(resultText);
    } catch (err: any) {
      lastErr = err;
      if (attempt < retries) {
        console.warn(`[CanvaCompositor] ${toolName} attempt ${attempt + 1} failed, retrying: ${err?.message}`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
  throw lastErr;
}

// ─── Download helper ──────────────────────────────────────────────────────────

async function downloadToTemp(url: string, ext: string): Promise<string> {
  const tmpFile = path.join(
    os.tmpdir(),
    `sbgpt-canva-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  );
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(tmpFile);
    protocol
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => { file.close(); resolve(tmpFile); });
      })
      .on("error", (err) => { fs.unlink(tmpFile, () => {}); reject(err); });
  });
}

// ─── Build the Canva prompt ───────────────────────────────────────────────────

/**
 * Build a detailed generate-design prompt that instructs Canva to produce
 * an @evolving.ai-style full-bleed Instagram post.
 */
function buildCanvaPrompt(headline: string, summary: string, isCover: boolean): string {
  const upperHeadline = headline.toUpperCase();
  const slideType = isCover ? "cover slide" : "content slide";

  return `Create an Instagram carousel ${slideType} in the exact visual style of @evolving.ai (4.1M followers).

CRITICAL DESIGN REQUIREMENTS:
- Full bleed background: the provided image/video fills the ENTIRE frame edge-to-edge, no white space, no borders
- Bold ALL CAPS white headline text: "${upperHeadline}"
- Dark gradient overlay at the bottom 40% of the image so the white text is readable
- Text is centered horizontally, positioned in the lower third of the frame
- Font must be heavy/bold condensed sans-serif (Impact, Bebas Neue, or similar)
- Text size should be very large — dominant visual element
- Small "SuggestedByGPT" watermark in bottom-left corner, tiny and subtle
${!isCover ? '- "SWIPE FOR MORE" text in very small white text at the very bottom center' : ''}
- NO decorative borders, NO card boxes, NO background rectangles behind text (only the gradient overlay)
- Cinematic, dramatic, high-impact visual style
- Color palette: dark/dramatic background with bright white text

CONTENT: ${summary || upperHeadline}

The result should look like a professional viral AI news Instagram post that stops people from scrolling.`;
}

// ─── Core: assemble one slide via Canva ──────────────────────────────────────

/**
 * Assemble a single slide using Canva MCP.
 * Returns the public S3 URL of the exported slide, or null on failure.
 */
export async function assembleSlideWithCanva(
  slide: CanvaSlideInput
): Promise<string | null> {
  const { slideIndex, headline, summary = "", mediaUrl, isVideo = false, isCover = false } = slide;

  console.log(`[CanvaCompositor] Assembling slide ${slideIndex} via Canva...`);

  try {
    // ── Step 1: Upload asset to Canva ──────────────────────────────────────
    let assetId: string | null = null;

    if (mediaUrl) {
      console.log(`[CanvaCompositor] Uploading asset for slide ${slideIndex}: ${mediaUrl.slice(0, 80)}...`);

      // Canva requires a direct HTTP 200 URL (no redirects).
      // If the URL is not already on our CDN/S3, download it and re-upload to S3 first.
      let directUrl = mediaUrl;
      if (!mediaUrl.includes("cloudfront.net") && !mediaUrl.includes("amazonaws.com")) {
        try {
          const ext = isVideo ? "mp4" : "png";
          const tmpFile = await downloadToTemp(mediaUrl, ext);
          const fileBuffer = fs.readFileSync(tmpFile);
          fs.unlink(tmpFile, () => {});
          const contentType = isVideo ? "video/mp4" : "image/png";
          const s3Key = `canva-assets/slide-${slideIndex}-${Date.now()}.${ext}`;
          const { url: s3Url } = await storagePut(s3Key, fileBuffer, contentType);
          directUrl = s3Url;
          console.log(`[CanvaCompositor] Pre-uploaded to S3 for direct Canva access: ${s3Url.slice(0, 80)}...`);
        } catch (preUploadErr: any) {
          console.warn(`[CanvaCompositor] Pre-upload to S3 failed, using original URL: ${preUploadErr?.message}`);
        }
      }

      const uploadResult = await callCanvaTool("upload-asset-from-url", {
        name: `sbgpt-slide-${slideIndex}-${Date.now()}`,
        url: directUrl,
        user_intent: `Upload AI-generated ${isVideo ? "video" : "image"} for SuggestedByGPT Instagram slide ${slideIndex}`,
      }) as any;

      if (uploadResult?.job?.status === "success" && uploadResult?.job?.asset?.id) {
        assetId = uploadResult.job.asset.id;
        console.log(`[CanvaCompositor] Asset uploaded to Canva: ${assetId}`);
      } else {
        console.warn(`[CanvaCompositor] Asset upload failed for slide ${slideIndex}:`, JSON.stringify(uploadResult));
        // Continue without asset — Canva will use a stock image
      }
    }

    // ── Step 2: Generate design ────────────────────────────────────────────
    const prompt = buildCanvaPrompt(headline, summary, isCover);
    const generateInput: Record<string, unknown> = {
      design_type: "instagram_post",
      query: prompt,
      user_intent: `Generate @evolving.ai-style Instagram slide for SuggestedByGPT carousel`,
    };
    if (assetId) {
      generateInput.asset_ids = [assetId];
    }

    console.log(`[CanvaCompositor] Generating design for slide ${slideIndex}...`);
    const generateResult = await callCanvaTool("generate-design", generateInput) as any;

    if (generateResult?.job?.status !== "success") {
      throw new Error(`generate-design failed: ${JSON.stringify(generateResult)}`);
    }

    const candidates: Array<{ candidate_id: string; url: string; thumbnails: Array<{ url: string }> }> =
      generateResult?.job?.result?.generated_designs ?? [];

    if (candidates.length === 0) {
      throw new Error("generate-design returned no candidates");
    }

    const jobId = generateResult?.job?.id;
    // Pick the first candidate (full-bleed style tends to be first)
    const bestCandidate = candidates[0];
    console.log(`[CanvaCompositor] Got ${candidates.length} candidates, using: ${bestCandidate.candidate_id}`);

    // ── Step 3: Convert candidate to editable design ───────────────────────
    const createResult = await callCanvaTool("create-design-from-candidate", {
      job_id: jobId,
      candidate_id: bestCandidate.candidate_id,
      user_intent: "Convert generated design to editable Canva design for export",
    }) as any;

    const designId = createResult?.design_summary?.id;
    if (!designId) {
      throw new Error(`create-design-from-candidate failed: ${JSON.stringify(createResult)}`);
    }
    console.log(`[CanvaCompositor] Design created: ${designId}`);

    // ── Step 4: Export design ──────────────────────────────────────────────
    // For video slides with Kling content, export as MP4; otherwise PNG
    const exportFormat = isVideo ? "mp4" : "png";
    console.log(`[CanvaCompositor] Exporting design ${designId} as ${exportFormat}...`);

    const exportResult = await callCanvaTool("export-design", {
      design_id: designId,
      format: { type: exportFormat },
      user_intent: `Export Instagram slide as ${exportFormat} for SuggestedByGPT carousel`,
    }) as any;

    if (exportResult?.job?.status !== "success") {
      throw new Error(`export-design failed: ${JSON.stringify(exportResult)}`);
    }

    const exportUrls: string[] = exportResult?.job?.urls ?? [];
    if (exportUrls.length === 0) {
      throw new Error("export-design returned no URLs");
    }

    const canvaExportUrl = exportUrls[0];
    console.log(`[CanvaCompositor] Exported: ${canvaExportUrl.slice(0, 80)}...`);

    // ── Step 5: Download and re-upload to S3 for permanent URL ────────────
    // Canva export URLs are temporary (expire in ~24h), so we persist to S3
    const ext = exportFormat === "mp4" ? "mp4" : "png";
    const tmpFile = await downloadToTemp(canvaExportUrl, ext);

    try {
      const fileBuffer = fs.readFileSync(tmpFile);
      const contentType = exportFormat === "mp4" ? "video/mp4" : "image/png";
      const s3Key = `canva-slides/run-${Date.now()}-slide-${slideIndex}.${ext}`;
      const { url: s3Url } = await storagePut(s3Key, fileBuffer, contentType);
      console.log(`[CanvaCompositor] Slide ${slideIndex} uploaded to S3: ${s3Url}`);
      return s3Url;
    } finally {
      fs.unlink(tmpFile, () => {});
    }
  } catch (err: any) {
    console.error(`[CanvaCompositor] Slide ${slideIndex} failed:`, err?.message ?? err);
    return null;
  }
}

// ─── Batch: assemble all slides ───────────────────────────────────────────────

/**
 * Assemble all slides for a run using Canva.
 * Returns an array of results. Slides that fail return null assembledUrl.
 */
export async function assembleSlides(
  slides: CanvaSlideInput[]
): Promise<CanvaSlideResult[]> {
  // Process slides SEQUENTIALLY with a pause between each to avoid Canva rate limits.
  // Parallel calls cause "context deadline exceeded" errors on generate-design.
  console.log(`[CanvaCompositor] Assembling ${slides.length} slides sequentially...`);
  const results: CanvaSlideResult[] = [];
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    try {
      const assembledUrl = await assembleSlideWithCanva(slide);
      if (assembledUrl) {
        results.push({ slideIndex: slide.slideIndex, assembledUrl });
        console.log(`[CanvaCompositor] Slide ${slide.slideIndex} done (${i + 1}/${slides.length})`);
      } else {
        console.warn(`[CanvaCompositor] Slide ${slide.slideIndex} returned null URL — skipping`);
      }
    } catch (err: any) {
      console.warn(`[CanvaCompositor] Slide ${slide.slideIndex} failed: ${err?.message?.slice(0, 100)}`);
    }
    // Pause between slides to stay under Canva rate limits
    if (i < slides.length - 1) {
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  console.log(`[CanvaCompositor] Sequential assembly complete: ${results.length}/${slides.length} slides succeeded`);
  return results;
}
