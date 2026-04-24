// ============================================================
// videogen-avatar — Stage 2: Asset Router
// Takes a VideoScript → returns an AssetManifest
// Pure logic, no API calls. Decides which tool generates each beat's visual.
//
// ROUTING STRATEGY (v9 — per-shot sub-assets):
// - When a Beat has shots[], emit ONE AssetRequest per shot (shotIdx set),
//   using the shot's visualType/visualPrompt/visualSubject/motionStyle.
// - Beats without shots[] route at the beat level as before.
// - Nano Banana stills → Veo 3.1 image-to-video animation (5s clips)
//   * Veo failure degrades gracefully to still + Ken Burns in Creatomate
// - Pexels stock footage for generic_action beats (real footage) and reaction_clip
// - Kling REMOVED from routing — output quality too low (smeared text, unclear)
// - brand_logo_card + stat_card are new visual types:
//     brand_logo_card → nano_banana (clean logo on gradient)
//     stat_card       → skipped (Remotion renders it)
// ============================================================

import { CONFIG } from "./config.js";
import type {
  VideoScript,
  Beat,
  Shot,
  LayoutMode,
  VisualType,
  AssetSource,
  AssetRequest,
  AssetManifest,
  ParallelGroup,
} from "./types.js";

/**
 * Pick the right generation aspect ratio based on how the beat will be displayed:
 * - "pip" / "device_mockup" → b-roll sits in a frame (top portion) → 1:1
 * - "fullscreen_broll" → fills the entire 1080×1920 canvas → 9:16
 * - "avatar_closeup" / "text_card" / "icon_grid" / "motion_graphic" → no b-roll, default 9:16
 */
function aspectRatioForLayout(layout: LayoutMode): "9:16" | "1:1" {
  return (layout === "pip" || layout === "device_mockup") ? "1:1" : "9:16";
}

// Fallback chains — Kling removed, everything degrades to Nano Banana → Pexels
const FALLBACK_CHAINS: Record<AssetSource, AssetSource[]> = {
  nano_banana:       ["pexels"],
  kling_t2v:         ["nano_banana", "pexels"],  // kept for type safety, not routed to
  kling_i2v:         ["nano_banana"],             // kept for type safety, not routed to
  pexels:            ["nano_banana"],
  puppeteer_graphic: ["nano_banana", "pexels"],
  headless_capture:  ["nano_banana", "pexels"],   // falls back to AI image if URL fails
};

const CONCURRENCY: Record<AssetSource, number> = {
  nano_banana: CONFIG.nanoBananaConcurrency,
  kling_t2v: CONFIG.klingConcurrency,
  kling_i2v: 2,
  pexels: CONFIG.pexelsConcurrency,
  puppeteer_graphic: 3,
  headless_capture: 2,  // sequential-ish to avoid overwhelming browser
};

// Visual types that Remotion renders from script data alone — no asset fetch.
const REMOTION_RENDERED_VISUAL_TYPES: VisualType[] = ["stat_card"];

export function routeAssets(script: VideoScript): AssetManifest {
  const requests: AssetRequest[] = [];

  for (const beat of script.beats) {
    const routed = routeBeat(beat);
    requests.push(...routed);
  }

  const parallelGroups = buildParallelGroups(requests);

  console.log(`[AssetRouter] ${requests.length} asset requests from ${script.beats.length} beats`);
  const shotRequests = requests.filter(r => r.shotIdx !== undefined).length;
  if (shotRequests > 0) {
    console.log(`[AssetRouter] ${shotRequests} of those are per-shot sub-assets`);
  }
  const sources = Array.from(new Set(requests.map(r => r.source)));
  console.log(`[AssetRouter] Sources: ${sources.join(", ")}`);

  return { requests, parallelGroups };
}

function routeBeat(beat: Beat): AssetRequest[] {
  // Remotion-rendered layouts — no external asset needed
  if (beat.layout === "text_card" || beat.layout === "icon_grid" || beat.layout === "motion_graphic") {
    return [];
  }
  if (beat.layout === "avatar_closeup") {
    return [];
  }
  // Beat-level remotionOnly flag (e.g. stat_card visualType) — Remotion renders, skip
  if (beat.remotionOnly) {
    return [];
  }

  // Per-shot routing: if the beat has shots[], emit one request per shot.
  if (beat.shots && beat.shots.length > 0) {
    const requests: AssetRequest[] = [];
    for (const shot of beat.shots) {
      const req = routeShot(beat, shot);
      if (req) requests.push(req);
    }
    return requests;
  }

  // Fall back to beat-level routing (legacy path)
  return routeBeatLegacy(beat);
}

/**
 * Map one shot inside a beat to exactly one AssetRequest.
 * Shots inherit the beat's layout (and therefore aspect ratio) but use their
 * own visualType/prompt/subject/motion.
 */
