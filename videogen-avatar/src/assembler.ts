// ============================================================
// videogen-avatar — Stage 5: Assembler
// Builds Shotstack Edit JSON from script + assets + avatar
// Then submits to Shotstack for cloud rendering
//
// LAYOUT (PIP — Picture-in-Picture):
// ┌─────────────────────────┐
// │                         │
// │   B-ROLL (upper 60%)    │
// │   Full-width, rounded   │
// │                         │
// │                         │
// ├─────────────────────────┤
// │ ┌──────┐                │
// │ │AVATAR│  CAPTIONS      │
// │ │(PIP) │  (bottom-right)│
// │ └──────┘                │
// └─────────────────────────┘
// Black background, 9:16 (1080x1920)
// ============================================================

import type {
  VideoScript,
  Beat,
  AssetMap,
  AvatarResult,
  ShotstackEdit,
  ShotstackClip,
  ShotstackTrack,
  ShotstackAsset,
  PipelineConfig,
} from "./types.js";
import { renderVideo } from "./utils/shotstackClient.js";

// Valid Shotstack effect values
const VALID_EFFECTS = new Set([
  "zoomIn", "zoomInSlow", "zoomInFast",
  "zoomOut", "zoomOutSlow", "zoomOutFast",
  "slideLeft", "slideLeftSlow", "slideLeftFast",
  "slideRight", "slideRightSlow", "slideRightFast",
  "slideUp", "slideUpSlow", "slideUpFast",
  "slideDown", "slideDownSlow", "slideDownFast",
]);

// Valid Shotstack transition values
const VALID_TRANSITIONS = new Set([
  "fade", "reveal", "wipeLeft", "wipeRight",
  "slideLeft", "slideRight", "slideUp", "slideDown",
  "carouselLeft", "carouselRight", "carouselUp", "carouselDown",
  "shuffleLeft", "shuffleRight", "shuffleUp", "shuffleDown",
  "zoom",
]);

const CAPTION_STYLES = {
  fontFamily: "Inter",
  fontSize: 38,
  color: "#FFFFFF",
  highlightColor: "#00E5FF",
  shadowColor: "rgba(0,0,0,0.9)",
  shadowBlur: 10,
};

export async function assembleVideo(
  script: VideoScript,
  assets: AssetMap,
  avatar: AvatarResult,
  config: PipelineConfig,
  signal?: AbortSignal,
): Promise<{ videoUrl: string }> {
  const edit = buildEdit(script, assets, avatar, config);

  console.log(`[Assembler] Built Shotstack edit: ${script.beats.length} beats, ${script.totalDurationSec}s`);
  console.log(`[Assembler] Layout: PIP (avatar bottom-left, b-roll top, captions bottom-right)`);

  return renderVideo(edit, signal);
}

export function buildEdit(
  script: VideoScript,
  assets: AssetMap,
  avatar: AvatarResult,
  config: PipelineConfig,
): ShotstackEdit {
  // Shotstack layers: track 0 = topmost (rendered last/on top)
  // Track order: captions (top) → avatar PIP → b-roll → black background
  const captionTrack = buildCaptionTrack(script);
  const avatarTrack = buildAvatarTrack(avatar, script.totalDurationSec, config);
  const brollTrack = buildBrollTrack(script, assets);
  const backgroundTrack = buildBackgroundTrack(script.totalDurationSec);

  return {
    timeline: {
      tracks: [captionTrack, avatarTrack, brollTrack, backgroundTrack],
    },
    output: {
      format: "mp4",
      resolution: "1080",
      aspectRatio: "9:16",
      fps: 30,
    },
  };
}

// ─── Caption Track ──────────────────────────────────────────
// Phrase-by-phrase captions positioned bottom-right, above Instagram UI zone
function buildCaptionTrack(script: VideoScript): ShotstackTrack {
  const clips: ShotstackClip[] = [];

  for (const beat of script.beats) {
    // Split narration into phrases (roughly 8-12 words each) for rapid captions
    const phrases = splitIntoPhrases(beat.narration);
    const phraseDuration = beat.durationSec / phrases.length;

    let phraseStart = beat.startSec;
    for (const phrase of phrases) {
      const html = buildCaptionHtml(phrase, beat.captionEmphasis);
      clips.push({
        asset: {
          type: "html",
          html,
          width: 580,
          height: 250,
        } as ShotstackAsset,
        start: phraseStart,
        length: Math.max(phraseDuration, 0.5),
        position: "bottomRight",
        offset: { x: -0.02, y: 0.12 },  // Keep above Instagram UI
        transition: { in: "fade", out: "fade" },
      });
      phraseStart += phraseDuration;
    }
  }

  return { clips };
}

function splitIntoPhrases(text: string): string[] {
  const words = text.split(/\s+/);
  const phrases: string[] = [];
  const WORDS_PER_PHRASE = 8;

  for (let i = 0; i < words.length; i += WORDS_PER_PHRASE) {
    const phrase = words.slice(i, i + WORDS_PER_PHRASE).join(" ");
    if (phrase.trim()) phrases.push(phrase);
  }

  return phrases.length > 0 ? phrases : [text];
}

