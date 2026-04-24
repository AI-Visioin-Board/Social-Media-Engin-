// ============================================================
// videogen-avatar — Stage 1: Script Director
// Takes verified facts about a news topic → produces beat-by-beat
// VideoScript JSON using Quinn's persona and 4-beat structure
// Uses OpenAI (gpt-4.1) to write narration + visual directions
// ============================================================

import { CONFIG } from "./config.js";
import { QUINN_SYSTEM_PROMPT, type ContentBucket } from "./prompts/quinnPersona.js";
import type {
  VideoScript, Beat, Shot, VisualType, MotionStyle, TransitionType, LayoutMode,
} from "./types.js";

// ─── Verified Fact (from research pipeline) ─────────────────
export interface VerifiedFact {
  fact: string;
  sourceUrl: string;
  sourceIndex: number;
}

// ─── Script Generation Options ──────────────────────────────
export interface ScriptOptions {
  topic: string;
  targetDurationSec?: number;
  dayNumber?: number;          // for 30-day series context
  contentBucket?: ContentBucket;
  verifiedFacts?: VerifiedFact[];
  feedback?: string;           // revision feedback from user
  signal?: AbortSignal;
}

// Hard word-count ceiling. Above this we retry with a trimming nudge.
const MAX_NARRATION_WORDS = 160;   // generic reels allow a tiny bit more slack
const SOFT_NARRATION_WORDS = 145;

// Layouts that REQUIRE shots[] (b-roll-driven, holding a single image looks amateur)
const SHOT_REQUIRED_LAYOUTS: LayoutMode[] = ["pip", "fullscreen_broll", "device_mockup"];

// Remotion-rendered visual types — no external asset fetch needed
const REMOTION_ONLY_VISUAL_TYPES: VisualType[] = ["stat_card"];

const VALID_VISUAL_TYPES: VisualType[] = [
  "named_person", "product_logo_ui", "cinematic_concept",
  "generic_action", "data_graphic", "screen_capture",
  "reaction_clip", "brand_logo_card", "stat_card",
];
const VALID_MOTION_STYLES: MotionStyle[] = [
  "static_ken_burns", "ai_video", "stock_clip", "screen_capture",
];
const VALID_LAYOUTS: LayoutMode[] = [
  "pip", "fullscreen_broll", "avatar_closeup", "text_card",
  "device_mockup", "icon_grid", "motion_graphic",
];
const VALID_TRANSITIONS: TransitionType[] = ["cut", "dissolve", "zoom_in", "slide_left"];
const VALID_WORD_STYLES = ["hero", "action", "danger", "pill"] as const;

// Layouts that are rendered entirely by Remotion — no external b-roll needed
const REMOTION_ONLY_LAYOUTS: LayoutMode[] = ["icon_grid", "motion_graphic"];

export async function generateScript(opts: ScriptOptions): Promise<VideoScript> {
  const {
    topic,
    targetDurationSec = CONFIG.defaultTargetDuration,
    contentBucket,
    verifiedFacts,
    feedback,
    signal,
  } = opts;

  const basePrompt = buildUserPrompt({ topic, targetDurationSec, contentBucket, verifiedFacts, feedback });

  // First attempt
  let raw = await callOpenAI(basePrompt, signal);
  let wordCount = countNarrationWords(raw);
  console.log(`[ScriptDirector] Draft 1: ${wordCount} words`);

  if (wordCount > MAX_NARRATION_WORDS) {
    console.warn(`[ScriptDirector] ${wordCount} words > ${MAX_NARRATION_WORDS} cap — retrying with trim nudge`);
    const trimPrompt = basePrompt +
      `\n\nYOUR PREVIOUS DRAFT WAS ${wordCount} WORDS — OVER THE ${MAX_NARRATION_WORDS}-WORD HARD CAP.\n` +
      `Rewrite with the SAME structure and facts, but cut to ≤ ${SOFT_NARRATION_WORDS} words total.\n` +
      `- Cut "You see..." phrases entirely\n` +
      `- Replace UI click paths with a single feature name (the visuals show the path)\n` +
      `- Do not double-describe outputs\n` +
      `- Contract articles and drop filler\n` +
      `Return JSON only.`;
    raw = await callOpenAI(trimPrompt, signal);
    wordCount = countNarrationWords(raw);
    console.log(`[ScriptDirector] Draft 2 (trimmed): ${wordCount} words`);
  }

  return validateAndCleanScript(raw, targetDurationSec);
}

