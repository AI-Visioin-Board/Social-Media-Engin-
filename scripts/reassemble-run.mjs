/**
 * reassemble-run.mjs
 * Re-assembles Canva slides for a stuck run, sequentially (1 at a time).
 * Usage: node scripts/reassemble-run.mjs <runId> [maxSlides]
 */
import { execSync } from "child_process";
import mysql from "mysql2/promise";
import https from "https";
import http from "http";
import fs from "fs";
import os from "os";
import path from "path";

const runId = parseInt(process.argv[2] ?? "120001", 10);
const maxSlides = parseInt(process.argv[3] ?? "4", 10); // default 4 slides (cover + 3 content)
console.log(`[Reassemble] Re-assembling up to ${maxSlides} slides for run #${runId}...`);

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Fetch slides (only up to maxSlides)
const [allSlides] = await conn.execute(
  "SELECT id, slideIndex, headline, summary, videoUrl, assembledUrl FROM generated_slides WHERE runId = ? ORDER BY slideIndex",
  [runId]
);
const slides = allSlides.slice(0, maxSlides);
console.log(`[Reassemble] Processing ${slides.length} slides`);

// ── Storage upload ────────────────────────────────────────────────────────────
async function storagePut(relKey, data, contentType = "application/octet-stream") {
  const baseUrl = process.env.BUILT_IN_FORGE_API_URL.replace(/\/+$/, "");
  const apiKey = process.env.BUILT_IN_FORGE_API_KEY;
  const key = relKey.replace(/^\/+/, "");
  const uploadUrl = new URL(`v1/storage/upload`, baseUrl + "/");
  uploadUrl.searchParams.set("path", key);

  const blob = new Blob([data], { type: contentType });
  const formData = new FormData();
  formData.append("file", blob, key.split("/").pop() ?? key);

  const response = await fetch(uploadUrl.toString(), {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });
  if (!response.ok) {
    const msg = await response.text().catch(() => response.statusText);
    throw new Error(`Storage upload failed (${response.status}): ${msg}`);
  }
  const json = await response.json();
  const url = json.url ?? json.data?.url;
  if (!url) throw new Error(`Storage upload returned no URL: ${JSON.stringify(json)}`);
  return url;
}

// ── Canva MCP call ────────────────────────────────────────────────────────────
function callCanvaTool(toolName, input, retries = 2) {
  // Escape single quotes in the JSON for shell safety
  const inputJson = JSON.stringify(input).replace(/'/g, "'\\''");
  const cmd = `manus-mcp-cli tool call ${toolName} --server canva --input '${inputJson}'`;
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const stdout = execSync(cmd, { timeout: 180_000, encoding: "utf8" });
      const match = stdout.match(/Tool execution result:\s*\n([\s\S]+)/);
      if (!match) throw new Error(`No result in output: ${stdout.slice(0, 200)}`);
      const resultText = match[1].trim();
      if (resultText.startsWith("Error:")) throw new Error(`Canva error: ${resultText}`);
      return JSON.parse(resultText);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        console.warn(`  [${toolName}] Retry ${attempt + 1}/${retries}: ${err.message?.slice(0, 100)}`);
        execSync("sleep 8"); // wait 8s between retries
      }
    }
  }
  throw lastErr;
}

