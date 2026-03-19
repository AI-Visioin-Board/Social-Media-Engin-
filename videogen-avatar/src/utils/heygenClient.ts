// ============================================================
// HeyGen API Client — AI Avatar Video Generation
// Uses dedicated Avatar IV endpoint for best quality
// Produces talking head videos for PIP compositing via Creatomate
// ============================================================

import { CONFIG } from "../config.js";

const BASE_URL = "https://api.heygen.com";

interface HeyGenVideoRequest {
  script: string;
  avatarId?: string;
  lookId?: string;
  voiceId?: string;
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

  if (!lookId && !avatarId) {
    throw new Error("[HeyGen] No avatar/look ID configured. Set HEYGEN_LOOK_ID or HEYGEN_AVATAR_ID in .env");
  }

  // Use the look_id as the effective avatar for the API call
  // HeyGen routes by look_id when available — it's the specific avatar variant
  const effectiveAvatarId = lookId || avatarId;

  console.log(`[HeyGen] Avatar IV — avatar_id=${effectiveAvatarId} (base=${avatarId}, look=${lookId || "none"}), voice=${voiceId || "default"}`);

  // ── Try Avatar IV dedicated endpoint first ──
  // This endpoint produces better quality (matches HeyGen UI output)
  try {
    const result = await createAvatarIVVideo(effectiveAvatarId, request.script, voiceId, signal);
    return result;
  } catch (err: any) {
    console.warn(`[HeyGen] Avatar IV endpoint failed: ${err.message}. Falling back to v2/video/generate...`);
  }

  // ── Fallback to generic v2 endpoint ──
  return createGenericVideo(effectiveAvatarId, request.script, voiceId, signal);
}

// ─── Avatar IV Dedicated Endpoint ───────────────────────────
// POST /v2/video/av4/generate
// Higher quality, custom motion prompts, matches HeyGen UI
async function createAvatarIVVideo(
  avatarId: string,
  script: string,
  voiceId: string,
  signal?: AbortSignal,
): Promise<{ videoUrl: string; durationSec: number }> {
  const body: Record<string, any> = {
    // Required fields for AV4 endpoint
    avatar_id: avatarId,
    video_title: `Quinn_${Date.now()}`,
    script: script,
    voice_id: voiceId,

    // Avatar IV quality settings
    custom_motion_prompt: "Speaking confidently to camera with natural subtle hand gestures. Slight head nods when emphasizing key points. Engaged, warm, and energetic. Natural blinking and eyebrow movement.",
    enhance_custom_motion_prompt: true,

    // Dark background — Creatomate crops to avatar area, no chroma key needed
    background: {
      type: "color",
      value: "#000000",
    },

    // 9:16 for Reels
    dimension: {
      width: 1080,
      height: 1920,
    },
  };

  const response = await fetch(`${BASE_URL}/v2/video/av4/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": CONFIG.heygenApiKey,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`[HeyGen] AV4 create failed (${response.status}): ${err}`);
  }

  const data = await response.json();
  const videoId = data.data?.video_id;
  if (!videoId) {
    throw new Error(`[HeyGen] No video_id in AV4 response: ${JSON.stringify(data)}`);
  }

  console.log(`[HeyGen] Avatar IV video created, id: ${videoId}. Polling...`);
  return pollVideoStatus(videoId, signal);
}

// ─── Generic v2 Endpoint (Fallback) ────────────────────────
async function createGenericVideo(
  avatarId: string,
  script: string,
  voiceId: string,
  signal?: AbortSignal,
): Promise<{ videoUrl: string; durationSec: number }> {
  const response = await fetch(`${BASE_URL}/v2/video/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": CONFIG.heygenApiKey,
    },
    body: JSON.stringify({
      video_inputs: [{
        character: {
          type: "avatar",
          avatar_id: avatarId,
          avatar_style: "normal",
          version: "v2",
        },
        voice: {
          type: "text",
          input_text: script,
          voice_id: voiceId || undefined,
        },
        background: {
          type: "color",
          value: "#000000",
        },
      }],
      dimension: { width: 1080, height: 1920 },
      test: false,
    }),
    signal,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`[HeyGen] Create video failed (${response.status}): ${err}`);
  }

  const data = await response.json();
  const videoId = data.data?.video_id;
  if (!videoId) {
    throw new Error(`[HeyGen] No video_id in response: ${JSON.stringify(data)}`);
  }

  console.log(`[HeyGen] Generic video created, id: ${videoId}. Polling...`);
  return pollVideoStatus(videoId, signal);
}

// ─── Poll for completion ────────────────────────────────────
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
      // Duration may come as seconds or be missing — default to 30s minimum
      const rawDuration = data.data.duration ?? 0;
      const duration = rawDuration > 0 ? rawDuration : 30;
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
