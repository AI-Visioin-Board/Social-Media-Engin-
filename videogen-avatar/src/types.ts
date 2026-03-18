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

export interface Beat {
  id: number;
  startSec: number;
  durationSec: number;
  narration: string;
  visualType: VisualType;
  visualPrompt: string;
  visualSubject?: string;
  motionStyle: MotionStyle;
  transition: TransitionType;
  captionEmphasis?: string[];  // keywords to bold/highlight in captions
}

export type VisualType =
  | "named_person"
  | "product_logo_ui"
  | "cinematic_concept"
  | "generic_action"
  | "data_graphic"
  | "screen_capture";

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
  | "puppeteer_graphic";

export interface AssetRequest {
  beatId: number;
  source: AssetSource;
  prompt: string;
  subject?: string;
  aspectRatio: "9:16";
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
  source: AssetSource;
  mediaType: AssetMediaType;
  url: string;
  durationSec?: number;  // for video assets
  width: number;
  height: number;
  fallbackUsed: boolean;
  fallbackSource?: AssetSource;
}

export type AssetMap = Record<number, GeneratedAsset>;

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