function buildUserPrompt(p: {
  topic: string;
  targetDurationSec: number;
  contentBucket?: ContentBucket;
  verifiedFacts?: VerifiedFact[];
  feedback?: string;
}): string {
  const { topic, targetDurationSec, contentBucket, verifiedFacts, feedback } = p;

  let userPrompt = `Create a ${targetDurationSec}-second video script about this topic:\n\n${topic}\n\n`;

  userPrompt += `HARD LENGTH CONSTRAINT: Total narration across all beats must be ≤ ${SOFT_NARRATION_WORDS} words (${MAX_NARRATION_WORDS} absolute max). The avatar speaks at ~150-160 words per minute.\n\n`;

  // CTA — use rotating CTAs from the intro/outro framework (never "Stay suggested")
  userPrompt += `End with a CTA from the rotation list in your system prompt. Do NOT say "Stay suggested."\n\n`;

  // Inject content bucket guidance
  if (contentBucket) {
    const bucketGuidance: Record<ContentBucket, string> = {
      tool_drop: "This is a TOOL DROP — focus on what the tool does, who it helps, and how to use it. Be practical and specific.",
      big_move: "This is a BIG MOVE — focus on what the company did, why it matters, and how it shifts the landscape for regular people.",
      proof_drop: "This is a PROOF DROP — focus on the real-world example, the specific results, and what others can learn from it.",
      reality_check: "This is a REALITY CHECK — debunk the hype OR confirm the fear. Be balanced but opinionated. Quinn has takes.",
      future_drop: "This is a FUTURE DROP — make the future feel tangible and relevant. 'Here's what this means for your commute/job/wallet next year.'",
      ai_fail: "This is an AI FAIL — lean into Quinn's sarcasm. Roast the bad decision but also explain why it matters. Funny + informative.",
    };
    userPrompt += `CONTENT BUCKET: ${bucketGuidance[contentBucket]}\n\n`;
  }

  // Inject verified facts (the core anti-hallucination mechanism)
  if (verifiedFacts && verifiedFacts.length > 0) {
    userPrompt += "VERIFIED FACTS (your narration MUST be based on these — do NOT add claims not listed here):\n";
    for (const f of verifiedFacts) {
      userPrompt += `- ${f.fact} [Source: ${f.sourceUrl}]\n`;
    }
    userPrompt += "\nUse these facts to build your narration. You can rephrase, add personality, analogies, and 'here's what this means for you' commentary — but the NEWS CONTENT must come from these facts.\n\n";
  }

  // Inject revision feedback if this is a re-do
  if (feedback) {
    userPrompt += `USER FEEDBACK (from previous version — address these concerns):\n${feedback}\n\n`;
  }

  userPrompt += "REMEMBER:\n";
  userPrompt += "- Every pip / fullscreen_broll / device_mockup beat ≥ 3s should include a shots[] array with 2-4 shots.\n";
  userPrompt += "- Each shot's durationSec is 0.8-2.0s. Sum of shots equals beat.durationSec.\n";
  userPrompt += "- shots[].emphasisWord is a 1-3 word burn-in chyron.\n";
  userPrompt += "- JSON only, no markdown fences, no explanation.";

  return userPrompt;
}

async function callOpenAI(userPrompt: string, signal?: AbortSignal): Promise<any> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CONFIG.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: CONFIG.openaiModel,
      messages: [
        { role: "system", content: QUINN_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.8,
      max_completion_tokens: 4000,
      response_format: { type: "json_object" },
    }),
    signal,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned empty response");
  }

  return JSON.parse(content);
}

// Count spoken words in narration, stripping [SECTION] markers.
function countNarrationWords(raw: any): number {
  if (!raw?.beats || !Array.isArray(raw.beats)) return 0;
  return raw.beats.reduce((sum: number, b: any) => {
    const n = String(b?.narration ?? "");
    const stripped = n.replace(/\[[A-Z0-9]+\]/g, "").trim();
    if (!stripped) return sum;
    return sum + stripped.split(/\s+/).filter(Boolean).length;
  }, 0);
}

