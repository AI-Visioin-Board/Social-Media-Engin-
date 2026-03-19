// ============================================================
// videogen-avatar — Stage 5: Assembler (Creatomate)
// Builds Creatomate RenderScript JSON from script + assets + avatar
// Then submits to Creatomate for cloud rendering
//
// 4 LAYOUT MODES per beat (set by scriptDirector):
//
// "avatar_closeup"    — Quinn fills ~70% of screen, no b-roll
// "pip"               — B-roll top (TV frame), Quinn small bottom-left
// "fullscreen_broll"  — Full-screen b-roll, no avatar, captions only
// "text_card"         — Bold text on colored background (stats, claims, hooks)
//
// RAPID-FIRE SUB-CLIPPING:
// Beats longer than 3s get split into 2-3s visual sub-clips.
// For Pexels beats with multiple clips, each sub-clip uses a different asset.
// For single-asset beats (AI gen), still images get Ken Burns,
// video clips get trim_start offsets to show different segments.
//
// Key advantage over Shotstack:
// - Same track = sequential (no manual startSec needed for b-roll)
// - border_radius works natively (no HTML overlay hacks)
// - No chromaKey needed — black background from HeyGen
// ============================================================

import type {
  VideoScript,
  Beat,
  LayoutMode,
  AssetMap,
  MultiAssetMap,
  AvatarResult,
  PipelineConfig,
  GeneratedAsset,
} from "./types.js";
import { renderVideo } from "./utils/creatomateClient.js";

// Sub-clip duration for rapid-fire visual cuts
const SUB_CLIP_SEC = 2.5;
// Minimum sub-clip duration (don't create tiny clips)
const MIN_SUB_CLIP_SEC = 1.5;
// Words per caption phrase (shorter = punchier)
const WORDS_PER_PHRASE = 4;

// Background music — disabled until a verified royalty-free URL is configured.
// Set BACKGROUND_MUSIC_URL in env to enable.
// Pixabay URLs expire; using an unreliable URL will crash the entire Creatomate render.
const BG_MUSIC_URL = process.env.BACKGROUND_MUSIC_URL || "";

export async function assembleVideo(
  script: VideoScript,
  assets: AssetMap,
  avatar: AvatarResult,
  config: PipelineConfig,
  signal?: AbortSignal,
  multiAssets?: MultiAssetMap,
): Promise<{ videoUrl: string }> {
  const source = buildSource(script, assets, avatar, config, multiAssets);

  const layouts = script.beats.map(b => b.layout);
  const totalClips = countVisualClips(script, assets, multiAssets);
  console.log(`[Assembler] Creatomate render: ${script.beats.length} beats, ${totalClips} visual clips, ${script.totalDurationSec}s`);
  console.log(`[Assembler] Layouts: ${layouts.join(" → ")}`);

  return renderVideo(source, signal);
}

export function buildSource(
  script: VideoScript,
  assets: AssetMap,
  avatar: AvatarResult,
  config: PipelineConfig,
  multiAssets?: MultiAssetMap,
): Record<string, any> {
  const beatCompositions: any[] = [];

  // Scale factor: HeyGen avatar duration may differ from script duration
  // (speech rate varies). Scale trim_start so beats map to actual avatar timeline.
  const avatarScale = avatar.durationSec > 0 && script.totalDurationSec > 0
    ? avatar.durationSec / script.totalDurationSec
    : 1;

  for (const beat of script.beats) {
    if (beat.durationSec <= 0) continue;
    const comp = buildBeatComposition(beat, assets, avatar, config, multiAssets, avatarScale);
    beatCompositions.push(comp);
  }

  const elements: any[] = [...beatCompositions];

  // Background music — low volume, spans entire video
  // Only added if a valid URL is configured (avoids crashing render on bad URL)
  if (config.includeBackgroundMusic && BG_MUSIC_URL) {
    elements.push({
      type: "audio",
      source: BG_MUSIC_URL,
      duration: script.totalDurationSec,
      volume: "12%",  // Very low — voice is king
    });
  }

  return {
    output_format: "mp4",
    width: 1440,
    height: 2560,
    frame_rate: 30,
    elements,
  };
}