function routeShot(beat: Beat, shot: Shot): AssetRequest | null {
  // Skip shots that are entirely Remotion-rendered
  if (REMOTION_RENDERED_VISUAL_TYPES.includes(shot.visualType)) {
    return null;
  }

  const aspect = aspectRatioForLayout(beat.layout);

  switch (shot.visualType) {
    case "named_person": {
      // Static portrait of a named figure — Nano Banana AI image + Ken Burns
      const subject = shot.visualSubject ?? beat.visualSubject ?? "person";
      return {
        beatId: beat.id,
        shotIdx: shot.idx,
        source: "nano_banana",
        prompt: buildPersonPromptFromShot(beat, shot, subject),
        subject,
        aspectRatio: aspect,
        fallbackChain: FALLBACK_CHAINS.nano_banana,
      };
    }

    case "reaction_clip": {
      // Talking-head clip of a named figure — prefer Pexels (real footage)
      // then degrade to Nano Banana still.
      const subject = shot.visualSubject ?? beat.visualSubject ?? "person";
      const query = buildReactionQuery(subject, shot.visualPrompt);
      return {
        beatId: beat.id,
        shotIdx: shot.idx,
        source: "pexels",
        prompt: query,
        subject,
        aspectRatio: aspect,
        fallbackChain: FALLBACK_CHAINS.pexels,
      };
    }

    case "brand_logo_card": {
      // Nano Banana render of a clean logo on gradient
      const subject = shot.visualSubject ?? beat.visualSubject;
      return {
        beatId: beat.id,
        shotIdx: shot.idx,
        source: "nano_banana",
        prompt: buildBrandLogoPrompt(shot, subject),
        subject,
        aspectRatio: aspect,
        fallbackChain: FALLBACK_CHAINS.nano_banana,
      };
    }

    case "product_logo_ui": {
      return {
        beatId: beat.id,
        shotIdx: shot.idx,
        source: "nano_banana",
        prompt: buildProductPromptFromShot(beat, shot),
        aspectRatio: aspect,
        fallbackChain: FALLBACK_CHAINS.nano_banana,
      };
    }

    case "screen_capture": {
      return {
        beatId: beat.id,
        shotIdx: shot.idx,
        source: "headless_capture",
        prompt: shot.visualPrompt,  // URL + description expected
        aspectRatio: aspect,
        fallbackChain: FALLBACK_CHAINS.headless_capture,
      };
    }

    case "cinematic_concept": {
      return {
        beatId: beat.id,
        shotIdx: shot.idx,
        source: "nano_banana",
        prompt: buildCinematicPromptFromShot(beat, shot),
        aspectRatio: aspect,
        fallbackChain: FALLBACK_CHAINS.nano_banana,
      };
    }

    case "generic_action": {
      return {
        beatId: beat.id,
        shotIdx: shot.idx,
        source: "pexels",
        prompt: buildStockQueryFromPrompt(shot.visualPrompt),
        aspectRatio: aspect,
        fallbackChain: FALLBACK_CHAINS.pexels,
      };
    }

    case "data_graphic": {
      return {
        beatId: beat.id,
        shotIdx: shot.idx,
        source: "nano_banana",
        prompt: buildDataGraphicPromptFromShot(beat, shot),
        aspectRatio: aspect,
        fallbackChain: FALLBACK_CHAINS.nano_banana,
      };
    }

    case "stat_card":
      return null; // handled by REMOTION_RENDERED_VISUAL_TYPES guard above
  }
}

