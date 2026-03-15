// ============================================================
// Storage Utility — Convert base64 assets to public URLs
// For Shotstack, all assets need to be publicly accessible URLs
// ============================================================

import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Local uploads directory (same as parent repo pattern)
const UPLOADS_DIR = resolve(__dirname, "../../..", CONFIG.uploadsDir);

/**
 * Save a base64 image to the uploads directory.
 * Returns a path relative to the uploads dir.
 *
 * NOTE: For production (Railway), this would use the parent repo's
 * storagePut() function which handles S3/CDN uploads.
 * For local development, we save to disk and Shotstack will need
 * publicly accessible URLs — so either:
 *   1. Use ngrok to expose local files
 *   2. Upload to a temp hosting service
 *   3. Use Shotstack's asset upload endpoint
 */
export async function saveAsset(
  data: string | Buffer,
  filename: string,
  runId: string,
): Promise<string> {
  const dir = resolve(UPLOADS_DIR, "avatar-runs", runId);
  await mkdir(dir, { recursive: true });

  const filePath = resolve(dir, filename);

  if (typeof data === "string") {
    // Assume base64
    const buffer = Buffer.from(data, "base64");
    await writeFile(filePath, buffer);
  } else {
    await writeFile(filePath, data);
  }

  console.log(`[Storage] Saved: ${filePath}`);
  return filePath;
}

/**
 * Convert a data URI to a local file path.
 * Returns the file path for use with Shotstack asset upload.
 */
export async function dataUriToFile(
  dataUri: string,
  filename: string,
  runId: string,
): Promise<string> {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid data URI");

  const [, , base64Data] = match;
  return saveAsset(base64Data, filename, runId);
}

/**
 * Upload an asset to Shotstack's hosting (stage environment).
 * Returns a public URL that Shotstack can use.
 *
 * Uses Shotstack's Source API to upload and host assets.
 */
export async function uploadToShotstack(
  filePath: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!CONFIG.shotstackApiKey) {
    throw new Error("[Storage] SHOTSTACK_API_KEY required for Shotstack uploads");
  }

  const { readFile } = await import("node:fs/promises");
  const { basename } = await import("node:path");

  const fileBuffer = await readFile(filePath);
  const fileName = basename(filePath);
  const ext = fileName.split(".").pop() ?? "png";
  const contentType = ext === "mp4" ? "video/mp4" : `image/${ext}`;

  const baseUrl = CONFIG.shotstackEnv === "v1"
    ? "https://api.shotstack.io/serve/v1"
    : "https://api.shotstack.io/serve/stage";

  // Step 1: Get upload URL
  const uploadReqRes = await fetch(`${baseUrl}/assets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CONFIG.shotstackApiKey,
    },
    body: JSON.stringify({
      url: `data:${contentType};base64,${fileBuffer.toString("base64")}`,
    }),
    signal,
  });

  if (!uploadReqRes.ok) {
    const err = await uploadReqRes.text();
    throw new Error(`[Storage] Shotstack upload failed (${uploadReqRes.status}): ${err}`);
  }

  const uploadData = await uploadReqRes.json();
  const publicUrl = uploadData.data?.attributes?.url;
  if (!publicUrl) {
    throw new Error(`[Storage] No URL in Shotstack upload response: ${JSON.stringify(uploadData)}`);
  }

  console.log(`[Storage] Uploaded to Shotstack: ${publicUrl}`);
  return publicUrl;
}