// ─── Beat Composition ──────────────────────────────────────
function buildBeatComposition(
  beat: Beat,
  assets: AssetMap,
  avatar: AvatarResult,
  config: PipelineConfig,
  multiAssets?: MultiAssetMap,
  avatarScale: number = 1,
): Record<string, any> {
  const layout: LayoutMode = beat.layout || "pip";
  const elements: any[] = [];

  // Black background
  elements.push({
    type: "shape",
    width: "100%",
    height: "100%",
    fill_color: "#0a0a0a",
  });

  if (layout === "avatar_closeup") {
    buildCloseupElements(beat, avatar, elements, avatarScale);
  } else if (layout === "pip") {
    buildPipElements(beat, assets, avatar, config, elements, multiAssets, avatarScale);
  } else if (layout === "fullscreen_broll") {
    buildFullscreenBrollElements(beat, assets, elements, multiAssets);
  } else if (layout === "text_card") {
    buildTextCardElements(beat, elements);
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
    // Transition between beats
    ...(beat.id > 1 ? { transition: mapTransition(beat.transition) } : {}),
  };
}

// ─── Avatar Closeup Layout ─────────────────────────────────
function buildCloseupElements(
  beat: Beat,
  avatar: AvatarResult,
  elements: any[],
  avatarScale: number = 1,
): void {
  if (!avatar.videoUrl) {
    // No avatar available — show text card fallback
    elements.push({
      type: "text",
      text: beat.narration.slice(0, 120),
      font_family: "Inter",
      font_weight: "700",
      font_size: "5 vmin",
      fill_color: "#FFFFFF",
      x: "50%",
      y: "50%",
      width: "85%",
      x_alignment: "50%",
      y_alignment: "50%",
    });
    return;
  }

  // Gray card border behind avatar
  elements.push({
    type: "shape",
    x: "50%",
    y: "45%",
    width: "83%",
    height: "74%",
    fill_color: "#333333",
    border_radius: "3 vmin",
    shadow_color: "rgba(0,0,0,0.5)",
    shadow_blur: "2 vmin",
  });
  elements.push({
    type: "video",
    source: avatar.videoUrl,
    trim_start: beat.startSec * avatarScale,
    trim_duration: beat.durationSec * avatarScale,
    x: "50%",
    y: "45%",
    width: "80%",
    height: "71%",
    fit: "cover",
    border_radius: "2.5 vmin",
  });
}

// ─── PIP Layout ────────────────────────────────────────────
// B-roll in top area (TV screen with rounded corners + border), Quinn bottom-right with card
function buildPipElements(
  beat: Beat,
  assets: AssetMap,
  avatar: AvatarResult,
  config: PipelineConfig,
  elements: any[],
  multiAssets?: MultiAssetMap,
  avatarScale: number = 1,
): void {
  const beatAssets = multiAssets?.[beat.id] ?? (assets[beat.id] ? [assets[beat.id]] : []);

  // ── TV Screen border (gray rounded rect behind b-roll) ──
  elements.push({
    type: "shape",
    x: "50%",
    y: "28%",
    width: "94%",
    height: "52%",
    fill_color: "#2a2a2a",
    border_radius: "2.5 vmin",
  });

  if (beatAssets.length > 0) {
    // RAPID-FIRE: Split beat into sub-clips, each showing a different asset
    const subClips = buildSubClips(beat.durationSec, beatAssets);

    for (const sub of subClips) {
      const asset = sub.asset;
      const isVideo = asset.mediaType === "video";

      if (isVideo) {
        elements.push({
          type: "video",
          track: 3,  // B-roll track (sequential within beat)
          source: asset.url,
          duration: sub.duration,
          trim_start: sub.trimStart,
          trim_duration: sub.duration,
          x: "50%",
          y: "28%",
          width: "90%",
          height: "49%",
          fit: "cover",
          border_radius: "2 vmin",
          ...(sub.index > 0 ? { transition: { type: "fade", duration: 0.2 } } : {}),
        });
      } else {
        elements.push({
          type: "image",
          track: 3,
          source: asset.url,
          duration: sub.duration,
          x: "50%",
          y: "28%",
          width: "90%",
          height: "49%",
          fit: "cover",
          border_radius: "2 vmin",
          animations: [{
            type: "scale",
            scope: "element",
            start_scale: sub.index % 2 === 0 ? "100%" : "110%",
            end_scale: sub.index % 2 === 0 ? "110%" : "100%",
            easing: "linear",
          }],
          ...(sub.index > 0 ? { transition: { type: "fade", duration: 0.2 } } : {}),
        });
      }
    }
  } else {
    // Fallback: dark card with text inside TV frame
    elements.push({
      type: "text",
      text: beat.narration.slice(0, 80),
      x: "50%",
      y: "28%",
      width: "80%",
      height: "45%",
      font_family: "Inter",
      font_size: "4 vmin",
      fill_color: "#00E5FF",
      x_alignment: "50%",
      y_alignment: "50%",
    });
  }

  // ── Avatar PIP — bottom-right with gray card border ──
  if (avatar.videoUrl) {
    // Gray card background behind avatar
    elements.push({
      type: "shape",
      x: "76%",
      y: "80%",
      width: "40%",
      height: "32%",
      fill_color: "#333333",
      border_radius: "2 vmin",
      shadow_color: "rgba(0,0,0,0.6)",
      shadow_blur: "2 vmin",
    });
    // Avatar video on top of card
    elements.push({
      type: "video",
      source: avatar.videoUrl,
      trim_start: beat.startSec * avatarScale,
      trim_duration: beat.durationSec * avatarScale,
      x: "76%",
      y: "80%",
      width: "37%",
      height: "29%",
      fit: "cover",
      border_radius: "1.5 vmin",
    });
  }
}

