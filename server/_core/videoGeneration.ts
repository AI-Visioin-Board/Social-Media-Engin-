/**
 * Video generation using Seedance 1 Lite via the Replicate API
 *
 * - generateVideoWithSeedance() → Seedance 1 Lite for short-form vertical video clips
 *
 * Returns null (graceful fallback) when REPLICATE_API_TOKEN is not configured,
 * allowing callers to fall back to alternative video sources without crashing.
 *
 * Example usage:
 *   const url = await generateVideoWithSeedance({
 *     prompt: "A slow zoom into a futuristic city skyline at sunset",
 *     duration: 5,
 *     aspectRatio: "9:16",
 *   });
 */
import { storagePut } from "../storage";
import { ENV } from "./env";

/** Configuration for Seedance video generation */
export type GenerateVideoOptions = {
  /** Descriptive prompt for the video scene */
  prompt: string;
  /** Video duration in seconds (5 or 10). Default: 5 */
  duration?: 5 | 10;
  /** Aspect ratio string. Default: "9:16" (vertical/portrait) */
  aspectRatio?: string;
  /** Starting image URL for image-to-video mode (adds motion to a still frame) */
  imageUrl?: string;
};

/** Replicate prediction status */
type PredictionStatus =
  | "starting"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled";

/** Shape of the Replicate prediction response */
type ReplicatePrediction = {
  id: string;
  status: PredictionStatus;
  output?: string | string[] | null;
  error?: string | null;
  urls?: { get?: string; cancel?: string };
};

const REPLICATE_API_BASE = "https://api.replicate.com/v1";
const SEEDANCE_MODEL = "bytedance/seedance-1-lite";
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 180_000;
const NETWORK_TIMEOUT_MS = 30_000;

/**
 * Generate a short video clip using Seedance 1 Lite on Replicate.
 *
 * Returns the local storage URL of the saved video, or `null` when the
 * Replicate API token is not configured (graceful no-op).
 *
 * @throws {Error} On API errors, polling timeout, or download failures.
 */
export async function generateVideoWithSeedance(
  options: GenerateVideoOptions
): Promise<string | null> {
  const { prompt, duration = 5, aspectRatio = "9:16", imageUrl } = options;

  // --- Guard: no token means graceful fallback -------------------------
  if (!ENV.replicateApiToken) {
    console.log(
      "[VideoGen] REPLICATE_API_TOKEN not set — skipping Seedance generation"
    );
    return null;
  }

  const mode = imageUrl ? "image-to-video" : "text-to-video";
  console.log(
    `[VideoGen] Creating Seedance prediction (${mode}, duration=${duration}s, aspect=${aspectRatio}): "${prompt.slice(0, 100)}${prompt.length > 100 ? "..." : ""}"`
  );

  // --- 1. Create prediction -------------------------------------------
  const prediction = await createPrediction(prompt, duration, aspectRatio, imageUrl);
  console.log(`[VideoGen] Prediction created: ${prediction.id}`);

  // --- 2. Poll until terminal state -----------------------------------
  const completed = await pollPrediction(prediction);

  // --- 3. Extract video URL from output --------------------------------
  const videoUrl = extractVideoUrl(completed);
  console.log(`[VideoGen] Seedance video ready: ${videoUrl}`);

  // --- 4. Download & persist to local storage --------------------------
  const localUrl = await downloadAndStore(videoUrl);
  console.log(`[VideoGen] Video saved to storage: ${localUrl}`);

  return localUrl;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * POST to Replicate to kick off a new Seedance prediction.
 */
async function createPrediction(
  prompt: string,
  duration: 5 | 10,
  aspectRatio: string,
  imageUrl?: string,
): Promise<ReplicatePrediction> {
  // Build input — add image for image-to-video mode
  const input: Record<string, unknown> = {
    prompt,
    duration,
    aspect_ratio: aspectRatio,
  };
  if (imageUrl) {
    input.image = imageUrl; // Seedance image-to-video: adds motion to a starting frame
    console.log(`[VideoGen] Image-to-video mode: starting frame from ${imageUrl.slice(0, 80)}...`);
  }

  const response = await fetch(`${REPLICATE_API_BASE}/predictions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ENV.replicateApiToken}`,
    },
    body: JSON.stringify({
      model: SEEDANCE_MODEL,
      input,
    }),
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Replicate create-prediction failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
    );
  }

  return (await response.json()) as ReplicatePrediction;
}

/**
 * Poll the prediction endpoint until it reaches a terminal state
 * or the timeout expires.
 */
async function pollPrediction(
  prediction: ReplicatePrediction
): Promise<ReplicatePrediction> {
  const getUrl =
    prediction.urls?.get ??
    `${REPLICATE_API_BASE}/predictions/${prediction.id}`;

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let current = prediction;

  while (Date.now() < deadline) {
    // If the creation response itself already has a terminal status, check it
    if (isTerminal(current.status)) {
      break;
    }

    // Wait before the next poll
    await sleep(POLL_INTERVAL_MS);

    const response = await fetch(getUrl, {
      headers: {
        Authorization: `Bearer ${ENV.replicateApiToken}`,
      },
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Replicate poll failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
    }

    current = (await response.json()) as ReplicatePrediction;
    console.log(`[VideoGen] Poll status: ${current.status} (${prediction.id})`);
  }

  // --- Evaluate terminal state ----------------------------------------
  if (current.status === "succeeded") {
    return current;
  }

  if (current.status === "failed" || current.status === "canceled") {
    throw new Error(
      `Seedance prediction ${current.status}: ${current.error ?? "no details"}`
    );
  }

  // Still not terminal — timeout
  throw new Error(
    `Seedance prediction timed out after ${POLL_TIMEOUT_MS / 1_000}s (last status: ${current.status})`
  );
}

/**
 * Extract the usable video URL from a completed prediction.
 * Replicate output can be a string or an array of strings.
 */
function extractVideoUrl(prediction: ReplicatePrediction): string {
  const output = prediction.output;

  if (typeof output === "string" && output.length > 0) {
    return output;
  }

  if (Array.isArray(output) && output.length > 0 && typeof output[0] === "string") {
    return output[0];
  }

  throw new Error(
    `Seedance prediction succeeded but returned unexpected output: ${JSON.stringify(output)}`
  );
}

/**
 * Download the temporary Replicate video URL and persist it to local storage
 * so the URL does not expire.
 */
async function downloadAndStore(videoUrl: string): Promise<string> {
  console.log(`[VideoGen] Downloading video from Replicate...`);

  const response = await fetch(videoUrl, {
    signal: AbortSignal.timeout(60_000), // 60s for large video files
  });

  if (!response.ok) {
    throw new Error(
      `Failed to download Seedance video (${response.status} ${response.statusText})`
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (buffer.length === 0) {
    throw new Error("Downloaded Seedance video is empty (0 bytes)");
  }

  console.log(
    `[VideoGen] Downloaded ${(buffer.length / (1024 * 1024)).toFixed(1)} MB`
  );

  const { url } = await storagePut(
    `generated/${Date.now()}-seedance.mp4`,
    buffer,
    "video/mp4"
  );

  return url;
}

/** Check if a prediction status is terminal */
function isTerminal(status: PredictionStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

/** Promise-based sleep */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
