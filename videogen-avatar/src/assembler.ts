// ============================================================
// videogen-avatar — Stage 5: Assembler (Creatomate)
// Builds Creatomate RenderScript JSON from script + assets + avatar
// Then submits to Creatomate for cloud rendering
//
// 3 LAYOUT MODES per beat (set by scriptDirector):
//
// "avatar_closeup" — Quinn fills ~70% of screen, no b-roll
// "pip"            — B-roll top (TV frame), Quinn small bottom-left with border
// "fullscreen_broll" — Full-screen b-roll, no avatar, captions only
//
// Key advantage over Shotstack:
// - Same track = sequential (no manual startSec needed for b-roll)
// - border_radius works natively (no HTML overlay hacks)
// - No chromaKey needed — use transparent background from HeyGen
// ============================================================

import type {
  VideoScript,
  Beat,
  LayoutMode,
  AssetMap,
  AvatarResult,
  PipelineConfig,
} from "./types.js";
import { renderVideo } from "./utils/creatomateClient.js";

// Sub-clip duration for fast-paced b-roll
const SUB_CLIP_SEC = 2.5;

export async function assembleVideo(
  script: VideoScript,
  assets: AssetMap,
  avatar: AvatarResult,
  config: PipelineConfig,
  signal?: AbortSignal,
): Promise<{ videoUrl: string }> {
  const source = buildSource(script, assets, avatar, config);

  const layouts = script.beats.map(b => b.layout);
  console.log(`[Assembler] Creatomate render: ${script.beats.length} beats, ${script.totalDurationSec}s`);
  console.log(`[Assembler] Layouts: ${layouts.join(" → ")}`);

  return renderVideo(source, signal);
}

export function buildSource(
  script: VideoScript,
  assets: AssetMap,
  avatar: AvatarResult,
  config: PipelineConfig,
): Record<string, any> {
  // Each beat becomes a Composition element on track 1 (sequential)
  // Inside each composition, elements are layered per the beat's layout
  const beatCompositions: any[] = [];

  for (const beat of script.beats) {
    if (beat.durationSec <= 0) continue;
    const comp = buildBeatComposition(beat, assets, avatar, config);
    beatCompositions.push(comp);
  }

  return {
    output_format: "mp4",
    width: 1080,
    height: 1920,
    frame_rate: 30,
    elements: beatCompositions,
  };
}

// ─── Beat Composition ──────────────────────────────────────
// Each beat is a Composition on track 1 (plays sequentially).
// Inside the composition, elements are layered per layout mode.
function buildBeatComposition(
  beat: Beat,
  assets: AssetMap,
  avatar: AvatarResult,
  config: PipelineConfig,
): Record<string, any> {
  const layout = beat.layout || "pip";
  const elements: any[] = [];

  // Black background
  elements.push({
    type: "shape",
    width: "100%",
    height: "100%",
    fill_color: "#000000",
  });

  if (layout === "avatar_closeup") {
    buildCloseupElements(beat, avatar, elements);
  } else if (layout === "pip") {
    buildPipElements(beat, assets, avatar, config, elements);
  } else if (layout === "fullscreen_broll") {
    buildFullscreenBrollElements(beat, assets, elements);
  }

  // Captions (all layouts)
  buildCaptionElements(beat, layout, elements);

  return {
    type: "composition",
    track: 1,  // Sequential — beats play one after another
    duration: beat.durationSec,
    width: "100%",
    height: "100%",
    elements,
    // Fade transition between beats
    ...(beat.id > 1 ? { transition: { type: "fade", duration: 0.3 } } : {}),
  };
}

// ─── Avatar Closeup Layout ─────────────────────────────────
// Quinn fills ~70% of screen, centered, no b-roll
function buildCloseupElements(
  beat: Beat,
  avatar: AvatarResult,
  elements: any[],
): void {
  elements.push({
    type: "video",
    source: avatar.videoUrl,
    trim_start: beat.startSec,
    trim_duration: beat.durationSec,
    x: "50%",
    y: "45%",
    width: "75%",
    height: "70%",
    fit: "cover",
    border_radius: "3 vmin",
    // Border via shadow
    shadow_color: "rgba(80,80,80,0.6)",
    shadow_blur: "2 vmin",
  });
}