// ─── Fullscreen B-Roll Layout ──────────────────────────────
function buildFullscreenBrollElements(
  beat: Beat,
  assets: AssetMap,
  elements: any[],
  multiAssets?: MultiAssetMap,
): void {
  const beatAssets = multiAssets?.[beat.id] ?? (assets[beat.id] ? [assets[beat.id]] : []);

  if (beatAssets.length > 0) {
    // RAPID-FIRE: Multiple sub-clips cycling through assets
    const subClips = buildSubClips(beat.durationSec, beatAssets);

    for (const sub of subClips) {
      const asset = sub.asset;
      const isVideo = asset.mediaType === "video";

      elements.push({
        type: isVideo ? "video" : "image",
        track: 3,  // B-roll track
        source: asset.url,
        duration: sub.duration,
        ...(isVideo ? { trim_start: sub.trimStart, trim_duration: sub.duration } : {}),
        x: "50%",
        y: "50%",
        width: "100%",
        height: "100%",
        fit: "cover",
        // Dark overlay for caption readability — applied via a shape element layered on top
        opacity: "85%",
        ...(!isVideo ? {
          animations: [{
            type: "scale",
            scope: "element",
            start_scale: sub.index % 2 === 0 ? "100%" : "108%",
            end_scale: sub.index % 2 === 0 ? "108%" : "100%",
            easing: "linear",
          }],
        } : {}),
        ...(sub.index > 0 ? { transition: { type: "fade", duration: 0.25 } } : {}),
      });
    }
  } else {
    // Fallback solid background
    elements.push({
      type: "shape",
      width: "100%",
      height: "100%",
      fill_color: "#1a1a2e",
    });
  }
}

// ─── Text Card Layout ──────────────────────────────────────
// Bold text on colored background — for hooks, stats, claims
// No b-roll, no avatar. Maximum visual impact.
function buildTextCardElements(
  beat: Beat,
  elements: any[],
): void {
  const bgColor = beat.textCardColor || pickTextCardColor(beat.id);
  const cardText = beat.textCardText || extractKeyPhrase(beat.narration);

  // Full-screen colored background
  elements.push({
    type: "shape",
    width: "100%",
    height: "100%",
    fill_color: bgColor,
  });

  // Large bold text — centered
  elements.push({
    type: "text",
    text: cardText,
    font_family: "Inter",
    font_weight: "900",
    font_size: "8 vmin",
    fill_color: "#FFFFFF",
    x: "50%",
    y: "45%",
    width: "85%",
    x_alignment: "50%",
    y_alignment: "50%",
    line_height: "120%",
    shadow_color: "rgba(0,0,0,0.3)",
    shadow_blur: "1 vmin",
    // Scale in animation
    animations: [
      { type: "scale", scope: "element", start_scale: "85%", end_scale: "100%", duration: 0.3, easing: "ease-out" },
    ],
  });

  // Small "— Quinn" attribution at bottom
  elements.push({
    type: "text",
    text: "SuggestedByGPT.com",
    font_family: "Inter",
    font_weight: "500",
    font_size: "2.5 vmin",
    fill_color: "rgba(255,255,255,0.6)",
    x: "50%",
    y: "92%",
    x_alignment: "50%",
    y_alignment: "50%",
  });
}

