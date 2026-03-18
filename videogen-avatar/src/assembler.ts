// ============================================================
// videogen-avatar — Stage 5: Assembler
// Builds Shotstack Edit JSON from script + assets + avatar
// Then submits to Shotstack for cloud rendering
//
// 3 LAYOUT MODES per beat (set by scriptDirector):
//
// "avatar_closeup" — Quinn fills most of the screen, talking to camera
// ┌─────────────────────────┐
// │                         │
// │     ┌───────────┐       │
// │     │  QUINN    │       │
// │     │ (large)   │       │
// │     │           │       │
// │     └───────────┘       │
// │       captions          │
// └─────────────────────────┘
//
// "pip" — B-roll top with TV frame, Quinn PIP bottom-left
// ┌─────────────────────────┐
// │ ┌─────────────────────┐ │
// │ │   B-ROLL (TV frame) │ │
// │ │   rounded corners   │ │
// │ └─────────────────────┘ │
// │ ┌──────┐                │
// │ │QUINN │  captions      │
// │ │(PIP) │                │
// │ └──────┘                │
// └─────────────────────────┘
//
// "fullscreen_broll" — Full-screen b-roll, no avatar
// ┌─────────────────────────┐
// │                         │
// │    FULL SCREEN B-ROLL   │
// │                         │
// │                         │
// │       captions          │
// │    (center-bottom)      │
// └─────────────────────────┘
// ============================================================

import type {
  VideoScript,
  Beat,
  LayoutMode,
  AssetMap,
  AvatarResult,
  ShotstackEdit,
  ShotstackClip,
  ShotstackTrack,
  ShotstackAsset,
  PipelineConfig,
} from "./types.js";
import { renderVideo } from "./utils/shotstackClient.js";

// Cycle through these effects on still-image sub-clips
const SUB_CLIP_EFFECTS = [
  "zoomInSlow", "zoomOutSlow", "slideRightSlow", "slideLeftSlow",
  "zoomInSlow", "slideUpSlow", "zoomOutSlow", "slideDownSlow",
];

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

const SUB_CLIP_DURATION = 2.5;

export async function assembleVideo(
  script: VideoScript,
  assets: AssetMap,
  avatar: AvatarResult,
  config: PipelineConfig,
  signal?: AbortSignal,
): Promise<{ videoUrl: string }> {
  const edit = buildEdit(script, assets, avatar, config);

  const layouts = script.beats.map(b => b.layout);
  console.log(`[Assembler] Built Shotstack edit: ${script.beats.length} beats, ${script.totalDurationSec}s`);
  console.log(`[Assembler] Layout sequence: ${layouts.join(" → ")}`);

  return renderVideo(edit, signal);
}

export function buildEdit(
  script: VideoScript,
  assets: AssetMap,
  avatar: AvatarResult,
  config: PipelineConfig,
): ShotstackEdit {
  // Build per-beat clips for each track layer
  // Shotstack layers: track 0 = topmost (rendered on top)
  const captionClips: ShotstackClip[] = [];
  const avatarBorderClips: ShotstackClip[] = [];
  const avatarClips: ShotstackClip[] = [];
  const brollBorderClips: ShotstackClip[] = [];
  const brollClips: ShotstackClip[] = [];

  const clipLength = Math.max(avatar.durationSec || script.totalDurationSec, 1);
  let effectIndex = 0;

  for (const beat of script.beats) {
    if (beat.durationSec <= 0) continue;
    const layout = beat.layout || "pip";

    // ── Captions (all layouts) ──
    buildCaptionClips(beat, layout, captionClips);

    // ── Avatar clips (layout-dependent) ──
    if (layout === "avatar_closeup") {
      // Large avatar, centered
      avatarClips.push(buildAvatarClip(avatar, beat, "closeup", config, clipLength));
      avatarBorderClips.push(buildAvatarBorderClip(beat, "closeup"));
    } else if (layout === "pip") {
      // Small avatar PIP bottom-left with border
      avatarClips.push(buildAvatarClip(avatar, beat, "pip", config, clipLength));
      avatarBorderClips.push(buildAvatarBorderClip(beat, "pip"));
      // B-roll in TV frame
      brollBorderClips.push(buildBrollBorderClip(beat));
      effectIndex = buildBrollClips(beat, assets, brollClips, effectIndex);
    } else if (layout === "fullscreen_broll") {
      // No avatar, full-screen b-roll
      effectIndex = buildBrollClipsFullscreen(beat, assets, brollClips, effectIndex);
    }
  }

  // Background
  const bgClip: ShotstackClip = {
    asset: {
      type: "html",
      html: '<div style="width:1080px;height:1920px;background:#000000;"></div>',
      width: 1080,
      height: 1920,
    } as ShotstackAsset,
    start: 0,
    length: script.totalDurationSec,
    fit: "none",
  };

  return {
    timeline: {
      tracks: [
        { clips: captionClips },       // Top: captions
        { clips: avatarBorderClips },   // Avatar border frame
        { clips: avatarClips },         // Avatar video
        { clips: brollBorderClips },    // B-roll TV frame border
        { clips: brollClips },          // B-roll visuals
        { clips: [bgClip] },           // Background
      ],
    },
    output: {
      format: "mp4",
      resolution: "1080",
      aspectRatio: "9:16",
      fps: 30,
    },
  };
}

