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
  | "device_mockup" | "icon_grid" | "motion_graphic"
  | "cold_open_hook";   // V9 — Section 12a pattern-interrupt opener (visuals only, Quinn VO optional)

// V9 Section 12a — pattern-interrupt archetypes for cold-open hooks
export type HookArchetype =
  | "A1_object_collision"       // efficiency/time/reduction (clock + scissors)
  | "A2_villain_vs_hero"        // competitive ("X killed Y")
  | "A3_before_after_jumpcut"   // transformation/automation
  | "A4_cartoon_reaction"       // shocking/surprising
  | "A5_ui_gesture_macro"       // specific feature reveal
  | "A6_icon_storm"             // tool overload / consolidation
  | "A7_text_as_visual"         // quote/announcement/stat
  | "A8_pov_first_person";      // workflow / new UX

// V9 Section 0.5 — shot-level spec a Beat can fan out into (2-3 sub-shots)
export interface ShotSpec {
  durationSec: number;                 // 0.8–2.0 HARD CAP per Law 0.6
  cameraMove:
    | "locked" | "slow_push_in" | "slow_pull_out"
    | "whip_pan" | "handheld_drift" | "macro_rack_focus"
    | "crane_down" | "orbit";
  onScreenContent: string;             // cinematographer-grade description (Law 0.4)
  progressiveElements?: Array<{        // causal chain per Law 0.3
    what: string;
    appearsAtMs: number;               // relative to shot start
    how:
      | "slide_left" | "slide_right" | "slide_up" | "slide_down"
      | "scale_up" | "scale_down"
      | "letter_by_letter" | "write_on"
      | "fade_in" | "wipe_in";
  }>;
  captionOverlay?: {
    text: string;                      // ≤6 words for hook kickers per Section 12a.4
    entryDirection:
      | "slide_left" | "slide_right" | "slide_up" | "slide_down"
      | "scale_up" | "letter_by_letter";
    offsetMs: number;                  // relative to shot start
  };
  transitionOut:
    | "cut" | "whip_pan" | "flash_cut" | "shader_wipe"
    | "cross_dissolve" | "zoom_punch" | "jumbotron";
  assetPrompt: string;                 // full Law 0.4 prompt sent to the generator
}

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

  // ─── V9 additions ────────────────────────────────────────
  // Section marker — used by asset router, ScriptDirector pruning logic, and B-roll matching.
  // Values: "hook", "daytag", "bridge", "step1"…"step5", "sowhat", "signoff".
  section?: string;
  // V9 Section 12a — cold-open hook archetype (only set on layout === "cold_open_hook")
  hookArchetype?: HookArchetype;
  // V9 Law 0.5 — sub-shot list (2-3 entries) for non-closeup beats; hook uses this too
  subShots?: ShotSpec[];
  // Whether Quinn VO begins over this beat's visuals (hook-only — defaults true for cold_open_hook)
  voOverVisuals?: boolean;
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
  | "puppeteer_graphic"
  | "headless_capture";

export interface AssetRequest {
  beatId: number;
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
