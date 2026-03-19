// ============================================================
// videogen-avatar — Stage 2: Asset Router
// Takes a VideoScript → returns an AssetManifest
// Pure logic, no API calls. Decides which tool generates each beat's visual.
//
// ROUTING STRATEGY (updated):
// - Nano Banana stills → Veo 3.1 image-to-video animation (5s clips)
//   * Veo failure degrades gracefully to still + Ken Burns in Creatomate
// - Pexels stock footage for generic_action beats (real footage)
// - Kling REMOVED from routing — output quality too low (smeared text, unclear)
// - Puppeteer graphics not yet implemented, falls back to Nano Banana
// ============================================================

import { CONFIG } from "./config.js";
import type {
  VideoScript,
  Beat,
  LayoutMode,
  AssetSource,
  AssetRequest,
  AssetManifest,
  ParallelGroup,
} from "./types.js";

/**
 * Pick the right generation aspect ratio based on how the beat will be displayed:
 * - "pip" → b-roll sits in a roughly square "TV frame" (top 55%, 92% width) → 1:1
 * - "fullscreen_broll" → fills the entire 1080×1920 canvas → 9:16
 * - "avatar_closeup" / "text_card" → no b-roll generated, but default to 9:16
 */
function aspectRatioForLayout(layout: LayoutMode): "9:16" | "1:1" {
  return layout === "pip" ? "1:1" : "9:16";
}

// Fallback chains — Kling removed, everything degrades to Nano Banana → Pexels
const FALLBACK_CHAINS: Record<AssetSource, AssetSource[]> = {
  nano_banana:       ["pexels"],
  kling_t2v:         ["nano_banana", "pexels"],  // kept for type safety, not routed to
  kling_i2v:         ["nano_banana"],             // kept for type safety, not routed to
  pexels:            ["nano_banana"],
  puppeteer_graphic: ["nano_banana", "pexels"],
};

const CONCURRENCY: Record<AssetSource, number> = {
  nano_banana: CONFIG.nanoBananaConcurrency,
  kling_t2v: CONFIG.klingConcurrency,
  kling_i2v: 2,
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

  console.log(`[AssetRouter] ${requests.length} asset requests from ${script.beats.length} beats`);
  const sources = [...new Set(requests.map(r => r.source))];
  console.log(`[AssetRouter] Sources: ${sources.join(", ")}`);

  return { requests, parallelGroups };
}

function routeBeat(beat: Beat): AssetRequest[] {
  const requests: AssetRequest[] = [];

  // Text card beats render as pure Creatomate text — no asset needed
  if (beat.layout === "text_card") {
    return requests;
  }

  switch (beat.visualType) {
    case "named_person": {
      // Sharp Nano Banana still of the person — Creatomate adds Ken Burns motion
      requests.push({
        beatId: beat.id,
        source: "nano_banana",
        prompt: buildPersonPrompt(beat),
        subject: beat.visualSubject,
        aspectRatio: aspectRatioForLayout(beat.layout),
        fallbackChain: FALLBACK_CHAINS.nano_banana,
      });
      // NO Kling I2V — quality too low, smears faces/text
      break;
    }

    case "product_logo_ui":
    case "screen_capture": {
      // Still image via Nano Banana — sharp text and logos
      requests.push({
        beatId: beat.id,
        source: "nano_banana",
        prompt: buildProductPrompt(beat),
        aspectRatio: aspectRatioForLayout(beat.layout),
        fallbackChain: FALLBACK_CHAINS.nano_banana,
      });
      break;
    }

    case "cinematic_concept": {
      // Nano Banana still — even for "ai_video" motionStyle
      // Ken Burns zoom/pan in Creatomate provides enough motion for 2-3s sub-clips
      requests.push({
        beatId: beat.id,
        source: "nano_banana",
        prompt: buildCinematicPrompt(beat),
        aspectRatio: aspectRatioForLayout(beat.layout),
        fallbackChain: FALLBACK_CHAINS.nano_banana,
      });
      break;
    }

    case "generic_action": {
      // Real stock footage from Pexels — authentic, high quality
      requests.push({
        beatId: beat.id,
        source: "pexels",
        prompt: buildStockQuery(beat),
        aspectRatio: aspectRatioForLayout(beat.layout),
        fallbackChain: FALLBACK_CHAINS.pexels,
      });
      break;
    }

    case "data_graphic": {
      // Puppeteer not implemented — route to Nano Banana directly
      // Nano Banana can generate infographic-style images
      requests.push({
        beatId: beat.id,
        source: "nano_banana",
        prompt: buildDataGraphicPrompt(beat),
        aspectRatio: aspectRatioForLayout(beat.layout),
        fallbackChain: FALLBACK_CHAINS.nano_banana,
      });
      break;
    }
  }

  return requests;
}

function buildParallelGroups(requests: AssetRequest[]): ParallelGroup[] {
  const groups = new Map<AssetSource, number[]>();

  for (const req of requests) {
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

function compositionHint(beat: Beat): string {
  return beat.layout === "pip"
    ? "Square 1:1 composition, centered subject"
    : "Vertical 9:16 composition";
}

function buildPersonPrompt(beat: Beat): string {
  const subject = beat.visualSubject ?? "a person";
  return `Photorealistic portrait of ${subject}. ${beat.visualPrompt}. ${compositionHint(beat)}, cinematic lighting, sharp focus, editorial photography style. High detail on face and expression.`;
}

function buildProductPrompt(beat: Beat): string {
  return `${beat.visualPrompt}. Clean product photography style, sharp text and UI elements, ${compositionHint(beat).toLowerCase()}. High contrast, professional lighting.`;
}

function buildCinematicPrompt(beat: Beat): string {
  return `${beat.visualPrompt}. Cinematic ${compositionHint(beat).toLowerCase()}, dramatic lighting, high production value. Sharp focus, vivid colors.`;
}

function buildDataGraphicPrompt(beat: Beat): string {
  const format = beat.layout === "pip" ? "Square 1:1 format" : "Vertical 9:16 format";
  return `Infographic style image: ${beat.visualPrompt}. Clean design, bold numbers, high contrast. Dark background with bright accent colors (#00E5FF, #FF6B00). ${format}.`;
}

function buildStockQuery(beat: Beat): string {
  // Strip AI-specific language for stock footage search
  // Also limit to 5 words max for better Pexels results
  const cleaned = beat.visualPrompt
    .replace(/\b(AI|artificial intelligence|neural|algorithm|machine learning|deep learning|LLM|GPT|model)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Take first 5 words max
  const words = cleaned.split(/\s+/).slice(0, 5).join(" ");
  return words || "technology office";
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
