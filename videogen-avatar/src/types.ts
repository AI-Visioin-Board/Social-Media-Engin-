// ============================================================
// videogen-avatar — Type Definitions
// All interfaces for the 7-stage avatar video pipeline
// ============================================================

// --------------- Stage 1: Script Director Output ---------------

export interface VideoScript {
  topic: string;
  hook: string;
  totalDurationSec: number;
  beats: Beat[];
  caption: string;
  hashtags: string[];
  cta: string;
}

export type LayoutMode =
  | "pip" | "fullscreen_broll" | "avatar_closeup" | "text_card"
  | "device_mockup" | "icon_grid" | "motion_graphic";

export interface Beat {
  id: number;
  startSec: number;
  durationSec: number;
  narration: string;
  layout: LayoutMode;           // controls avatar/b-roll framing per beat
  visualType: VisualType;
  visualPrompt: string;
  visualSubject?: string;
  motionStyle: MotionStyle;
  transition: TransitionType;
  captionEmphasis?: string[];  // keywords to bold/highlight in captions
  textCardText?: string;       // large text for text_card layout (stat, claim, quote)
  textCardColor?: string;      // background color for text_card layout (e.g., "#FF0000")

  // ─── Smart Visual Hints (Script Director → Remotion) ──────
  // Multi-style caption word treatments (key = word, value = style name)
  wordStyles?: Record<string, "hero" | "action" | "danger" | "pill">;
  // Whether this beat should get a camera zoom punch (emphatic moment)
  zoomPunch?: boolean;
  // If true, rendered entirely by a Remotion component — no b-roll fetch needed
  remotionOnly?: boolean;
  // For icon_grid layout: list of emoji+label items (2-4 items)
  iconGridItems?: Array<{ emoji: string; label: string }>;
  // For device_mockup layout: which device frame to use
  deviceType?: "macbook" | "iphone";

  // ─── Sub-Shot Density (v9, 4x visual density pass) ────────
  // Ordered sub-shots inside this beat. Each shot fetches its own asset and
  // renders with a hard-cut transition. Required for pip / fullscreen_broll /
  // device_mockup beats ≥ 3s. Ignored for avatar_closeup / text_card /
  // icon_grid / motion_graphic (those layouts animate internally).
  shots?: Shot[];

  // Section marker used by downstream matching (HOOK, DAYTAG, STEP1, etc.)
  section?: string;
}

// A single visual beat inside a larger Beat. Durations are relative to the
// start of the parent beat.
export interface Shot {
  idx: number;              // 1-based index inside parent beat
  startSec: number;         // offset from beat.startSec
  durationSec: number;      // 0.7 – 2.5 typical
  visualType: VisualType;
  visualPrompt: string;
  visualSubject?: string;
  motionStyle: MotionStyle;
  emphasisWord?: string;    // 1-3 words to burn-in as a yellow-pill chyron
  // Resolved by asset generator once the file lands on disk
  assetPath?: string;
}

export type VisualType =
  | "named_person"
  | "product_logo_ui"
  | "cinematic_concept"
  | "generic_action"
  | "data_graphic"
  | "screen_capture"
  | "reaction_clip"       // talking-head clip of a named AI figure (Altman, Amodei, etc.)
  | "brand_logo_card"     // single brand logo on gradient background
  | "stat_card";          // huge number + small label, Remotion-rendered

export type MotionStyle =
  | "static_ken_burns"
  | "ai_video"
  | "stock_clip"
  | "screen_capture";

export type TransitionType = "cut" | "dissolve" | "zoom_in" | "slide_left";

// --------------- Stage 2: Asset Router Output ---------------

export type AssetSource =
  | "nano_banana"
  | "kling_t2v"
  | "kling_i2v"
  | "pexels"
  | "puppeteer_graphic"
  | "headless_capture";

export interface AssetRequest {
  beatId: number;
  shotIdx?: number;      // when populated, this request is for a sub-shot inside the beat
  source: AssetSource;
  prompt: string;
  subject?: string;
  aspectRatio: "9:16" | "1:1";
  dependsOn?: number;  // beatId of a dependency (e.g. I2V depends on Nano Banana still)
  fallbackChain: AssetSource[];
}

export interface AssetManifest {
  requests: AssetRequest[];
  parallelGroups: ParallelGroup[];
}

export interface ParallelGroup {
  source: AssetSource;
  beatIds: number[];
  maxConcurrent: number;
}

// --------------- Stage 3: Asset Generation Output ---------------

export type AssetMediaType = "image" | "video";

export interface GeneratedAsset {
  beatId: number;
  shotIdx?: number;      // when populated, this asset belongs to beat.shots[shotIdx]
  source: AssetSource;
  mediaType: AssetMediaType;
  url: string;
  durationSec?: number;  // for video assets
  width: number;
  height: number;
  fallbackUsed: boolean;
  fallbackSource?: AssetSource;
}

// Single asset per beat (primary)
export type AssetMap = Record<number, GeneratedAsset>;

// Multiple assets per beat for rapid-fire sub-clips (e.g., multiple Pexels clips)
export type MultiAssetMap = Record<number, GeneratedAsset[]>;

// --------------- Stage 4: Avatar Output ---------------

export interface AvatarResult {
  videoUrl: string;
  durationSec: number;
  format: "webm" | "mp4";
  transparent: boolean;
}

// --------------- Stage 5: Assembly (Shotstack) ---------------

export interface ShotstackEdit {
  timeline: {
    tracks: ShotstackTrack[];
  };
  output: {
    format: "mp4";
    resolution: "1080";
    aspectRatio: "9:16";
    fps: number;
  };
}

export interface ShotstackTrack {
  clips: ShotstackClip[];
}

export interface ShotstackClip {
  asset: ShotstackAsset;
  start: number;
  length: number | "end";
  fit?: "crop" | "cover" | "contain" | "none";
  scale?: number;
  position?: "center" | "top" | "topLeft" | "topRight" | "bottom" | "bottomLeft" | "bottomRight" | "left" | "right";
  offset?: { x?: number; y?: number };
  transition?: { in?: string; out?: string };
  effect?: string;
  chromaKey?: { color: string; threshold: number; halo: number };
}

export type ShotstackAsset =
  | { type: "video"; src: string; trim?: number }
  | { type: "image"; src: string }
  | { type: "html"; html: string; width: number; height: number; css?: string };

// --------------- Stage 7: Delivery ---------------

export interface DeliveryResult {
  videoUrl: string;
  storagePath: string;
  duration: number;
  topic: string;
  postedAt?: Date;
}

// --------------- Pipeline Orchestrator ---------------

export interface PipelineConfig {
  topic: string;
  targetDurationSec: number;  // 45-90
  avatarPosition: "bottomRight" | "bottomLeft";
  avatarScale: number;        // 0.25-0.35
  captionStyle: "bold_highlight" | "word_by_word";
  includeBackgroundMusic: boolean;
  autoPost: boolean;
}

export interface PipelineRun {
  runId: string;
  config: PipelineConfig;
  status: PipelineStatus;
  script?: VideoScript;
  assets?: AssetMap;
  avatar?: AvatarResult;
  assemblyUrl?: string;
  finalUrl?: string;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
}

export type PipelineStatus =
  | "scripting"
  | "routing"
  | "generating_assets"
  | "generating_avatar"
  | "assembling"
  | "post_processing"
  | "delivering"
  | "completed"
  | "failed";
