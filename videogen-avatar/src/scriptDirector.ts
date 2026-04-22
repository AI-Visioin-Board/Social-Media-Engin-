// ============================================================
// videogen-avatar — Stage 1: Script Director
// Takes verified facts about a news topic → produces beat-by-beat
// VideoScript JSON using Quinn's persona and 4-beat structure
// Uses OpenAI (gpt-4.1) to write narration + visual directions
// ============================================================

import { CONFIG } from "./config.js";
import { QUINN_SYSTEM_PROMPT, type ContentBucket } from "./prompts/quinnPersona.js";
import type { VideoScript, Beat, VisualType, MotionStyle, TransitionType, LayoutMode } from "./types.js";

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

export async function generateScript(opts: ScriptOptions): Promise<VideoScript> {
  const {
    topic,
    targetDurationSec = CONFIG.defaultTargetDuration,
    dayNumber,
    contentBucket,
    verifiedFacts,
    feedback,
    signal,
  } = opts;

  // Build the user prompt with verified facts and context
  let userPrompt = `Create a ${targetDurationSec}-second video script about this topic:\n\n${topic}\n\n`;

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

  userPrompt += "Remember: JSON only, no markdown fences, no explanation.";

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

  const raw = JSON.parse(content);
  return validateAndCleanScript(raw, targetDurationSec);
}

function validateAndCleanScript(raw: any, targetDurationSec: number): VideoScript {
  if (!raw.topic || !raw.beats || !Array.isArray(raw.beats) || raw.beats.length === 0) {
    throw new Error("Invalid script: missing topic or beats array");
  }

  const validVisualTypes: VisualType[] = [
    "named_person", "product_logo_ui", "cinematic_concept",
    "generic_action", "data_graphic", "screen_capture",
  ];
  const validMotionStyles: MotionStyle[] = [
    "static_ken_burns", "ai_video", "stock_clip", "screen_capture",
  ];
  const validTransitions: TransitionType[] = ["cut", "dissolve", "zoom_in", "slide_left"];
  const validLayouts: LayoutMode[] = [
    "pip", "fullscreen_broll", "avatar_closeup", "text_card",
    "device_mockup", "icon_grid", "motion_graphic", "cold_open_hook",
  ];

  let runningTime = 0;
  const beats: Beat[] = raw.beats.map((b: any, i: number) => {
    // V9: 9-11 beats, 30-45s spoken, ~55-63s reel final
    const duration = clamp(b.durationSec ?? 5, 2, 10);
    // V9 default layout: first beat = cold_open_hook (pattern interrupt), last beat = avatar_closeup, middle = pip
    const isFirst = i === 0;
    const isLast = i === raw.beats.length - 1;
    const defaultLayout: LayoutMode = isFirst ? "cold_open_hook"
      : isLast ? "avatar_closeup"
      : "pip";
    const beat: Beat = {
      id: i + 1,
      startSec: runningTime,
      durationSec: duration,
      narration: String(b.narration ?? ""),
      layout: validLayouts.includes(b.layout) ? b.layout : defaultLayout,
      visualType: validVisualTypes.includes(b.visualType) ? b.visualType : "cinematic_concept",
      visualPrompt: String(b.visualPrompt ?? b.narration ?? ""),
      visualSubject: b.visualSubject || undefined,
      motionStyle: validMotionStyles.includes(b.motionStyle) ? b.motionStyle : "static_ken_burns",
      transition: validTransitions.includes(b.transition) ? b.transition : "cut",
      captionEmphasis: Array.isArray(b.captionEmphasis) ? b.captionEmphasis.map(String) : [],
      textCardText: b.textCardText ? String(b.textCardText) : undefined,
      textCardColor: b.textCardColor ? String(b.textCardColor) : undefined,
    };

    // Fix: text_card beats don't need visual generation
    if (beat.layout === "text_card") {
      beat.visualType = "data_graphic";
      beat.motionStyle = "static_ken_burns";
    }

    // Fix: named_person without a subject → reclassify
    if (beat.visualType === "named_person" && !beat.visualSubject) {
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

    runningTime += duration;
    return beat;
  });

  // V9 Law 0.1 — SCRIPT-STAGE duration cap on SPOKEN prose (not beat.durationSec).
  // Quinn TTS runs ~2.3 words/sec; target 30–45s spoken = 70–105 words.
  // Prune walkthrough beats first, keep hook/signoff intact. Never runtime-truncate.
  const MAX_SPOKEN_SEC = Math.min(targetDurationSec, 45);
  const estimateSpoken = (bs: Beat[]): number => {
    const words = bs
      .map(b => (b.narration ?? "").replace(/\[[A-Z0-9]+\]/g, "").split(/\s+/).filter(Boolean).length)
      .reduce((a, b) => a + b, 0);
    return words / 2.3;
  };
  // Section markers protected from pruning — these carry the narrative arc.
  // Everything else (walkthrough, bridge, step1-5) can be trimmed.
  const PROTECTED_SECTIONS = new Set(["hook", "daytag", "sowhat", "signoff"]);
  const isProtected = (b: Beat, idx: number, total: number): boolean => {
    if (b.section && PROTECTED_SECTIONS.has(b.section)) return true;
    // Positional fallback when no section marker was set: beat 0 = hook, last = signoff.
    if (idx === 0 || idx === total - 1) return true;
    return false;
  };

  let spokenDuration = estimateSpoken(beats);
  if (spokenDuration > MAX_SPOKEN_SEC) {
    console.warn(`[ScriptDirector] Spoken ~${spokenDuration.toFixed(1)}s exceeds target ${MAX_SPOKEN_SEC}s — V9 pruning`);
    let safety = 20; // hard stop to prevent infinite loop on degenerate input
    while (spokenDuration > MAX_SPOKEN_SEC && beats.length > 3 && safety-- > 0) {
      // Find a prunable beat: last non-protected beat (walk from back, skip protected).
      let removeIdx = -1;
      for (let i = beats.length - 2; i >= 1; i--) {
        if (!isProtected(beats[i], i, beats.length)) { removeIdx = i; break; }
      }
      if (removeIdx === -1) {
        console.warn(`[ScriptDirector] No prunable non-protected beats remain — stopping pruning at ${spokenDuration.toFixed(1)}s`);
        break;
      }
      const removed = beats.splice(removeIdx, 1)[0];
      spokenDuration = estimateSpoken(beats);
      console.warn(`[ScriptDirector] Pruned beat ${removed.id} [${removed.section ?? "unmarked"}] (${removed.narration?.slice(0, 40)}...) — est spoken now ${spokenDuration.toFixed(1)}s`);
    }
    // Recalculate startSec and re-number IDs
    let time = 0;
    for (const b of beats) { b.startSec = time; time += b.durationSec; }
    beats.forEach((b, i) => { b.id = i + 1; });
  }
  const totalDuration = beats.reduce((sum, b) => sum + b.durationSec, 0);

  if (spokenDuration < 20) {
    console.warn(`[ScriptDirector] Spoken duration ~${spokenDuration.toFixed(1)}s is unusually short`);
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
