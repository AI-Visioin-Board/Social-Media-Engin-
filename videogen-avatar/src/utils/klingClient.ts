// ============================================================
// Kling AI Client — Video Generation (T2V and I2V)
// Text-to-video and Image-to-video for cinematic B-roll
// ============================================================

import { CONFIG } from "../config.js";
import { createHmac } from "node:crypto";

interface KlingVideoResult {
  videoUrl: string;
  durationSec: number;
}

export async function generateTextToVideo(
  prompt: string,
  signal?: AbortSignal,
): Promise<KlingVideoResult> {
  return generateVideo({
    model_name: "kling-v1",
    prompt,
    cfg_scale: 0.5,
    mode: "std",
    aspect_ratio: "9:16",
    duration: "5",
  }, signal);
}

export async function generateImageToVideo(
  imageUrl: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<KlingVideoResult> {
  return generateVideo({
    model_name: "kling-v1",
    prompt,
    image: imageUrl,
    cfg_scale: 0.5,
    mode: "std",
    aspect_ratio: "9:16",
    duration: "5",
  }, signal);
}

async function generateVideo(
  params: Record<string, any>,
  signal?: AbortSignal,
): Promise<KlingVideoResult> {
  if (!CONFIG.klingAccessKey || !CONFIG.klingSecretKey) {
    throw new Error("[Kling] KLING_ACCESS_KEY / KLING_SECRET_KEY not configured");
  }

  const token = generateJWT();

  // Step 1: Create task
  const createResponse = await fetch("https://api.klingai.com/v1/videos/text2video", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
    signal,
  });

  if (!createResponse.ok) {
    const err = await createResponse.text();
    throw new Error(`[Kling] Create task failed (${createResponse.status}): ${err}`);
  }

  const createData = await createResponse.json();
  const taskId = createData.data?.task_id;
  if (!taskId) {
    throw new Error(`[Kling] No task_id in response: ${JSON.stringify(createData)}`);
  }

  console.log(`[Kling] Task created: ${taskId}. Polling...`);

  // Step 2: Poll
  return pollTaskStatus(taskId, token, signal);
}

async function pollTaskStatus(
  taskId: string,
  token: string,
  signal?: AbortSignal,
): Promise<KlingVideoResult> {
  const startTime = Date.now();

  while (Date.now() - startTime < CONFIG.klingTimeoutMs) {
    if (signal?.aborted) throw new Error("[Kling] Aborted");

    const response = await fetch(
      `https://api.klingai.com/v1/videos/text2video/${taskId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      },
    );

    if (!response.ok) {
      console.warn(`[Kling] Poll failed (${response.status}), retrying...`);
      await sleep(CONFIG.klingPollIntervalMs, signal);
      continue;
    }

    const data = await response.json();
    const status = data.data?.task_status;

    if (status === "succeed") {
      const videoUrl = data.data.task_result?.videos?.[0]?.url;
      if (!videoUrl) throw new Error("[Kling] Task succeeded but no video URL");
      console.log(`[Kling] Video ready: ${videoUrl}`);
      return { videoUrl, durationSec: 5 };
    }

    if (status === "failed") {
      throw new Error(`[Kling] Task failed: ${data.data?.task_status_msg ?? "unknown"}`);
    }

    console.log(`[Kling] Status: ${status}, waiting...`);
    await sleep(CONFIG.klingPollIntervalMs, signal);
  }

  throw new Error(`[Kling] Timed out after ${CONFIG.klingTimeoutMs / 1000}s`);
}

function generateJWT(): string {
  // Kling uses a simple JWT with access_key/secret_key
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: CONFIG.klingAccessKey,
    exp: now + 1800,
    nbf: now - 5,
  })).toString("base64url");

  const signature = createHmac("sha256", CONFIG.klingSecretKey)
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
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