// ─── Captions ──────────────────────────────────────────────
// Short phrase-by-phrase captions — bold italic with keyword highlighting
// Creatomate doesn't support HTML in text, so we use separate elements
// for highlighted keywords (cyan overlay on top of white base text)
function buildCaptionElements(
  beat: Beat,
  layout: LayoutMode,
  elements: any[],
): void {
  // Text card has its own text treatment — skip captions
  if (layout === "text_card") return;

  const phrases = splitIntoPhrases(beat.narration);
  const phraseDuration = beat.durationSec / phrases.length;

  // Position based on layout
  let captionX = "50%";
  let captionY = "90%";
  let captionWidth = "90%";

  if (layout === "pip") {
    // Bottom-left area (avatar is bottom-right now)
    captionX = "30%";
    captionY = "82%";
    captionWidth = "50%";
  } else if (layout === "avatar_closeup") {
    captionY = "88%";
  } else if (layout === "fullscreen_broll") {
    captionY = "85%";
  }

  for (let i = 0; i < phrases.length; i++) {
    // Clean text — no HTML tags
    const cleanText = phrases[i];

    // Check if this phrase contains any emphasis words
    const hasEmphasis = beat.captionEmphasis?.some(w =>
      cleanText.toLowerCase().includes(w.toLowerCase())
    );

    elements.push({
      type: "text",
      track: 2,  // Caption track (sequential within beat)
      duration: Math.max(phraseDuration, 0.5),
      text: cleanText,
      font_family: "Inter",
      font_weight: 800,
      font_style: "italic",
      font_size: "5 vmin",
      fill_color: hasEmphasis ? "#00E5FF" : "#FFFFFF",
      shadow_color: "rgba(0,0,0,0.95)",
      shadow_blur: "1.5 vmin",
      background_color: "rgba(0,0,0,0.6)",
      background_border_radius: "12%",
      background_x_padding: "10%",
      background_y_padding: "8%",
      x: captionX,
      y: captionY,
      width: captionWidth,
      x_alignment: "50%",
      y_alignment: "50%",
      line_height: "130%",
      letter_spacing: "1%",
      animations: [
        { type: "text-appear", scope: "element", duration: 0.12 },
      ],
      ...(i > 0 ? { transition: { type: "fade", duration: 0.1 } } : {}),
    });
  }
}

// ─── Sub-Clip Builder ──────────────────────────────────────
// Splits a beat's duration into rapid-fire sub-clips, cycling through available assets
interface SubClip {
  index: number;
  duration: number;
  trimStart: number;
  asset: GeneratedAsset;
}

function buildSubClips(beatDuration: number, assets: GeneratedAsset[]): SubClip[] {
  if (assets.length === 0) return [];

  // For very short beats (<= SUB_CLIP_SEC), just use the first asset
  if (beatDuration <= SUB_CLIP_SEC + 0.5) {
    return [{
      index: 0,
      duration: beatDuration,
      trimStart: 0,
      asset: assets[0],
    }];
  }

  // Calculate how many sub-clips we need
  const numClips = Math.max(2, Math.ceil(beatDuration / SUB_CLIP_SEC));
  const clipDuration = beatDuration / numClips;

  // Ensure minimum duration
  if (clipDuration < MIN_SUB_CLIP_SEC) {
    const adjustedNum = Math.floor(beatDuration / MIN_SUB_CLIP_SEC);
    return buildEvenSubClips(beatDuration, Math.max(1, adjustedNum), assets);
  }

  return buildEvenSubClips(beatDuration, numClips, assets);
}

function buildEvenSubClips(
  totalDuration: number,
  count: number,
  assets: GeneratedAsset[],
): SubClip[] {
  const clipDuration = totalDuration / count;
  const subClips: SubClip[] = [];

  for (let i = 0; i < count; i++) {
    // Cycle through available assets
    const asset = assets[i % assets.length];

    // For video assets with different clips, use trim_start offset
    let trimStart = 0;
    if (asset.mediaType === "video" && asset.durationSec) {
      // If same video asset repeating, offset into different parts
      const assetsOfSameUrl = subClips.filter(s => s.asset.url === asset.url).length;
      trimStart = Math.min(assetsOfSameUrl * clipDuration, Math.max(0, (asset.durationSec || 5) - clipDuration));
    }

    subClips.push({
      index: i,
      duration: clipDuration,
      trimStart,
      asset,
    });
  }

  return subClips;
}