// ─── Avatar Clip (per beat) ─────────────────────────────────
function buildAvatarClip(
  avatar: AvatarResult,
  beat: Beat,
  mode: "closeup" | "pip",
  config: PipelineConfig,
  totalClipLength: number,
): ShotstackClip {
  const avatarAsset: ShotstackAsset = {
    type: "video",
    src: avatar.videoUrl,
    trim: beat.startSec,  // Trim to this beat's portion of the continuous avatar video
  };

  const clip: Record<string, any> = {
    asset: avatarAsset,
    start: beat.startSec,
    length: beat.durationSec,
    fit: "crop",
  };

  if (mode === "closeup") {
    // Large avatar — center of screen, ~70% scale
    clip.scale = 0.7;
    clip.position = "center";
    clip.offset = { x: 0, y: -0.05 };  // Slightly above center
  } else {
    // PIP — small bottom-left, matching reference image
    clip.scale = config.avatarScale || 0.35;
    clip.position = config.avatarPosition || "bottomLeft";
    clip.offset = { x: 0.03, y: 0.10 };
  }

  // ChromaKey on clip level
  if (!avatar.transparent) {
    clip.chromaKey = {
      color: "#00FF00",
      threshold: 200,
      halo: 150,
    };
  }

  return clip as ShotstackClip;
}

// ─── Avatar Border Frame (per beat) ─────────────────────────
// Rounded border around the avatar to match reference image style
function buildAvatarBorderClip(beat: Beat, mode: "closeup" | "pip"): ShotstackClip {
  let borderHtml: string;
  let width: number;
  let height: number;

  if (mode === "pip") {
    // Small PIP border — matches the phone-card shape from reference
    width = 340;
    height = 420;
    borderHtml = `<div style="width:${width}px;height:${height}px;border:4px solid #333;border-radius:16px;box-shadow:0 0 20px rgba(0,0,0,0.8);"></div>`;
  } else {
    // Closeup border — larger centered frame
    width = 700;
    height = 900;
    borderHtml = `<div style="width:${width}px;height:${height}px;border:3px solid #444;border-radius:20px;box-shadow:0 0 30px rgba(0,0,0,0.6);"></div>`;
  }

  const clip: ShotstackClip = {
    asset: {
      type: "html",
      html: borderHtml,
      width,
      height,
    } as ShotstackAsset,
    start: beat.startSec,
    length: beat.durationSec,
    fit: "none",
    position: mode === "pip" ? "bottomLeft" : "center",
    offset: mode === "pip" ? { x: 0.03, y: 0.10 } : { x: 0, y: -0.05 },
  };

  return clip;
}

// ─── B-Roll Border (TV Frame) for PIP layout ────────────────
function buildBrollBorderClip(beat: Beat): ShotstackClip {
  // Rounded rectangle border for the b-roll "TV" area in PIP mode
  const borderHtml = `<div style="width:1020px;height:1050px;border:3px solid #333;border-radius:20px;box-shadow:0 4px 20px rgba(0,0,0,0.5);"></div>`;

  return {
    asset: {
      type: "html",
      html: borderHtml,
      width: 1020,
      height: 1050,
    } as ShotstackAsset,
    start: beat.startSec,
    length: beat.durationSec,
    fit: "none",
    position: "top",
    offset: { y: 0.02 },
  };
}

// ─── B-Roll Clips (PIP mode — top portion) ──────────────────
function buildBrollClips(
  beat: Beat,
  assets: AssetMap,
  clips: ShotstackClip[],
  effectIndex: number,
): number {
  const asset = assets[beat.id];

  if (!asset) {
    clips.push(buildFallbackClip(beat, "pip"));
    return effectIndex;
  }

  const isVideo = asset.mediaType === "video";
  const numSubClips = Math.max(1, Math.round(beat.durationSec / SUB_CLIP_DURATION));
  const subClipLength = Math.max(beat.durationSec / numSubClips, 0.5);

  for (let i = 0; i < numSubClips; i++) {
    const subStart = beat.startSec + (i * subClipLength);
    const shotstackAsset: ShotstackAsset = isVideo
      ? { type: "video", src: asset.url, trim: i * subClipLength }
      : { type: "image", src: asset.url };

    const clip: ShotstackClip = {
      asset: shotstackAsset,
      start: subStart,
      length: subClipLength,
      fit: "cover",
      position: "top",
      offset: { y: 0.02 },
      scale: 0.95,
    };

    if (!isVideo) {
      clip.effect = SUB_CLIP_EFFECTS[effectIndex % SUB_CLIP_EFFECTS.length];
      effectIndex++;
    }

    if (i > 0) {
      clip.transition = { in: "fade" };
    } else if (beat.transition !== "cut") {
      const trans = mapTransition(beat.transition);
      if (VALID_TRANSITIONS.has(trans)) {
        clip.transition = { in: trans };
      }
    }

    clips.push(clip);
  }

  return effectIndex;
}

