// ============================================================
// videogen-avatar — Stage 5: Assembler
// Builds Shotstack Edit JSON from script + assets + avatar
// Then submits to Shotstack for cloud rendering
//
// LAYOUT (PIP — Picture-in-Picture):
// ┌─────────────────────────────┐
// │  ┌───────────────────────┐  │
// │  │                       │  │
// │  │   B-ROLL (TV frame)   │  │
// │  │   Rounded corners     │  │
// │  │                       │  │
// │  └───────────────────────┘  │
// │                             │
// │ ┌──────┐                    │
// │ │AVATAR│  CAPTIONS          │
// │ │(PIP) │  (bottom-right)    │
// │ └──────┘                    │
// └─────────────────────────────┘
// Black background, 9:16 (1080x1920)
//
// B-roll switches every 2-3 seconds for fast-paced energy.
// Avatar has tight crop to eliminate green bleed at edges.
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

// Cycle through these effects on sub-clips for visual variety
const SUB_CLIP_EFFECTS = [
  "zoomInSlow", "zoomOutSlow", "slideRightSlow", "slideLeftSlow",
  "zoomInSlow", "slideUpSlow", "zoomOutSlow", "slideDownSlow",
];

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

// How long each sub-clip should be (seconds) for fast-paced b-roll
const SUB_CLIP_DURATION = 2.5;

export async function assembleVideo(
  script: VideoScript,
  assets: AssetMap,
  avatar: AvatarResult,
  config: PipelineConfig,
  signal?: AbortSignal,
): Promise<{ videoUrl: string }> {
  const edit = buildEdit(script, assets, avatar, config);

  const totalSubClips = edit.timeline.tracks[2]?.clips?.length ?? 0;
  console.log(`[Assembler] Built Shotstack edit: ${script.beats.length} beats → ${totalSubClips} b-roll sub-clips, ${script.totalDurationSec}s`);
  console.log(`[Assembler] Layout: PIP (avatar bottom-left, b-roll TV frame top, captions bottom-right)`);

  return renderVideo(edit, signal);
}