function validateAndCleanScript(raw: any, targetDurationSec: number): VideoScript {
  if (!raw.topic || !raw.beats || !Array.isArray(raw.beats) || raw.beats.length === 0) {
    throw new Error("Invalid script: missing topic or beats array");
  }

  let runningTime = 0;
  const beats: Beat[] = raw.beats.map((b: any, i: number) => {
    // 8-12 beats at 3-8 seconds each (total ~45-60s)
    const duration = clamp(b.durationSec ?? 5, 2, 10);
    // Default layout: first beat = avatar_closeup, last beat = avatar_closeup, middle = pip
    const isFirst = i === 0;
    const isLast = i === raw.beats.length - 1;
    const defaultLayout: LayoutMode = (isFirst || isLast) ? "avatar_closeup" : "pip";
    const beat: Beat = {
      id: i + 1,
      startSec: runningTime,
      durationSec: duration,
      narration: String(b.narration ?? ""),
      layout: VALID_LAYOUTS.includes(b.layout) ? b.layout : defaultLayout,
      visualType: VALID_VISUAL_TYPES.includes(b.visualType) ? b.visualType : "cinematic_concept",
      visualPrompt: String(b.visualPrompt ?? b.narration ?? ""),
      visualSubject: b.visualSubject || undefined,
      motionStyle: VALID_MOTION_STYLES.includes(b.motionStyle) ? b.motionStyle : "static_ken_burns",
      transition: VALID_TRANSITIONS.includes(b.transition) ? b.transition : "cut",
      captionEmphasis: Array.isArray(b.captionEmphasis) ? b.captionEmphasis.map(String) : [],
      textCardText: b.textCardText ? String(b.textCardText) : undefined,
      textCardColor: b.textCardColor ? String(b.textCardColor) : undefined,
    };

    // ── Word Styles (multi-style captions) ──
    if (b.wordStyles && typeof b.wordStyles === "object") {
      const cleaned: Record<string, "hero" | "action" | "danger" | "pill"> = {};
      for (const [word, style] of Object.entries(b.wordStyles)) {
        if (VALID_WORD_STYLES.includes(style as any)) {
          cleaned[word] = style as "hero" | "action" | "danger" | "pill";
        }
      }
      if (Object.keys(cleaned).length > 0) {
        beat.wordStyles = cleaned;
      }
    }

    // ── Zoom Punch ──
    if (b.zoomPunch === true) {
      beat.zoomPunch = true;
    }

    // ── Icon Grid Items ──
    if (beat.layout === "icon_grid" && Array.isArray(b.iconGridItems)) {
      const items = b.iconGridItems
        .filter((item: any) => item?.emoji && item?.label)
        .slice(0, 4)
        .map((item: any) => ({ emoji: String(item.emoji), label: String(item.label) }));
      if (items.length >= 2) {
        beat.iconGridItems = items;
      }
    }

    // ── Device Type ──
    if (beat.layout === "device_mockup") {
      beat.deviceType = (b.deviceType === "iphone") ? "iphone" : "macbook";
    }

    // ── Remotion-Only Flag ──
    if (REMOTION_ONLY_LAYOUTS.includes(beat.layout)) {
      beat.remotionOnly = true;
    }

    // Fix: text_card beats don't need visual generation
    if (beat.layout === "text_card") {
      beat.visualType = "data_graphic";
      beat.motionStyle = "static_ken_burns";
    }

    // Fix: named_person without a subject → reclassify
    if (beat.visualType === "named_person" && !beat.visualSubject) {
      beat.visualType = "cinematic_concept";
    }

    // Fix: reaction_clip without subject → downgrade
    if (beat.visualType === "reaction_clip" && !beat.visualSubject) {
      beat.visualType = "cinematic_concept";
    }

    // Fix: generic_action should use stock_clip motion
    if (beat.visualType === "generic_action" && beat.motionStyle !== "stock_clip") {
      beat.motionStyle = "stock_clip";
    }

    // Fix: screen_capture should use screen_capture motion
    if (beat.visualType === "screen_capture") {
      beat.motionStyle = "screen_capture";
    }

    // Fix: stat_card is Remotion-rendered, no asset fetch
    if (beat.visualType === "stat_card") {
      beat.motionStyle = "static_ken_burns";
      beat.remotionOnly = true;
    }

    // Fix: brand_logo_card uses Nano Banana (AI image gen)
    if (beat.visualType === "brand_logo_card") {
      beat.motionStyle = "static_ken_burns";
    }

    // Extract section marker from narration leading tag (e.g. "[HOOK] Manus is...")
    const sectionMatch = beat.narration.match(/^\[([A-Z0-9]+)\]/);
    if (sectionMatch) {
      beat.section = sectionMatch[1].toLowerCase();
    }

    // ── Validate / Repair Shots ──
    if (SHOT_REQUIRED_LAYOUTS.includes(beat.layout) && beat.durationSec >= 3) {
      beat.shots = validateAndRepairShots(beat, b.shots);
    } else if (Array.isArray(b.shots) && b.shots.length > 0) {
      beat.shots = validateAndRepairShots(beat, b.shots);
    }

    runningTime += duration;
    return beat;
  });

  // Hard cap: trim beats from the end if total exceeds target duration
  let totalDuration = beats.reduce((sum, b) => sum + b.durationSec, 0);
  if (totalDuration > targetDurationSec) {
    console.warn(`[ScriptDirector] Script ${totalDuration}s exceeds target ${targetDurationSec}s — trimming beats`);
    while (totalDuration > targetDurationSec && beats.length > 3) {
      // Remove second-to-last beat (keep last beat = CTA/signoff)
      const removeIdx = beats.length - 2;
      const removed = beats.splice(removeIdx, 1)[0];
      totalDuration -= removed.durationSec;
      console.warn(`[ScriptDirector] Removed beat ${removed.id} (${removed.durationSec}s) — now ${totalDuration}s`);
    }
    // Recalculate startSec for remaining beats
    let time = 0;
    for (const b of beats) {
      b.startSec = time;
      time += b.durationSec;
    }
    // Re-number beat IDs
    beats.forEach((b, i) => { b.id = i + 1; });
    totalDuration = beats.reduce((sum, b) => sum + b.durationSec, 0);
  }

  if (totalDuration < 20) {
    console.warn(`[ScriptDirector] Script duration ${totalDuration}s is unusually short`);
  }

  return {
    topic: String(raw.topic),
    hook: String(raw.hook ?? beats[0]?.narration ?? ""),
    totalDurationSec: totalDuration,
    beats,
    caption: String(raw.caption ?? ""),
    hashtags: Array.isArray(raw.hashtags) ? raw.hashtags.map(String) : [],
    cta: String(raw.cta ?? "Follow to catch the next one."),
  };
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ─── Shot validator / auto-splitter ─────────────────────────
// Ensures every shot-required beat has a well-formed shots[] whose durations
// sum to beat.durationSec. If the LLM omitted shots[], auto-split the beat
// into N equal shots derived from the narration.
function validateAndRepairShots(beat: Beat, rawShots: any): Shot[] {
  const duration = beat.durationSec;

  const targetCount = duration <= 4 ? 3
    : duration <= 6 ? 4
    : duration <= 8 ? 5
    : 5;

  let shots: Shot[] = [];

  if (Array.isArray(rawShots) && rawShots.length > 0) {
    shots = rawShots
      .filter((s: any) => s && typeof s === "object")
      .map((s: any, i: number): Shot => ({
        idx: typeof s.idx === "number" ? s.idx : i + 1,
        startSec: Number.isFinite(s.startSec) ? Number(s.startSec) : i * (duration / rawShots.length),
        durationSec: Number.isFinite(s.durationSec) ? Number(s.durationSec) : duration / rawShots.length,
        visualType: VALID_VISUAL_TYPES.includes(s.visualType) ? s.visualType : beat.visualType,
        visualPrompt: String(s.visualPrompt ?? s.prompt ?? beat.visualPrompt),
        visualSubject: s.visualSubject ? String(s.visualSubject) : beat.visualSubject,
        motionStyle: VALID_MOTION_STYLES.includes(s.motionStyle) ? s.motionStyle : beat.motionStyle,
        emphasisWord: s.emphasisWord ? String(s.emphasisWord).trim().slice(0, 30) : undefined,
      }));
  }

  if (shots.length < 2) {
    shots = autoSplitBeat(beat, targetCount);
  }

  shots = normalizeShotTimings(shots, duration);

  let cursor = 0;
  shots.forEach((s, i) => {
    s.idx = i + 1;
    s.startSec = cursor;
    cursor += s.durationSec;
  });

  return shots;
}

function autoSplitBeat(beat: Beat, targetCount: number): Shot[] {
  const shotDuration = beat.durationSec / targetCount;
  const tokens = beat.narration
    .replace(/\[[A-Z0-9]+\]/g, "")
    .split(/\s+/)
    .filter(w => w.length > 3);

  return Array.from({ length: targetCount }, (_, i) => {
    const emphasis = tokens[i] ? tokens[i].replace(/[^\w@]/g, "") : undefined;
    return {
      idx: i + 1,
      startSec: i * shotDuration,
      durationSec: shotDuration,
      visualType: beat.visualType,
      visualPrompt: `${beat.visualPrompt} — shot ${i + 1}/${targetCount}, emphasis: ${emphasis ?? "hero shot"}`,
      visualSubject: beat.visualSubject,
      motionStyle: beat.motionStyle,
      emphasisWord: emphasis && emphasis.length > 2 ? emphasis : undefined,
    };
  });
}

function normalizeShotTimings(shots: Shot[], totalDuration: number): Shot[] {
  if (shots.length === 0) return shots;

  const MIN = 0.6;
  const MAX = 2.5;

  const clamped = shots.map(s => ({
    ...s,
    durationSec: clamp(s.durationSec, MIN, MAX),
  }));

  const currentSum = clamped.reduce((sum, s) => sum + s.durationSec, 0);
  if (currentSum <= 0) return clamped;

  const scale = totalDuration / currentSum;
  return clamped.map(s => ({
    ...s,
    durationSec: Math.max(MIN, s.durationSec * scale),
  }));
}

export const __testing = {
  countNarrationWords,
  validateAndRepairShots,
  autoSplitBeat,
  normalizeShotTimings,
};
