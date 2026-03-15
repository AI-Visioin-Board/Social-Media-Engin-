// ============================================================
// HeyGen API Client — AI Avatar Video Generation
// Produces transparent-background talking head videos
// ============================================================

import { CONFIG } from "../config.js";
import { retry } from "./retry.js";

const BASE_URL = "https://api.heygen.com";

interface HeyGenVideoRequest {
  script: string;
  avatarId?: string;
  lookId?: string;
  voiceId?: string;
}

interface HeyGenVideoResponse {
  videoId: string;
  status: "pending" | "processing" | "completed" | "failed";
  videoUrl?: string;
  duration?: number;
  error?: string;
}

export async function generateAvatarVideo(
  request: HeyGenVideoRequest,
  signal?: AbortSignal,
): Promise<{ videoUrl: string; durationSec: number }> {
  if (!CONFIG.heygenApiKey) {
    throw new Error("[HeyGen] HEYGEN_API_KEY not configured. Get one at https://app.heygen.com/settings?nav=API");
  }

  const avatarId = request.avatarId ?? CONFIG.heygenAvatarId;
  const lookId = request.lookId ?? CONFIG.heygenLookId;
  const voiceId = request.voiceId ?? CONFIG.heygenVoiceId;

  if (!avatarId) {
    throw new Error("[HeyGen] No avatar ID configured. Set HEYGEN_AVATAR_ID in .env");
  }

  // HeyGen v2 API: when using a specific look, pass the look_id AS avatar_id.
  // The look_id IS the specific avatar variant HeyGen renders.
  // The base avatar_id is just for reference/listing — the API routes by look.
  const effectiveAvatarId = lookId || avatarId;

  const character: Record<string, string> = {
    type: "avatar",
    avatar_id: effectiveAvatarId,
    avatar_style: "normal",
  };

  console.log(`[HeyGen] Using avatar_id=${effectiveAvatarId} (base=${avatarId}, look=${lookId || "none"}), voice=${voiceId || "default"}`);

  // Step 1: Create the video
  const createResponse = await fetch(`${BASE_URL}/v2/video/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": CONFIG.heygenApiKey,
    },
    body: JSON.stringify({
      video_inputs: [{
        character,
        voice: {
          type: "text",
          input_text: request.script,
          voice_id: voiceId || undefined,
        },
        background: {
          type: "color",
          value: "#00FF00",  // Green for chroma key — Shotstack luma matte handles masking
        },
      }],
      dimension: {
        width: 1080,
        height: 1920,
      },
      test: false,
    }),
    signal,
  });

  if (!createResponse.ok) {
    const err = await createResponse.text();
    throw new Error(`[HeyGen] Create video failed (${createResponse.status}): ${err}`);
  }

  const createData = await createResponse.json();
  const videoId = createData.data?.video_id;
  if (!videoId) {
    throw new Error(`[HeyGen] No video_id in response: ${JSON.stringify(createData)}`);
  }

  console.log(`[HeyGen] Video created, id: ${videoId}. Polling for completion...`);

  // Step 2: Poll for completion
  const result = await pollVideoStatus(videoId, signal);
  return result;
}

async function pollVideoStatus(
  videoId: string,
  signal?: AbortSignal,
): Promise<{ videoUrl: string; durationSec: number }> {
  const startTime = Date.now();

  while (Date.now() - startTime < CONFIG.heygenTimeoutMs) {
    if (signal?.aborted) throw new Error("[HeyGen] Aborted");

    const response = await fetch(`${BASE_URL}/v1/video_status.get?video_id=${videoId}`, {
      headers: { "X-Api-Key": CONFIG.heygenApiKey },
      signal,
    });

    if (!response.ok) {
      console.warn(`[HeyGen] Poll failed (${response.status}), retrying...`);
      await sleep(CONFIG.heygenPollIntervalMs, signal);
      continue;
    }

    const data = await response.json();
    const status = data.data?.status;

    if (status === "completed") {
      const videoUrl = data.data.video_url;
      const duration = data.data.duration ?? 0;
      console.log(`[HeyGen] Video completed: ${videoUrl} (${duration}s)`);
      return { videoUrl, durationSec: duration };
    }

    if (status === "failed") {
      throw new Error(`[HeyGen] Video generation failed: ${data.data?.error ?? "unknown error"}`);
    }

    console.log(`[HeyGen] Status: ${status}, waiting...`);
    await sleep(CONFIG.heygenPollIntervalMs, signal);
  }

  throw new Error(`[HeyGen] Timed out after ${CONFIG.heygenTimeoutMs / 1000}s`);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("Aborted"));
    }, { once: true });
  });
}
