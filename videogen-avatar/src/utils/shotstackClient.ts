// ============================================================
// Shotstack API Client — Cloud Video Assembly
// Renders the final composed video from JSON edit spec
// ============================================================

import { CONFIG } from "../config.js";
import type { ShotstackEdit } from "../types.js";

const ENDPOINTS = {
  stage: "https://api.shotstack.io/stage",
  v1: "https://api.shotstack.io/v1",
};

interface RenderResponse {
  renderId: string;
  status: string;
  url?: string;
}

export async function renderVideo(
  edit: ShotstackEdit,
  signal?: AbortSignal,
): Promise<{ videoUrl: string }> {
  if (!CONFIG.shotstackApiKey) {
    throw new Error("[Shotstack] SHOTSTACK_API_KEY not configured. Get one at https://dashboard.shotstack.io");
  }

  const baseUrl = ENDPOINTS[CONFIG.shotstackEnv];

  // Step 1: Submit render
  const response = await fetch(`${baseUrl}/render`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CONFIG.shotstackApiKey,
    },
    body: JSON.stringify(edit),
    signal,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`[Shotstack] Render submit failed (${response.status}): ${err}`);
  }

  const data = await response.json();
  const renderId = data.response?.id;
  if (!renderId) {
    throw new Error(`[Shotstack] No render ID in response: ${JSON.stringify(data)}`);
  }

  console.log(`[Shotstack] Render submitted, id: ${renderId}. Polling...`);

  // Step 2: Poll for completion
  return pollRenderStatus(renderId, baseUrl, signal);
}

async function pollRenderStatus(
  renderId: string,
  baseUrl: string,
  signal?: AbortSignal,
): Promise<{ videoUrl: string }> {
  const startTime = Date.now();
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 5;

  while (Date.now() - startTime < CONFIG.shotstackTimeoutMs) {
    if (signal?.aborted) throw new Error("[Shotstack] Aborted");

    const response = await fetch(`${baseUrl}/render/${renderId}`, {
      headers: { "x-api-key": CONFIG.shotstackApiKey },
      signal,
    });

    if (!response.ok) {
      consecutiveErrors++;
      console.warn(`[Shotstack] Poll failed (${response.status}), attempt ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}`);
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        throw new Error(`[Shotstack] Polling failed ${MAX_CONSECUTIVE_ERRORS} times consecutively (last status: ${response.status})`);
      }
      await sleep(CONFIG.shotstackPollIntervalMs, signal);
      continue;
    }
    consecutiveErrors = 0;

    const data = await response.json();
    const status = data.response?.status;

    if (status === "done") {
      const videoUrl = data.response.url;
      console.log(`[Shotstack] Render complete: ${videoUrl}`);
      return { videoUrl };
    }

    if (status === "failed") {
      throw new Error(`[Shotstack] Render failed: ${data.response?.error ?? "unknown"}`);
    }

    console.log(`[Shotstack] Status: ${status}, waiting...`);
    await sleep(CONFIG.shotstackPollIntervalMs, signal);
  }

  throw new Error(`[Shotstack] Timed out after ${CONFIG.shotstackTimeoutMs / 1000}s`);
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
