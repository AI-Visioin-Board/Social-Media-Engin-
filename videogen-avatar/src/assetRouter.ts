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
  ShotSpec,
  HookArchetype,
} from "./types.js";

// V9 Law 0.6 — no single sub-shot is allowed to exceed this.
const MAX_SHOT_SEC = 2.0;

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

export function routeAssets(script: VideoScript): AssetManifest {
  const requests: AssetRequest[] = [];

  for (const beat of script.beats) {
    const routed = routeBeat(beat);
    requests.push(...routed);
  }

  const parallelGroups = buildParallelGroups(requests);

  console.log(`[AssetRouter] ${requests.length} asset requests from ${script.beats.length} beats`);
  const sources = Array.from(new Set(requests.map(r => r.source)));
  console.log(`[AssetRouter] Sources: ${sources.join(", ")}`);

  return { requests, parallelGroups };
}

function routeBeat(beat: Beat): AssetRequest[] {
  const requests: AssetRequest[] = [];

  // V9 Section 12a — cold-open hook fans out into one asset request per sub-shot.
  // Each sub-shot carries its own cinematographer-grade assetPrompt (Law 0.4).
  if (beat.layout === "cold_open_hook") {
    return routeHookBeat(beat);
  }

  // Layouts rendered entirely by Remotion components — no external asset needed
  if (beat.layout === "text_card" || beat.layout === "icon_grid" || beat.layout === "motion_graphic") {
    return requests;
  }

  // Avatar closeup — no b-roll needed
  if (beat.layout === "avatar_closeup") {
    return requests;
  }

  // V9 Law 0.5 — non-closeup beats with an explicit subShots array fan out per sub-shot
  if (beat.subShots && beat.subShots.length > 0) {
    return routeSubShotBeat(beat);
  }

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
      // NO Kling I2V — quality too low, smears faces/text
      break;
    }

    case "product_logo_ui": {
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

    case "screen_capture": {
      // Headless browser captures real website screenshots
      // Falls back to Nano Banana AI image if URL is unavailable
      requests.push({
        beatId: beat.id,
        source: "headless_capture",
        prompt: beat.visualPrompt,  // may contain URL + description
        aspectRatio: aspectRatioForLayout(beat.layout),
        fallbackChain: FALLBACK_CHAINS.headless_capture,
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

/**
 * V9 Section 12a hook routing. Each sub-shot becomes its own AssetRequest so the
 * asset generator produces a distinct clip/still per visual beat (not one 4-second
 * blob). Archetype → source mapping:
 *   - A1/A2/A3/A5/A6/A8 → Nano Banana → Veo img2vid (cinematic composited shots)
 *   - A4 (cartoon reaction) → Nano Banana (flat vector / anime style), keep as still
 *   - A7 (text as visual) → Remotion-rendered (no external asset needed, kinetic typography)
 *
 * We encode the sub-shot index into the beatId with a deterministic offset:
 *   shotId = beatId * 1000 + shotIndex   (e.g. beat 1 shot 2 → 1002)
 * This stays below JS integer safety and lets downstream code reverse-map.
 */
function routeHookBeat(beat: Beat): AssetRequest[] {
  const requests: AssetRequest[] = [];
  const arch = beat.hookArchetype;
  const shots = beat.subShots ?? [];

  // A7 (text-as-visual) renders entirely in Remotion — no external asset needed
  if (arch === "A7_text_as_visual") {
    return requests;
  }

  for (let idx = 0; idx < shots.length; idx++) {
    const shot = shots[idx];
    // V9 Law 0.6 enforcement — clamp any over-limit shot duration
    if (shot.durationSec > MAX_SHOT_SEC) {
      console.warn(`[AssetRouter] Hook beat ${beat.id} shot ${idx} durationSec=${shot.durationSec} > ${MAX_SHOT_SEC}s — will generate but render must clip to ${MAX_SHOT_SEC}s`);
    }

    // A4 cartoon reaction → Nano Banana still, stylised as vector/anime
    // All other archetypes → Nano Banana → Veo img2vid for true motion
    const source: AssetSource = "nano_banana";

    requests.push({
      beatId: encodeShotId(beat.id, idx),
      source,
      prompt: buildHookShotPrompt(beat, shot, arch),
      aspectRatio: "9:16",
      fallbackChain: ["pexels"],  // Pexels as last resort if Nano Banana fails
    });
  }

  return requests;
}

/**
 * V9 Law 0.5 — non-closeup beats with subShots fan out per shot so each gets its own
 * cinematographer-grade prompt and its own generation. Falls back to legacy single-asset
 * routing if the sub-shot uses a layout that doesn't need b-roll.
 */
function routeSubShotBeat(beat: Beat): AssetRequest[] {
  const requests: AssetRequest[] = [];
  const shots = beat.subShots ?? [];

  // Determine the source based on the beat's visualType (keeps legacy behaviour)
  const source: AssetSource =
    beat.visualType === "screen_capture" ? "headless_capture"
    : beat.visualType === "generic_action" ? "pexels"
    : "nano_banana";

  const aspectRatio = aspectRatioForLayout(beat.layout);

  for (let idx = 0; idx < shots.length; idx++) {
    const shot = shots[idx];
    if (shot.durationSec > MAX_SHOT_SEC) {
      console.warn(`[AssetRouter] Beat ${beat.id} shot ${idx} durationSec=${shot.durationSec} > ${MAX_SHOT_SEC}s (Law 0.6)`);
    }

    // Shot's assetPrompt is the cinematographer-grade prompt (Law 0.4) — use directly
    const prompt = shot.assetPrompt || wrapWithCinematicPrompt(beat, shot.onScreenContent);

    requests.push({
      beatId: encodeShotId(beat.id, idx),
      source,
      prompt,
      aspectRatio,
      fallbackChain: FALLBACK_CHAINS[source],
    });
  }

  return requests;
}

/**
 * Encode (beatId, shotIndex) → unique integer for downstream asset map.
 * Shot 0 stays at beatId (backwards compatible); shots 1+ use beatId*1000+idx.
 */
export function encodeShotId(beatId: number, shotIndex: number): number {
  if (shotIndex === 0) return beatId;
  return beatId * 1000 + shotIndex;
}

export function decodeShotId(shotId: number): { beatId: number; shotIndex: number } {
  if (shotId < 1000) return { beatId: shotId, shotIndex: 0 };
  return { beatId: Math.floor(shotId / 1000), shotIndex: shotId % 1000 };
}

/**
 * V9 Section 12a.3 — builds the archetype-tailored assetPrompt when the script
 * director didn't supply one for a hook sub-shot. Produces cinematographer-grade
 * prompts aligned to the archetype's visual language.
 */
function buildHookShotPrompt(beat: Beat, shot: ShotSpec, archetype?: HookArchetype): string {
  // Always honour a shot-level explicit prompt if present
  if (shot.assetPrompt && shot.assetPrompt.trim().length > 50) {
    return shot.assetPrompt;
  }

  const content = shot.onScreenContent || beat.narration || "";
  const durSec = shot.durationSec.toFixed(1);
  const styleForArchetype: Record<HookArchetype, { aesthetic: string; negatives: string }> = {
    A1_object_collision: {
      aesthetic: "high-contrast product photography, Wes Anderson symmetry, early Apple keynote, matte black background, single hero object",
      negatives: "no hallucinated text, no watermarks, no motion blur on hero object, consistent lighting",
    },
    A2_villain_vs_hero: {
      aesthetic: "dramatic up-light, comic-book slow-motion, cinematic lens flare, chrome surfaces, smoke and debris particles",
      negatives: "no real company logos unless specified, no hallucinated text, no stock-photo look, consistent villain silhouette",
    },
    A3_before_after_jumpcut: {
      aesthetic: "split-frame composition or hard jumpcut, clean white studio background, product photography",
      negatives: "no hallucinated text, no watermarks, keep identical composition across before/after",
    },
    A4_cartoon_reaction: {
      aesthetic: "flat vector illustration, anime-inspired exaggerated expression, cutout-animation bounce, saturated colors",
      negatives: "no real-person faces, no watermarks, no stock-photo look, character style must be consistent",
    },
    A5_ui_gesture_macro: {
      aesthetic: "macro closeup photography, 85mm-equiv lens feel, tack-sharp focus on UI detail, soft bokeh elsewhere, studio softbox lighting",
      negatives: "no hallucinated UI text, no watermarks, cursor must not jitter, keep UI text consistent across clip",
    },
    A6_icon_storm: {
      aesthetic: "dark radial gradient background, icons glowing, particle motion trails, cinematic lens flare on collisions",
      negatives: "no real company logos unless specified, no watermarks, no hallucinated brand names",
    },
    A7_text_as_visual: {
      aesthetic: "massive kinetic typography, Inter Black 900 + Playfair Display 900 italic, matte black background, gold underline accent",
      negatives: "no hallucinated text, no watermarks, no stock-photo look",
    },
    A8_pov_first_person: {
      aesthetic: "first-person POV photography, handheld feel, shallow depth of field, morning golden-hour or indoor practical lighting",
      negatives: "no clearly-identifiable real faces, no watermarks, no stock-photo look",
    },
  };

  const style = archetype ? styleForArchetype[archetype] : styleForArchetype.A7_text_as_visual;

  return [
    `Vertical 1080x1920, ${durSec} seconds at 30fps.`,
    `Camera: ${humanizeCameraMove(shot.cameraMove)}.`,
    `Scene: ${content}`,
    shot.progressiveElements && shot.progressiveElements.length > 0
      ? `Motion: ${shot.progressiveElements.map(p => `${p.what} ${humanizeHow(p.how)} at ${p.appearsAtMs}ms`).join("; ")}.`
      : "Motion: subject enters with a clear directional motion over the first 400ms, then settles.",
    `Lighting: editorial, hard key light with deliberate shadow; mood matches archetype.`,
    `Focus: tack-sharp on hero subject; background falls off cleanly.`,
    `Style: ${style.aesthetic}.`,
    `Negative: ${style.negatives}.`,
  ].join(" ");
}

function humanizeCameraMove(cm: ShotSpec["cameraMove"]): string {
  const map: Record<ShotSpec["cameraMove"], string> = {
    locked: "locked-off head-on shot, 85mm-equivalent lens feel",
    slow_push_in: "slow 4% scale push-in over the full shot, 50mm lens feel",
    slow_pull_out: "slow 4% scale pull-out over the full shot",
    whip_pan: "whip pan entering from frame-right with motion-blur streak",
    handheld_drift: "subtle handheld drift, 35mm lens feel, ±8px vertical micro-float",
    macro_rack_focus: "macro composition with a rack-focus shift from foreground to background at mid-shot",
    crane_down: "overhead crane descent, 24mm lens feel",
    orbit: "slow orbit around subject, 50mm lens feel",
  };
  return map[cm];
}

function humanizeHow(how: NonNullable<ShotSpec["progressiveElements"]>[number]["how"]): string {
  const map: Record<NonNullable<ShotSpec["progressiveElements"]>[number]["how"], string> = {
    slide_left: "slides in from the right",
    slide_right: "slides in from the left",
    slide_up: "slides in from below",
    slide_down: "slides in from above",
    scale_up: "scales up from 0 with spring overshoot",
    scale_down: "scales down from oversize to rest",
    letter_by_letter: "types on letter by letter",
    write_on: "writes on with a drawing stroke",
    fade_in: "fades in",
    wipe_in: "wipes in from left",
  };
  return map[how];
}

/**
 * Generic cinematographer-grade wrapper when a sub-shot has no assetPrompt
 * but we still need to produce a Law 0.4-compliant prompt.
 */
function wrapWithCinematicPrompt(beat: Beat, content: string): string {
  return [
    "Vertical 1080x1920, ~1.5 seconds at 30fps.",
    "Camera: locked-off shot, 85mm-equivalent lens feel.",
    `Scene: ${content || beat.visualPrompt}`,
    "Motion: subject enters with a clear directional motion over the first 400ms, then settles.",
    "Lighting: soft overhead studio light, practical ambient, deliberate shadow.",
    "Focus: tack-sharp on hero subject; background falls off to gentle defocus.",
    "Style: premium product demo, Apple keynote cinematography.",
    "Negative: no hallucinated text, no watermarks, no cursor jitter, keep UI text consistent across the clip.",
  ].join(" ");
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
  return `Motion graphic style infographic: ${beat.visualPrompt}. Clean modern design, bold numbers, high contrast. Dark background (#0a0a0a) with gold accent (#e89b06) and coral (#D97B6A) highlights. Sharp text, no blur. ${format}. Professional broadcast news style.`;
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
