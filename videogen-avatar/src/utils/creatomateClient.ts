// ============================================================
// Creatomate REST API Client
// Submits RenderScript JSON and polls until video is ready
// Replaces Shotstack for video assembly
// ============================================================

import { CONFIG } from "../config.js";

const API_BASE = "https://api.creatomate.com/v2";

export interface CreatomateRender {
  id: string;
  status: "planned" | "rendering" | "succeeded" | "failed";
  url: string;
  error_message?: string;
}

export async function renderVideo(
  source: Record<string, any>,
  signal?: AbortSignal,
): Promise<{ videoUrl: string }> {
  const apiKey = CONFIG.creatomateApiKey;
  if (!apiKey) {
    throw new Error("[Creatomate] No API key. Set CREATOMATE_API_KEY in env.");
  }

  console.log("[Creatomate] Submitting render...");

  // Submit render
  const response = await fetch(`${API_BASE}/renders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ source }),
    signal,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`[Creatomate] Submit failed (${response.status}): ${err}`);
  }

  const renders: CreatomateRender[] = await response.json();
  const render = Array.isArray(renders) ? renders[0] : renders;

  if (!render?.id) {
    throw new Error("[Creatomate] No render ID returned");
  }

  console.log(`[Creatomate] Render ${render.id} submitted. Polling...`);

  // Poll for completion
  const POLL_INTERVAL = 5_000;
  const MAX_POLLS = 120; // 10 minutes
  let polls = 0;

  while (polls < MAX_POLLS) {
    if (signal?.aborted) {
      throw new Error("[Creatomate] Render aborted");
    }

    await sleep(POLL_INTERVAL, signal);

    const statusRes = await fetch(`${API_BASE}/renders/${render.id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });

    if (!statusRes.ok) {
      console.warn(`[Creatomate] Poll failed (${statusRes.status}), retrying...`);
      polls++;
      continue;
    }

    const status: CreatomateRender = await statusRes.json();
    console.log(`[Creatomate] Status: ${status.status}`);

    if (status.status === "succeeded") {
      console.log(`[Creatomate] Render complete: ${status.url}`);
      return { videoUrl: status.url };
    }

    if (status.status === "failed") {
      throw new Error(`[Creatomate] Render failed: ${status.error_message || "unknown"}`);
    }

    polls++;
  }

  throw new Error("[Creatomate] Render timed out after 10 minutes");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("Aborted"));
      }, { once: true });
    }
  });
}
