// ============================================================
// videogen-avatar — Stage 5: Assembler
// Builds Shotstack Edit JSON from script + assets + avatar
// Then submits to Shotstack for cloud rendering
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

const CAPTION_STYLES = {
  fontFamily: "Inter",
  fontSize: 44,
  color: "#FFFFFF",
  highlightColor: "#00E5FF",
  shadowColor: "rgba(0,0,0,0.8)",
  shadowBlur: 8,
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
  console.log(`[Assembler] Tracks: captions(${edit.timeline.tracks[0].clips.length}), avatar(1), broll(${edit.timeline.tracks[2].clips.length})`);

  return renderVideo(edit, signal);
}

export function buildEdit(
  script: VideoScript,
  assets: AssetMap,
  avatar: AvatarResult,
  config: PipelineConfig,
): ShotstackEdit {
  const captionTrack = buildCaptionTrack(script);
  const avatarTrack = buildAvatarTrack(avatar, script.totalDurationSec, config);
  const brollTrack = buildBrollTrack(script, assets);

  return {
    timeline: {
      tracks: [captionTrack, avatarTrack, brollTrack],
    },
    output: {
      format: "mp4",
      resolution: "1080",
      aspectRatio: "9:16",
      fps: 30,
    },
  };
}

function buildCaptionTrack(script: VideoScript): ShotstackTrack {
  const clips: ShotstackClip[] = script.beats.map(beat => {
    const html = buildCaptionHtml(beat);
    return {
      asset: {
        type: "html",
        html,
        width: 900,
        height: 200,
      } as ShotstackAsset,
      start: beat.startSec,
      length: beat.durationSec,
      position: "center",
      offset: { y: 0.15 },
      transition: { in: "fade", out: "fade" },
    };
  });

  return { clips };
}

function buildCaptionHtml(beat: Beat): string {
  let text = beat.narration;

  // Highlight emphasis words
  if (beat.captionEmphasis && beat.captionEmphasis.length > 0) {
    for (const word of beat.captionEmphasis) {
      const regex = new RegExp(`\\b(${escapeRegex(word)})\\b`, "gi");
      text = text.replace(regex, `<b style="color:${CAPTION_STYLES.highlightColor}">$1</b>`);
    }
  }

  return `<p style="font-family:${CAPTION_STYLES.fontFamily};font-size:${CAPTION_STYLES.fontSize}px;color:${CAPTION_STYLES.color};text-shadow:2px 2px ${CAPTION_STYLES.shadowBlur}px ${CAPTION_STYLES.shadowColor};text-align:center;line-height:1.3;margin:0;padding:20px;">${text}</p>`;
}

function buildAvatarTrack(
  avatar: AvatarResult,
  totalDuration: number,
  config: PipelineConfig,
): ShotstackTrack {
  const clip: ShotstackClip = {
    asset: {
      type: "video",
      src: avatar.videoUrl,
      trim: 0,
      chromaKey: {
        color: "#00FF00",
        threshold: 150,
        halo: 100,
      },
    } as any,
    start: 0,
    length: totalDuration,
    fit: "crop",
    scale: config.avatarScale,
    position: config.avatarPosition,
    offset: {
      x: config.avatarPosition === "bottomRight" ? -0.05 : 0.05,
      y: 0.08,
    },
  };

  return { clips: [clip] };
}

function buildBrollTrack(script: VideoScript, assets: AssetMap): ShotstackTrack {
  const clips: ShotstackClip[] = [];

  for (const beat of script.beats) {
    const asset = assets[beat.id];

    if (!asset) {
      // Emergency fallback: solid color with text
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
    };

    // Add transition
    if (beat.transition !== "cut") {
      clip.transition = { in: mapTransition(beat.transition) };
    }

    // Add Ken Burns effect for still images
    if (!isVideo && beat.motionStyle === "static_ken_burns") {
      clip.effect = "zoomIn";
    }

    clips.push(clip);
  }

  return { clips };
}

function buildFallbackClip(beat: Beat): ShotstackClip {
  const html = `<div style="width:1080px;height:1920px;background:linear-gradient(135deg,#1a1a2e,#16213e);display:flex;align-items:center;justify-content:center;padding:60px;"><p style="font-family:Inter;font-size:52px;color:#00E5FF;text-align:center;line-height:1.4;">${escapeHtml(beat.narration)}</p></div>`;

  return {
    asset: { type: "html", html, width: 1080, height: 1920 },
    start: beat.startSec,
    length: beat.durationSec,
    fit: "none",
  };
}

function mapTransition(t: string): string {
  switch (t) {
    case "dissolve": return "fade";
    case "zoom_in": return "fade";  // Shotstack doesn't have zoom transition, use fade
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