export function buildEdit(
  script: VideoScript,
  assets: AssetMap,
  avatar: AvatarResult,
  config: PipelineConfig,
): ShotstackEdit {
  // Shotstack layers: track 0 = topmost (rendered last/on top)
  // Order: captions → avatar PIP → b-roll frame border → b-roll clips → black background
  const captionTrack = buildCaptionTrack(script);
  const avatarTrack = buildAvatarTrack(avatar, script.totalDurationSec, config);
  const brollBorderTrack = buildBrollBorderTrack(script.totalDurationSec);
  const brollTrack = buildBrollTrack(script, assets);
  const backgroundTrack = buildBackgroundTrack(script.totalDurationSec);

  return {
    timeline: {
      tracks: [captionTrack, avatarTrack, brollBorderTrack, brollTrack, backgroundTrack],
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
    if (beat.durationSec <= 0) continue;  // Guard: skip zero-duration beats

    // Split narration into phrases (roughly 7 words each) for rapid captions
    const phrases = splitIntoPhrases(beat.narration);
    const rawDuration = beat.durationSec / phrases.length;
    // Use the same value for length AND advancement to prevent overlap/drift
    const phraseDuration = Math.max(rawDuration, 0.5);

    let phraseStart = beat.startSec;
    for (let pi = 0; pi < phrases.length; pi++) {
      // Don't let captions exceed the beat boundary
      const remaining = (beat.startSec + beat.durationSec) - phraseStart;
      if (remaining <= 0) break;
      const thisLength = Math.min(phraseDuration, remaining);

      const html = buildCaptionHtml(phrases[pi], beat.captionEmphasis);
      clips.push({
        asset: {
          type: "html",
          html,
          width: 580,
          height: 250,
        } as ShotstackAsset,
        start: phraseStart,
        length: thisLength,
        position: "bottomRight",
        offset: { x: -0.02, y: 0.12 },  // Keep above Instagram UI
        transition: { in: "fade", out: "fade" },
      });
      phraseStart += thisLength;
    }
  }

  return { clips };
}

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
// Tight crop to eliminate green bleed at top/bottom edges
function buildAvatarTrack(
  avatar: AvatarResult,
  totalDuration: number,
  config: PipelineConfig,
): ShotstackTrack {
  const avatarAsset: ShotstackAsset = {
    type: "video",
    src: avatar.videoUrl,
    trim: 0,
  };

  // Use avatar's actual duration if available, fall back to script total
  const clipLength = Math.max(avatar.durationSec || totalDuration, 1);

  const clip: Record<string, any> = {
    asset: avatarAsset,
    start: 0,
    length: clipLength,
    fit: "crop",       // Crop to fill — cuts off green edges at top/bottom
    scale: config.avatarScale || 0.35,
    position: config.avatarPosition || "bottomLeft",
    offset: { x: 0.03, y: 0.10 },  // Padding from edges, above IG UI
  };

  // ChromaKey goes on the CLIP (not asset) — removes green screen background
  if (!avatar.transparent) {
    clip.chromaKey = {
      color: "#00FF00",
      threshold: 200,   // Higher = more aggressive green removal
      halo: 150,         // Wider halo to catch green fringing at edges
    };
  }

  return { clips: [clip as ShotstackClip] };
}

// ─── B-Roll Border / Frame Track ────────────────────────────
// HTML overlay that creates a rounded "TV frame" effect around the b-roll area
// This sits ON TOP of the b-roll to mask it into a rounded rectangle
function buildBrollBorderTrack(totalDuration: number): ShotstackTrack {
  // Create a frame: black with a transparent rounded-rect cutout
  // The b-roll shows through the cutout, black hides the edges = rounded corners effect
  const frameHtml = `
    <div style="width:1080px;height:1920px;position:relative;">
      <!-- Top bar -->
      <div style="position:absolute;top:0;left:0;width:1080px;height:40px;background:#000;"></div>
      <!-- Bottom bar below b-roll zone (b-roll is ~1050px tall starting at 40px) -->
      <div style="position:absolute;top:1090px;left:0;width:1080px;height:830px;background:#000;"></div>
      <!-- Left bar -->
      <div style="position:absolute;top:0;left:0;width:30px;height:1920px;background:#000;"></div>
      <!-- Right bar -->
      <div style="position:absolute;top:0;right:0;width:30px;height:1920px;background:#000;"></div>
      <!-- Corner masks for rounded effect -->
      <div style="position:absolute;top:40px;left:30px;width:40px;height:40px;background:#000;border-bottom-right-radius:20px;"></div>
      <div style="position:absolute;top:40px;right:30px;width:40px;height:40px;background:#000;border-bottom-left-radius:20px;"></div>
      <div style="position:absolute;top:1050px;left:30px;width:40px;height:40px;background:#000;border-top-right-radius:20px;"></div>
      <div style="position:absolute;top:1050px;right:30px;width:40px;height:40px;background:#000;border-top-left-radius:20px;"></div>
    </div>
  `.replace(/\n\s*/g, "");

  return {
    clips: [{
      asset: {
        type: "html",
        html: frameHtml,
        width: 1080,
        height: 1920,
      } as ShotstackAsset,
      start: 0,
      length: totalDuration,
      fit: "none",
    }],
  };
}

// ─── B-Roll Track ───────────────────────────────────────────
// Visual clips in the upper portion of the screen
// Each beat's asset is split into 2-3 second sub-clips with
// alternating effects (zoom in/out, slide) for fast-paced energy
function buildBrollTrack(script: VideoScript, assets: AssetMap): ShotstackTrack {
  const clips: ShotstackClip[] = [];
  let effectIndex = 0;

  for (const beat of script.beats) {
    const asset = assets[beat.id];

    if (beat.durationSec <= 0) continue;  // Guard: skip zero-duration beats

    if (!asset) {
      clips.push(buildFallbackClip(beat));
      continue;
    }

    const isVideo = asset.mediaType === "video";

    // Split beat into sub-clips of ~2.5 seconds each
    const numSubClips = Math.max(1, Math.round(beat.durationSec / SUB_CLIP_DURATION));
    const subClipLength = Math.max(beat.durationSec / numSubClips, 0.5);  // Min 0.5s

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

      // Alternate effects on sub-clips for visual dynamism
      if (!isVideo) {
        clip.effect = SUB_CLIP_EFFECTS[effectIndex % SUB_CLIP_EFFECTS.length];
        effectIndex++;
      }

      // Add transition between sub-clips (not on the first one)
      if (i > 0 || beat.transition !== "cut") {
        const trans = i > 0 ? "fade" : mapTransition(beat.transition);
        if (VALID_TRANSITIONS.has(trans)) {
          clip.transition = { in: trans };
        }
      }

      clips.push(clip);
    }
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
  const html = `<div style="width:1020px;height:1050px;background:linear-gradient(135deg,#1a1a2e,#16213e);display:flex;align-items:center;justify-content:center;padding:60px;border-radius:20px;"><p style="font-family:Inter,sans-serif;font-size:48px;color:#00E5FF;text-align:center;line-height:1.4;">${escapeHtml(beat.narration.slice(0, 120))}</p></div>`;

  return {
    asset: { type: "html", html, width: 1020, height: 1050 },
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