function buildCaptionHtml(text: string, emphasisWords?: string[]): string {
  let styledText = escapeHtml(text);

  // Highlight emphasis words
  if (emphasisWords && emphasisWords.length > 0) {
    for (const word of emphasisWords) {
      const regex = new RegExp(`\\b(${escapeRegex(word)})\\b`, "gi");
      styledText = styledText.replace(regex, `<b style="color:${CAPTION_STYLES.highlightColor}">$1</b>`);
    }
  }

  return `<div style="font-family:${CAPTION_STYLES.fontFamily},sans-serif;font-size:${CAPTION_STYLES.fontSize}px;color:${CAPTION_STYLES.color};text-shadow:2px 2px ${CAPTION_STYLES.shadowBlur}px ${CAPTION_STYLES.shadowColor}, -1px -1px ${CAPTION_STYLES.shadowBlur}px ${CAPTION_STYLES.shadowColor};text-align:left;line-height:1.4;padding:16px 20px;background:rgba(0,0,0,0.5);border-radius:12px;">${styledText}</div>`;
}

// ─── Avatar PIP Track ───────────────────────────────────────
// Quinn in bottom-left corner with green screen keyed out
function buildAvatarTrack(
  avatar: AvatarResult,
  totalDuration: number,
  config: PipelineConfig,
): ShotstackTrack {
  const avatarAsset: Record<string, any> = {
    type: "video",
    src: avatar.videoUrl,
    trim: 0,
  };

  // Only add chromaKey if we're using green screen background
  if (!avatar.transparent) {
    avatarAsset.chromaKey = {
      color: "#00FF00",
      threshold: 150,
      halo: 100,
    };
  }

  const clip: ShotstackClip = {
    asset: avatarAsset as ShotstackAsset,
    start: 0,
    length: totalDuration,
    fit: "crop",
    scale: 0.32,
    position: "bottomLeft",
    offset: { x: 0.03, y: 0.10 },  // Slight padding from edges, above IG UI
  };

  return { clips: [clip] };
}

// ─── B-Roll Track ───────────────────────────────────────────
// Visual clips in the upper portion of the screen
// Multiple clips per beat for fast-paced visual switching
function buildBrollTrack(script: VideoScript, assets: AssetMap): ShotstackTrack {
  const clips: ShotstackClip[] = [];

  for (const beat of script.beats) {
    const asset = assets[beat.id];

    if (!asset) {
      // Emergency fallback: styled text on gradient
      clips.push(buildFallbackClip(beat));
      continue;
    }

    const isVideo = asset.mediaType === "video";
    const shotstackAsset: ShotstackAsset = isVideo
      ? { type: "video", src: asset.url, trim: 0 }
      : { type: "image", src: asset.url };

    const clip: ShotstackClip = {
      asset: shotstackAsset,
      start: beat.startSec,
      length: beat.durationSec,
      fit: "cover",
      // Position b-roll in upper portion
      position: "top",
      offset: { y: 0.02 },
      scale: 0.95,
    };

    // Add transition (only valid Shotstack values)
    if (beat.transition !== "cut") {
      const mappedTransition = mapTransition(beat.transition);
      if (VALID_TRANSITIONS.has(mappedTransition)) {
        clip.transition = { in: mappedTransition };
      }
    }

    // Add Ken Burns effect for still images (only valid values)
    if (!isVideo && beat.motionStyle === "static_ken_burns") {
      clip.effect = "zoomInSlow";
    }

    clips.push(clip);
  }

  return { clips };
}

// ─── Background Track ───────────────────────────────────────
// Solid black background for the full duration
function buildBackgroundTrack(totalDuration: number): ShotstackTrack {
  return {
    clips: [{
      asset: {
        type: "html",
        html: '<div style="width:1080px;height:1920px;background:#000000;"></div>',
        width: 1080,
        height: 1920,
      } as ShotstackAsset,
      start: 0,
      length: totalDuration,
      fit: "none",
    }],
  };
}

// ─── Fallback Clip ──────────────────────────────────────────
function buildFallbackClip(beat: Beat): ShotstackClip {
  const html = `<div style="width:1080px;height:1100px;background:linear-gradient(135deg,#1a1a2e,#16213e);display:flex;align-items:center;justify-content:center;padding:60px;"><p style="font-family:Inter,sans-serif;font-size:48px;color:#00E5FF;text-align:center;line-height:1.4;">${escapeHtml(beat.narration.slice(0, 120))}</p></div>`;

  return {
    asset: { type: "html", html, width: 1080, height: 1100 },
    start: beat.startSec,
    length: beat.durationSec,
    position: "top",
    offset: { y: 0.02 },
    fit: "none",
  };
}

// ─── Helpers ────────────────────────────────────────────────
function mapTransition(t: string): string {
  switch (t) {
    case "dissolve": return "fade";
    case "zoom_in": return "zoom";
    case "slide_left": return "slideLeft";
    default: return "fade";
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