// ─── B-Roll Clips (fullscreen_broll mode) ────────────────────
function buildBrollClipsFullscreen(
  beat: Beat,
  assets: AssetMap,
  clips: ShotstackClip[],
  effectIndex: number,
): number {
  const asset = assets[beat.id];

  if (!asset) {
    clips.push(buildFallbackClip(beat, "fullscreen"));
    return effectIndex;
  }

  const isVideo = asset.mediaType === "video";
  const numSubClips = Math.max(1, Math.round(beat.durationSec / SUB_CLIP_DURATION));
  const subClipLength = Math.max(beat.durationSec / numSubClips, 0.5);

  for (let i = 0; i < numSubClips; i++) {
    const subStart = beat.startSec + (i * subClipLength);
    const shotstackAsset: ShotstackAsset = isVideo
      ? { type: "video", src: asset.url, trim: i * subClipLength }
      : { type: "image", src: asset.url };

    const clip: ShotstackClip = {
      asset: shotstackAsset,
      start: subStart,
      length: subClipLength,
      fit: "cover",
      position: "center",
      scale: 1.0,  // Full screen
    };

    if (!isVideo) {
      clip.effect = SUB_CLIP_EFFECTS[effectIndex % SUB_CLIP_EFFECTS.length];
      effectIndex++;
    }

    if (i > 0) {
      clip.transition = { in: "fade" };
    }

    clips.push(clip);
  }

  return effectIndex;
}

// ─── Caption Clips (layout-aware positioning) ────────────────
function buildCaptionClips(beat: Beat, layout: LayoutMode, clips: ShotstackClip[]): void {
  const phrases = splitIntoPhrases(beat.narration);
  const rawDuration = beat.durationSec / phrases.length;
  const phraseDuration = Math.max(rawDuration, 0.5);

  // Caption position depends on layout
  let position: string;
  let offset: { x?: number; y?: number };

  if (layout === "avatar_closeup") {
    position = "bottom";
    offset = { y: 0.08 };  // Below avatar, above IG UI
  } else if (layout === "pip") {
    position = "bottomRight";
    offset = { x: -0.02, y: 0.12 };
  } else {
    // fullscreen_broll — centered at bottom
    position = "bottom";
    offset = { y: 0.10 };
  }

  let phraseStart = beat.startSec;
  for (let pi = 0; pi < phrases.length; pi++) {
    const remaining = (beat.startSec + beat.durationSec) - phraseStart;
    if (remaining <= 0) break;
    const thisLength = Math.min(phraseDuration, remaining);

    const html = buildCaptionHtml(phrases[pi], beat.captionEmphasis);
    clips.push({
      asset: {
        type: "html",
        html,
        width: layout === "pip" ? 580 : 900,
        height: 250,
      } as ShotstackAsset,
      start: phraseStart,
      length: thisLength,
      position: position as any,
      offset,
      transition: { in: "fade", out: "fade" },
    });
    phraseStart += thisLength;
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

function buildCaptionHtml(text: string, emphasisWords?: string[]): string {
  let styledText = escapeHtml(text);

  if (emphasisWords && emphasisWords.length > 0) {
    for (const word of emphasisWords) {
      const regex = new RegExp(`\\b(${escapeRegex(word)})\\b`, "gi");
      styledText = styledText.replace(regex, `<b style="color:${CAPTION_STYLES.highlightColor}">$1</b>`);
    }
  }

  return `<div style="font-family:${CAPTION_STYLES.fontFamily},sans-serif;font-size:${CAPTION_STYLES.fontSize}px;color:${CAPTION_STYLES.color};text-shadow:2px 2px ${CAPTION_STYLES.shadowBlur}px ${CAPTION_STYLES.shadowColor}, -1px -1px ${CAPTION_STYLES.shadowBlur}px ${CAPTION_STYLES.shadowColor};text-align:left;line-height:1.4;padding:16px 20px;background:rgba(0,0,0,0.5);border-radius:12px;">${styledText}</div>`;
}

function buildFallbackClip(beat: Beat, mode: "pip" | "fullscreen"): ShotstackClip {
  const w = mode === "pip" ? 1020 : 1080;
  const h = mode === "pip" ? 1050 : 1920;
  const html = `<div style="width:${w}px;height:${h}px;background:linear-gradient(135deg,#1a1a2e,#16213e);display:flex;align-items:center;justify-content:center;padding:60px;border-radius:${mode === "pip" ? 20 : 0}px;"><p style="font-family:Inter,sans-serif;font-size:48px;color:#00E5FF;text-align:center;line-height:1.4;">${escapeHtml(beat.narration.slice(0, 120))}</p></div>`;

  return {
    asset: { type: "html", html, width: w, height: h } as ShotstackAsset,
    start: beat.startSec,
    length: beat.durationSec,
    position: mode === "pip" ? "top" : "center",
    offset: mode === "pip" ? { y: 0.02 } : undefined,
    fit: "none",
  };
}

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