// ── Download helper ───────────────────────────────────────────────────────────
function downloadFile(url, ext) {
  return new Promise((resolve, reject) => {
    const tmpPath = path.join(os.tmpdir(), `reassemble-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
    const file = fs.createWriteStream(tmpPath);
    const proto = url.startsWith("https") ? https : http;
    proto.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlink(tmpPath, () => {});
        downloadFile(res.headers.location, ext).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(tmpPath, () => {});
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(tmpPath); });
    }).on("error", (err) => { fs.unlink(tmpPath, () => {}); reject(err); });
  });
}

// ── Assemble one slide ────────────────────────────────────────────────────────
async function assembleSlide(slide) {
  const { id, slideIndex, headline, summary, videoUrl } = slide;
  console.log(`\n[Slide ${slideIndex}] "${(headline ?? "").slice(0, 70)}"`);

  // Step 1: Upload image to Canva
  let assetId = null;
  if (videoUrl) {
    try {
      // Our CloudFront CDN URLs return direct 200 — Canva can fetch them
      const directUrl = videoUrl;
      console.log(`  Uploading asset to Canva...`);
      const uploadResult = callCanvaTool("upload-asset-from-url", {
        name: `sbgpt-r${runId}-s${slideIndex}-${Date.now()}`,
        url: directUrl,
        user_intent: `Upload AI-generated image for SuggestedByGPT Instagram slide ${slideIndex}`,
      });
      if (uploadResult?.job?.status === "success" && uploadResult?.job?.asset?.id) {
        assetId = uploadResult.job.asset.id;
        console.log(`  Asset ID: ${assetId}`);
      } else {
        console.warn(`  Asset upload returned unexpected result: ${JSON.stringify(uploadResult?.job?.status)}`);
      }
    } catch (err) {
      console.warn(`  Asset upload failed: ${err.message?.slice(0, 100)} — continuing without asset`);
    }
  }

  // Step 2: Generate design
  const isCover = slideIndex === 0;
  const headlineText = (headline ?? "AI NEWS").toUpperCase();
  const summaryText = (summary ?? "").slice(0, 120);

  const prompt = isCover
    ? `Create an Instagram carousel COVER slide in the exact visual style of @evolving.ai (4.1M followers). Full bleed background image fills entire frame edge-to-edge. Bold ALL CAPS white text overlay: "${headlineText}". Dark gradient overlay at bottom 40% so text is readable. Heavy condensed sans-serif font (Impact or Bebas Neue style). Small "SuggestedByGPT" watermark bottom-left corner. NO borders, NO card boxes, NO white space. Cinematic, dramatic, viral AI news style. Instagram portrait 4:5 ratio.`
    : `Create an Instagram carousel CONTENT slide in the exact visual style of @evolving.ai (4.1M followers). Full bleed background image fills entire frame. Bold ALL CAPS white headline text overlay: "${headlineText}". Small body text: "${summaryText}". Dark gradient overlay at bottom so text is readable. Heavy condensed font. Small "SuggestedByGPT" watermark bottom-left. NO borders, NO card boxes. Cinematic viral AI news style. Instagram portrait 4:5 ratio.`;

  const generateInput = {
    design_type: "instagram_post",
    query: prompt,
    user_intent: "Generate @evolving.ai-style Instagram carousel slide for SuggestedByGPT AI news page",
  };
  if (assetId) generateInput.asset_ids = [assetId];

  console.log(`  Generating Canva design...`);
  const generateResult = callCanvaTool("generate-design", generateInput);
  if (generateResult?.job?.status !== "success") {
    throw new Error(`generate-design failed: status=${generateResult?.job?.status}`);
  }
  const candidates = generateResult?.job?.result?.generated_designs ?? [];
  if (!candidates.length) throw new Error("No design candidates returned");
  const jobId = generateResult.job.id;
  console.log(`  Got ${candidates.length} candidates, using first`);

  // Step 3: Create editable design from candidate
  console.log(`  Creating editable design...`);
  const createResult = callCanvaTool("create-design-from-candidate", {
    job_id: jobId,
    candidate_id: candidates[0].candidate_id,
    user_intent: "Convert generated design to editable Canva design for PNG export",
  });
  const designId = createResult?.design_summary?.id;
  if (!designId) throw new Error(`No design ID returned: ${JSON.stringify(createResult)}`);
  console.log(`  Design ID: ${designId}`);

  // Step 4: Export as PNG
  console.log(`  Exporting as PNG...`);
  const exportResult = callCanvaTool("export-design", {
    design_id: designId,
    format: { type: "png" },
    user_intent: "Export Instagram slide as high-quality PNG",
  });
  if (exportResult?.job?.status !== "success") {
    throw new Error(`export-design failed: status=${exportResult?.job?.status}`);
  }
  const exportUrl = exportResult?.job?.urls?.[0];
  if (!exportUrl) throw new Error("export-design returned no URLs");
  console.log(`  Exported: ${exportUrl.slice(0, 70)}...`);

  // Step 5: Download and re-upload to S3 for permanent URL
  console.log(`  Downloading and uploading to S3...`);
  const tmpFile = await downloadFile(exportUrl, "png");
  const fileBuffer = fs.readFileSync(tmpFile);
  fs.unlinkSync(tmpFile);
  const s3Url = await storagePut(
    `canva-slides/run-${runId}-slide-${slideIndex}-${Date.now()}.png`,
    fileBuffer,
    "image/png"
  );
  console.log(`  ✅ S3: ${s3Url.slice(0, 80)}...`);
  return s3Url;
}

// ── Process slides SEQUENTIALLY (1 at a time to avoid Canva rate limits) ─────
let successCount = 0;
for (const slide of slides) {
  try {
    const s3Url = await assembleSlide(slide);
    await conn.execute(
      "UPDATE generated_slides SET assembledUrl = ?, status = 'ready' WHERE id = ?",
      [s3Url, slide.id]
    );
    console.log(`  → Saved to DB ✅`);
    successCount++;
    // Brief pause between slides to avoid Canva rate limits
    if (successCount < slides.length) {
      console.log(`  Waiting 5s before next slide...`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  } catch (err) {
    console.error(`\n❌ Slide ${slide.slideIndex} failed: ${err.message?.slice(0, 150)}`);
  }
}

console.log(`\n[Reassemble] Done: ${successCount}/${slides.length} slides assembled for run #${runId}`);
await conn.end();
process.exit(successCount > 0 ? 0 : 1);
