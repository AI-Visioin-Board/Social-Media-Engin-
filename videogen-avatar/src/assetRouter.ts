// ============================================================
// videogen-avatar — Stage 2: Asset Router
// Takes a VideoScript → returns an AssetManifest
// Pure logic, no API calls. Decides which tool generates each beat's visual.
// ============================================================

import { CONFIG } from "./config.js";
import type {
  VideoScript,
  Beat,
  AssetSource,
  AssetRequest,
  AssetManifest,
  ParallelGroup,
} from "./types.js";

const FALLBACK_CHAINS: Record<AssetSource, AssetSource[]> = {
  nano_banana:      ["kling_t2v", "pexels"],
  kling_t2v:        ["nano_banana", "pexels"],
  kling_i2v:        ["nano_banana"],               // fall back to the still image directly
  pexels:           ["nano_banana"],
  puppeteer_graphic: [],                            // no fallback — we render it ourselves
};

const CONCURRENCY: Record<AssetSource, number> = {
  nano_banana: CONFIG.nanoBananaConcurrency,
  kling_t2v: CONFIG.klingConcurrency,
  kling_i2v: 2,                                     // sequential-ish, depends on Nano Banana
  pexels: CONFIG.pexelsConcurrency,
  puppeteer_graphic: 3,
};

export function routeAssets(script: VideoScript): AssetManifest {
  const requests: AssetRequest[] = [];

  for (const beat of script.beats) {
    const routed = routeBeat(beat);
    requests.push(...routed);
  }

  const parallelGroups = buildParallelGroups(requests);

  return { requests, parallelGroups };
}

function routeBeat(beat: Beat): AssetRequest[] {
  const requests: AssetRequest[] = [];

  switch (beat.visualType) {
    case "named_person": {
      // Step 1: Generate still image of the person via Nano Banana
      const stillRequest: AssetRequest = {
        beatId: beat.id,
        source: "nano_banana",
        prompt: buildPersonPrompt(beat),
        subject: beat.visualSubject,
        aspectRatio: "9:16",
        fallbackChain: FALLBACK_CHAINS.nano_banana,
      };
      requests.push(stillRequest);

      // Step 2: If motion requested, animate via Kling I2V (depends on still)
      if (beat.motionStyle === "ai_video") {
        requests.push({
          beatId: beat.id,
          source: "kling_i2v",
          prompt: buildI2VPrompt(beat),
          subject: beat.visualSubject,
          aspectRatio: "9:16",
          dependsOn: beat.id,  // waits for the nano_banana request above
          fallbackChain: FALLBACK_CHAINS.kling_i2v,
        });
      }
      break;
    }

    case "product_logo_ui":
    case "screen_capture": {
      // Still image via Nano Banana, Ken Burns applied by Shotstack
      requests.push({
        beatId: beat.id,
        source: "nano_banana",
        prompt: beat.visualPrompt,
        aspectRatio: "9:16",
        fallbackChain: FALLBACK_CHAINS.nano_banana,
      });
      break;
    }

    case "cinematic_concept": {
      if (beat.motionStyle === "ai_video") {
        // Full AI video via Kling T2V
        requests.push({
          beatId: beat.id,
          source: "kling_t2v",
          prompt: buildCinematicPrompt(beat),
          aspectRatio: "9:16",
          fallbackChain: FALLBACK_CHAINS.kling_t2v,
        });
      } else {
        // Just a still from Nano Banana
        requests.push({
          beatId: beat.id,
          source: "nano_banana",
          prompt: beat.visualPrompt,
          aspectRatio: "9:16",
          fallbackChain: FALLBACK_CHAINS.nano_banana,
        });
      }
      break;
    }

    case "generic_action": {
      // Stock footage from Pexels
      requests.push({
        beatId: beat.id,
        source: "pexels",
        prompt: buildStockQuery(beat),
        aspectRatio: "9:16",
        fallbackChain: FALLBACK_CHAINS.pexels,
      });
      break;
    }

    case "data_graphic": {
      // Render locally via Puppeteer HTML → PNG
      requests.push({
        beatId: beat.id,
        source: "puppeteer_graphic",
        prompt: beat.visualPrompt,
        aspectRatio: "9:16",
        fallbackChain: FALLBACK_CHAINS.puppeteer_graphic,
      });
      break;
    }
  }

  return requests;
}

function buildParallelGroups(requests: AssetRequest[]): ParallelGroup[] {
  const groups = new Map<AssetSource, number[]>();

  for (const req of requests) {
    // Skip dependent requests — they run after their dependency
    if (req.dependsOn !== undefined) continue;

    const existing = groups.get(req.source) ?? [];
    existing.push(req.beatId);
    groups.set(req.source, existing);
  }

  const result: ParallelGroup[] = [];
  for (const [source, beatIds] of Array.from(groups)) {
    result.push({
      source,
      beatIds,
      maxConcurrent: CONCURRENCY[source as AssetSource],
    });
  }

  return result;
}

// --- Prompt builders ---

function buildPersonPrompt(beat: Beat): string {
  const subject = beat.visualSubject ?? "a person";
  return `Photorealistic portrait of ${subject}. ${beat.visualPrompt}. Vertical 9:16 composition, cinematic lighting, sharp focus, editorial photography style.`;
}

function buildI2VPrompt(beat: Beat): string {
  const subject = beat.visualSubject ?? "the person";
  return `${subject} with subtle natural movement: slight head turn, blinking, breathing. ${beat.visualPrompt}. Smooth cinematic motion, 5 seconds.`;
}

function buildCinematicPrompt(beat: Beat): string {
  return `${beat.visualPrompt}. Cinematic 9:16 vertical composition, dramatic lighting, high production value, 5 seconds of smooth motion.`;
}

function buildStockQuery(beat: Beat): string {
  // Strip AI-specific language for stock footage search
  return beat.visualPrompt
    .replace(/\b(AI|artificial intelligence|neural|algorithm)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    || "technology office";
}

// --- Utilities for the asset generator ---

export function getRequestsForSource(manifest: AssetManifest, source: AssetSource): AssetRequest[] {
  return manifest.requests.filter(r => r.source === source);
}

export function getDependentRequests(manifest: AssetManifest): AssetRequest[] {
  return manifest.requests.filter(r => r.dependsOn !== undefined);
}

export function getIndependentRequests(manifest: AssetManifest): AssetRequest[] {
  return manifest.requests.filter(r => r.dependsOn === undefined);
}
