// ============================================================
// Veo 3.1 Image-to-Video Client
// Takes a Nano Banana still image → animates it with Veo 3.1 Fast
// Produces 5-second video clips (plenty for 2-3s sub-clips)
//
// Uses @google/genai SDK (same as parent repo's geminiEngine.ts)
// Falls back gracefully — caller keeps the still image if Veo fails
// ============================================================

import { GoogleGenAI } from "@google/genai";
import { CONFIG } from "../config.js";

const VEO_MODEL = "veo-3.1-fast-generate-001";
const POLL_INTERVAL_MS = 10_000;  // 10s between polls
const MAX_POLLS = 60;              // 10 minutes max

export interface VeoResult {
  videoBuffer: Buffer;
  durationSec: number;
  mimeType: string;
}

let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (_client) return _client;
  if (!CONFIG.geminiApiKey) {
    throw new Error("[Veo] GEMINI_API_KEY not configured");
  }
  _client = new GoogleGenAI({ apiKey: CONFIG.geminiApiKey });
  return _client;
}

/**
 * Animate a Nano Banana still image using Veo 3.1 Fast.
 * Returns a 5-second video buffer.
 *
 * @param imageBase64 — raw base64 image data (NOT a data URI)
 * @param mimeType — e.g. "image/png" or "image/jpeg"
 * @param prompt — motion/animation guidance prompt
 * @param signal — optional AbortSignal
 */
export async function animateImage(
  imageBase64: string,
  mimeType: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<VeoResult> {
  const ai = getClient();

  console.log(`[Veo] Starting image-to-video animation...`);

  let operation = await ai.models.generateVideos({
    model: VEO_MODEL,
    prompt,
    image: {
      imageBytes: imageBase64,
      mimeType,
    },
    config: {
      numberOfVideos: 1,
      durationSeconds: 5,
      aspectRatio: "9:16",
    },
  });

  // Poll until done
  let polls = 0;
  while (!operation.done) {
    if (signal?.aborted) throw new Error("[Veo] Aborted");
    if (polls++ >= MAX_POLLS) throw new Error("[Veo] Timed out waiting for video generation");

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    operation = await ai.operations.getVideosOperation({ operation });

    if (polls % 3 === 0) {
      console.log(`[Veo] Still generating... (${polls * POLL_INTERVAL_MS / 1000}s elapsed)`);
    }
  }

  if (operation.error) {
    throw new Error(`[Veo] Generation failed: ${operation.error.message || JSON.stringify(operation.error)}`);
  }

  const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!videoUri) {
    throw new Error("[Veo] No video URI in response");
  }

  // Download the video
  console.log(`[Veo] Downloading generated video...`);
  const response = await fetch(videoUri, {
    headers: { "x-goog-api-key": CONFIG.geminiApiKey },
    signal,
  });

  if (!response.ok) {
    throw new Error(`[Veo] Video download failed: HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  console.log(`[Veo] Image-to-video complete (5s clip, ${(arrayBuffer.byteLength / 1024 / 1024).toFixed(1)}MB)`);

  return {
    videoBuffer: Buffer.from(arrayBuffer),
    durationSec: 5,
    mimeType: "video/mp4",
  };
}