function routeBeatLegacy(beat: Beat): AssetRequest[] {
  const requests: AssetRequest[] = [];

  // device_mockup with non-screen-capture visual → use Nano Banana for a clean AI image
  if (beat.layout === "device_mockup" && beat.visualType !== "screen_capture") {
    requests.push({
      beatId: beat.id,
      source: "nano_banana",
      prompt: buildProductPrompt(beat),
      aspectRatio: "1:1",
      fallbackChain: FALLBACK_CHAINS.nano_banana,
    });
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
      break;
    }

    case "reaction_clip": {
      requests.push({
        beatId: beat.id,
        source: "pexels",
        prompt: buildReactionQuery(beat.visualSubject ?? "person", beat.visualPrompt),
        subject: beat.visualSubject,
        aspectRatio: aspectRatioForLayout(beat.layout),
        fallbackChain: FALLBACK_CHAINS.pexels,
      });
      break;
    }

    case "brand_logo_card": {
      requests.push({
        beatId: beat.id,
        source: "nano_banana",
        prompt: buildBrandLogoPrompt({ visualPrompt: beat.visualPrompt } as any, beat.visualSubject),
        subject: beat.visualSubject,
        aspectRatio: aspectRatioForLayout(beat.layout),
        fallbackChain: FALLBACK_CHAINS.nano_banana,
      });
      break;
    }

    case "product_logo_ui": {
      requests.push({
        beatId: beat.id,
        source: "nano_banana",
        prompt: buildProductPrompt(beat),
        aspectRatio: aspectRatioForLayout(beat.layout),
        fallbackChain: FALLBACK_CHAINS.nano_banana,
      });
      break;
    }

    case "screen_capture": {
      requests.push({
        beatId: beat.id,
        source: "headless_capture",
        prompt: beat.visualPrompt,
        aspectRatio: aspectRatioForLayout(beat.layout),
        fallbackChain: FALLBACK_CHAINS.headless_capture,
      });
      break;
    }

    case "cinematic_concept": {
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
      requests.push({
        beatId: beat.id,
        source: "nano_banana",
        prompt: buildDataGraphicPrompt(beat),
        aspectRatio: aspectRatioForLayout(beat.layout),
        fallbackChain: FALLBACK_CHAINS.nano_banana,
      });
      break;
    }

    case "stat_card": {
      // Remotion renders stat cards — skip asset fetch
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
  return (beat.layout === "pip" || beat.layout === "device_mockup")
    ? "Square 1:1 composition, centered subject"
    : "Vertical 9:16 composition";
}

function buildPersonPrompt(beat: Beat): string {
  const subject = beat.visualSubject ?? "a person";
  return `Photorealistic portrait of ${subject}. ${beat.visualPrompt}. ${compositionHint(beat)}, cinematic lighting, sharp focus, editorial photography style. High detail on face and expression.`;
}

function buildPersonPromptFromShot(beat: Beat, shot: Shot, subject: string): string {
  return `Photorealistic portrait of ${subject}. ${shot.visualPrompt}. ${compositionHint(beat)}, cinematic lighting, sharp focus, editorial photography style. High detail on face and expression.`;
}

function buildProductPrompt(beat: Beat): string {
  return `${beat.visualPrompt}. Clean product photography style, sharp text and UI elements, ${compositionHint(beat).toLowerCase()}. High contrast, professional lighting.`;
}

function buildProductPromptFromShot(beat: Beat, shot: Shot): string {
  return `${shot.visualPrompt}. Clean product photography style, sharp text and UI elements, ${compositionHint(beat).toLowerCase()}. High contrast, professional lighting.`;
}

function buildCinematicPrompt(beat: Beat): string {
  return `${beat.visualPrompt}. Cinematic ${compositionHint(beat).toLowerCase()}, dramatic lighting, high production value. Sharp focus, vivid colors.`;
}

function buildCinematicPromptFromShot(beat: Beat, shot: Shot): string {
  return `${shot.visualPrompt}. Cinematic ${compositionHint(beat).toLowerCase()}, dramatic lighting, high production value. Sharp focus, vivid colors.`;
}

function buildDataGraphicPrompt(beat: Beat): string {
  const format = (beat.layout === "pip" || beat.layout === "device_mockup")
    ? "Square 1:1 format" : "Vertical 9:16 format";
  return `Motion graphic style infographic: ${beat.visualPrompt}. Clean modern design, bold numbers, high contrast. Dark background (#0a0a0a) with gold accent (#e89b06) and coral (#D97B6A) highlights. Sharp text, no blur. ${format}. Professional broadcast news style.`;
}

function buildDataGraphicPromptFromShot(beat: Beat, shot: Shot): string {
  const format = (beat.layout === "pip" || beat.layout === "device_mockup")
    ? "Square 1:1 format" : "Vertical 9:16 format";
  return `Motion graphic style infographic: ${shot.visualPrompt}. Clean modern design, bold numbers, high contrast. Dark background (#0a0a0a) with gold accent (#e89b06) and coral (#D97B6A) highlights. Sharp text, no blur. ${format}. Professional broadcast news style.`;
}

function buildStockQuery(beat: Beat): string {
  return buildStockQueryFromPrompt(beat.visualPrompt);
}

function buildStockQueryFromPrompt(prompt: string): string {
  // Strip AI-specific language for stock footage search
  const cleaned = prompt
    .replace(/\b(AI|artificial intelligence|neural|algorithm|machine learning|deep learning|LLM|GPT|model)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Take first 5 words max
  const words = cleaned.split(/\s+/).slice(0, 5).join(" ");
  return words || "technology office";
}

function buildBrandLogoPrompt(shot: { visualPrompt: string }, subject?: string): string {
  const brand = subject ?? "the product";
  return `Ultra-clean centered logo of ${brand} on a dark gradient background (#0a0a0a → #1a1a2e). ${shot.visualPrompt}. Minimal, sharp, high-contrast editorial style. No extra graphics, no text beyond the logo itself. Square 1:1 composition.`;
}

function buildReactionQuery(subject: string, prompt: string): string {
  // For Pexels video: a query like "[subject] talking" or "[subject] speaking"
  // Since Pexels rarely has specific named people, fall back to a descriptor.
  const cleaned = subject
    .replace(/\b(the|a|an)\b/gi, "")
    .trim();
  const base = cleaned.length > 0 ? cleaned : "person speaking";
  // Enrich with action hint from the prompt if present
  const actionMatch = prompt.match(/\b(speaking|talking|interview|podcast|press|reaction|headshot)\b/i);
  const action = actionMatch ? actionMatch[1] : "speaking";
  return `${base} ${action}`;
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

/** Make a unique key for a request that may be a shot sub-asset. */
export function requestKey(req: { beatId: number; shotIdx?: number }): string {
  return req.shotIdx !== undefined ? `${req.beatId}:${req.shotIdx}` : `${req.beatId}`;
}

// Exported only for tests / the generator's dedup logic
export { buildReactionQuery };