// ─── Transition Mapper ─────────────────────────────────────
// Returns the transition OBJECT (not wrapped in { transition: ... })
// because the caller already spreads it as { transition: mapTransition(...) }
function mapTransition(transition?: string): Record<string, any> {
  switch (transition) {
    case "dissolve":
      return { type: "fade", duration: 0.4 };
    case "zoom_in":
      return { type: "fade", duration: 0.3 }; // Creatomate doesn't have native zoom transition
    case "slide_left":
      return { type: "slide", duration: 0.3, direction: "left" };
    case "cut":
    default:
      return { type: "fade", duration: 0.15 }; // Quick fade instead of hard cut (smoother)
  }
}

// ─── Helpers ────────────────────────────────────────────────

function splitIntoPhrases(text: string): string[] {
  const words = text.split(/\s+/);
  const phrases: string[] = [];

  for (let i = 0; i < words.length; i += WORDS_PER_PHRASE) {
    const phrase = words.slice(i, i + WORDS_PER_PHRASE).join(" ");
    if (phrase.trim()) phrases.push(phrase);
  }

  return phrases.length > 0 ? phrases : [text];
}

// highlightEmphasis removed — Creatomate doesn't support HTML in text fields.
// Keyword highlighting is now done by coloring the entire phrase cyan
// when it contains an emphasis word (see buildCaptionElements).

// Pick vibrant background colors for text cards
const TEXT_CARD_COLORS = [
  "#FF0000",  // Red — urgency, hooks
  "#1a1a2e",  // Dark navy — sophisticated
  "#0066FF",  // Electric blue — tech
  "#FF6B00",  // Orange — energy
  "#7B2FBE",  // Purple — premium
  "#00C853",  // Green — positive/money
  "#000000",  // Black — dramatic
];

function pickTextCardColor(beatId: number): string {
  return TEXT_CARD_COLORS[beatId % TEXT_CARD_COLORS.length];
}

// Extract the most impactful short phrase from narration for text card display
function extractKeyPhrase(narration: string): string {
  if (!narration || narration.trim().length === 0) return "...";

  // Look for content in quotes first
  const quoted = narration.match(/"([^"]+)"/);
  if (quoted && quoted[1].length <= 80) return quoted[1];

  // Look for numbers/stats — grab the sentence containing them
  const statMatch = narration.match(/(\$[\d,.]+\s*\w+|\d+%|\d+\s*(?:million|billion|trillion))/i);
  if (statMatch) {
    const idx = narration.indexOf(statMatch[0]);
    // Find sentence boundaries around the stat
    const sentenceStart = Math.max(0, narration.lastIndexOf(".", Math.max(0, idx - 1)) + 1);
    const dotAfter = narration.indexOf(".", idx + statMatch[0].length);
    const sentenceEnd = dotAfter > idx ? dotAfter : narration.length;
    const sentence = narration.slice(sentenceStart, sentenceEnd).trim();
    if (sentence.length <= 80) return sentence;
    // If sentence too long, just use the stat + some context
    return sentence.slice(0, 77) + "...";
  }

  // Fallback: first sentence, capped at 60 chars
  const firstSentence = narration.split(/[.!?]/)[0]?.trim() || narration;
  if (firstSentence.length <= 60) return firstSentence;
  return firstSentence.slice(0, 57) + "...";
}

// Count total visual clips for logging
function countVisualClips(
  script: VideoScript,
  assets: AssetMap,
  multiAssets?: MultiAssetMap,
): number {
  let count = 0;
  for (const beat of script.beats) {
    const beatAssets = multiAssets?.[beat.id] ?? (assets[beat.id] ? [assets[beat.id]] : []);
    if (beat.layout === "text_card" || beat.layout === "avatar_closeup") {
      count += 1; // These layouts are single-visual
    } else if (beatAssets.length > 0) {
      const subClips = buildSubClips(beat.durationSec, beatAssets);
      count += subClips.length;
    } else {
      count += 1; // Fallback card
    }
  }
  return count;
}