// ─── PIP Layout ────────────────────────────────────────────
// B-roll in top 55% (TV frame with rounded corners)
// Quinn small in bottom-left with border
function buildPipElements(
  beat: Beat,
  assets: AssetMap,
  avatar: AvatarResult,
  config: PipelineConfig,
  elements: any[],
): void {
  const asset = assets[beat.id];

  // B-roll in upper portion (TV frame)
  if (asset) {
    const isVideo = asset.mediaType === "video";

    if (isVideo) {
      elements.push({
        type: "video",
        source: asset.url,
        trim_start: 0,
        trim_duration: beat.durationSec,
        x: "50%",
        y: "30%",
        width: "92%",
        height: "55%",
        fit: "cover",
        border_radius: "2.5 vmin",
        // Subtle shadow for TV frame effect
        shadow_color: "rgba(0,0,0,0.5)",
        shadow_blur: "3 vmin",
      });
    } else {
      // Still image with slow zoom effect
      elements.push({
        type: "image",
        source: asset.url,
        x: "50%",
        y: "30%",
        width: "92%",
        height: "55%",
        fit: "cover",
        border_radius: "2.5 vmin",
        shadow_color: "rgba(0,0,0,0.5)",
        shadow_blur: "3 vmin",
        animations: [{
          type: "scale",
          scope: "element",
          start_scale: "100%",
          end_scale: "110%",
          easing: "linear",
        }],
      });
    }
  } else {
    // Fallback: gradient with text
    elements.push({
      type: "shape",
      x: "50%",
      y: "30%",
      width: "92%",
      height: "55%",
      fill_color: "#16213e",
      border_radius: "2.5 vmin",
    });
    elements.push({
      type: "text",
      text: beat.narration.slice(0, 80),
      x: "50%",
      y: "30%",
      width: "80%",
      height: "45%",
      font_family: "Inter",
      font_size: "4 vh",
      fill_color: "#00E5FF",
      x_alignment: "50%",
      y_alignment: "50%",
    });
  }

  // Avatar PIP — bottom-left with border (matching reference image)
  elements.push({
    type: "video",
    source: avatar.videoUrl,
    trim_start: beat.startSec,
    trim_duration: beat.durationSec,
    x: "22%",
    y: "78%",
    width: "35%",
    height: "30%",
    fit: "cover",
    border_radius: "2 vmin",
    // Border effect via shadow (like the reference image)
    shadow_color: "rgba(60,60,60,0.8)",
    shadow_blur: "1.5 vmin",
  });
}

// ─── Fullscreen B-Roll Layout ──────────────────────────────
// Full-screen b-roll, no avatar visible
function buildFullscreenBrollElements(
  beat: Beat,
  assets: AssetMap,
  elements: any[],
): void {
  const asset = assets[beat.id];

  if (asset) {
    const isVideo = asset.mediaType === "video";

    elements.push({
      type: isVideo ? "video" : "image",
      source: asset.url,
      ...(isVideo ? { trim_start: 0, trim_duration: beat.durationSec } : {}),
      x: "50%",
      y: "50%",
      width: "100%",
      height: "100%",
      fit: "cover",
      // Slight dark overlay for caption readability
      color_overlay: "rgba(0,0,0,0.15)",
      ...(!isVideo ? {
        animations: [{
          type: "scale",
          scope: "element",
          start_scale: "100%",
          end_scale: "108%",
          easing: "linear",
        }],
      } : {}),
    });
  } else {
    // Fallback gradient
    elements.push({
      type: "shape",
      width: "100%",
      height: "100%",
      fill_mode: "linear",
      fill_x0: "0%",
      fill_y0: "0%",
      fill_x1: "100%",
      fill_y1: "100%",
      fill_color: ["#1a1a2e", "#16213e"],
    });
  }
}

// ─── Captions ──────────────────────────────────────────────
// Phrase-by-phrase captions, positioned based on layout
function buildCaptionElements(
  beat: Beat,
  layout: LayoutMode,
  elements: any[],
): void {
  const phrases = splitIntoPhrases(beat.narration);
  const phraseDuration = beat.durationSec / phrases.length;

  // Position based on layout
  let captionX = "50%";
  let captionY = "90%";
  let captionWidth = "90%";

  if (layout === "pip") {
    captionX = "65%";
    captionY = "82%";
    captionWidth = "55%";
  } else if (layout === "avatar_closeup") {
    captionY = "88%";
  }

  // Each phrase is a text element on the same track (sequential within this composition)
  for (let i = 0; i < phrases.length; i++) {
    const styledText = highlightEmphasis(phrases[i], beat.captionEmphasis);

    elements.push({
      type: "text",
      track: 2,  // Sequential within the beat composition
      duration: Math.max(phraseDuration, 0.5),
      text: styledText,
      font_family: "Inter",
      font_weight: "700",
      font_size: "4.5 vh",
      fill_color: "#FFFFFF",
      shadow_color: "rgba(0,0,0,0.9)",
      shadow_blur: "1.5 vmin",
      background_color: "rgba(0,0,0,0.45)",
      background_border_radius: "15%",
      background_x_padding: "8%",
      background_y_padding: "5%",
      x: captionX,
      y: captionY,
      width: captionWidth,
      x_alignment: "50%",
      y_alignment: "50%",
      // Fade in each phrase
      animations: [
        { type: "text-appear", scope: "element", duration: 0.2 },
      ],
      ...(i > 0 ? { transition: { type: "fade", duration: 0.15 } } : {}),
    });
  }
}

// ─── Helpers ────────────────────────────────────────────────

function splitIntoPhrases(text: string): string[] {
  const words = text.split(/\s+/);
  const phrases: string[] = [];
  const WORDS_PER_PHRASE = 7;

  for (let i = 0; i < words.length; i += WORDS_PER_PHRASE) {
    const phrase = words.slice(i, i + WORDS_PER_PHRASE).join(" ");
    if (phrase.trim()) phrases.push(phrase);
  }

  return phrases.length > 0 ? phrases : [text];
}

function highlightEmphasis(text: string, emphasisWords?: string[]): string {
  if (!emphasisWords || emphasisWords.length === 0) return text;

  let result = text;
  for (const word of emphasisWords) {
    const regex = new RegExp(`\\b(${word})\\b`, "gi");
    // Creatomate supports basic HTML in text elements
    result = result.replace(regex, `<b style="color:#00E5FF">$1</b>`);
  }
  return result;
}
