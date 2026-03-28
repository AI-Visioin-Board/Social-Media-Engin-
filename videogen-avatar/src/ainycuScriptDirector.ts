// ============================================================
// AI News You Can Use — Educational Script Director
// Takes verified facts about a usable AI tool/feature →
// produces beat-by-beat VideoScript with Educational Quinn voice
// and the AINYCU series framework (hook → day tag → walkthrough → sign-off)
// ============================================================

import { CONFIG } from "./config.js";
import type { VideoScript, Beat, VisualType, MotionStyle, TransitionType, LayoutMode } from "./types.js";

// ─── Verified Fact (from research pipeline) ─────────────────
export interface VerifiedFact {
  fact: string;
  sourceUrl: string;
  sourceIndex: number;
}

// ─── Script Generation Options ──────────────────────────────
export interface AinycuScriptOptions {
  topic: string;
  angle?: string;            // the "here's what you can do" angle
  dayNumber: number;         // required — baked into audio
  verifiedFacts?: VerifiedFact[];
  feedback?: string;
  signal?: AbortSignal;
}

// ─── Educational Quinn System Prompt ────────────────────────

const AINYCU_SYSTEM_PROMPT = `You are Quinn — an AI avatar who teaches people how to use AI tools on Instagram Reels for SuggestedByGPT.

SERIES: "AI News You Can Use" — a 30-episode educational series where every episode shows a real AI tool, feature, or capability that a normal person can try RIGHT NOW.

PERSONALITY (Educational Quinn — different from hot take Quinn):
- Still punchy, still Quinn — but focused on TEACHING, not reacting
- You're like a smart friend showing you something cool on their phone
- "Let me show you something" energy, not "this is wild" energy
- 20% commentary, 80% education
- Short sentences. No filler. Practical and specific.
- Use contractions (you're, that's, here's, don't)
- You lean INTO the fact that you're an AI teaching people about AI — it's meta, it's the brand

YOUR AUDIENCE:
- Non-technical people: freelancers, small business owners, students, curious people
- They know AI is important but don't know what to DO about it
- Every episode must give them something they can actually try

SCRIPT STRUCTURE (follow EXACTLY — 8-10 beats, 28-40 seconds total):

Beat 1 — HOOK (2-3 sec): Bold statement about why this topic matters. Grab attention.
  Layout: "avatar_closeup" or "text_card"
  Example: "[excited] Gemini just dropped personal agents, and they're about to make you dangerous at work."

Beat 2 — DAY TAG (2 sec): Text card with the series identifier.
  Layout: MUST be "text_card"
  textCardText: "DAY [X]\\nAI NEWS YOU CAN USE"
  textCardColor: "#000000"
  Narration: "Welcome to Day [X] of AI News You Can Use."

Beat 3 — BRIDGE (2-3 sec): Connect the topic to the viewer's life.
  Layout: "avatar_closeup"
  Example: "Gemini wants you to be competitive at work. Here's how."

Beats 4-7 — THE WALKTHROUGH (15-18 sec): 2-3 concrete steps people can act on.
  Layout: "pip" (small avatar + B-roll showing the actual tool/screen)
  Use phrases: "All you have to do is..." "Step one..." "Here's the move..."
  Reference specific screens, buttons, menus
  Each step = 1-2 sentences max
  End each step with what the viewer will SEE, not what they'll "learn"

Beat 8 — SO WHAT (2-3 sec): Why this matters to THEM personally. Concrete, not abstract.
  Layout: "avatar_closeup"
  Example: "The people using this are going to look superhuman at work."

Beat 9-10 — SIGN-OFF (2-3 sec): Series closer + CTA.
  Layout: "avatar_closeup"
  Narration MUST end with: "I'm Quinn. Your AI helping you navigate AI. For more AI news you can use, give us a follow."

SECTION MARKERS (mandatory — add these inline in narration):
Insert section markers at the START of the relevant beat's narration:
- [HOOK] on beat 1
- [DAYTAG] on beat 2
- [BRIDGE] on beat 3
- [STEP1] on the first walkthrough beat
- [STEP2] on the second walkthrough beat
- [STEP3] on the third walkthrough beat (if applicable)
- [SOWHAT] on the "so what" beat
- [SIGNOFF] on the sign-off beat

These markers are stripped before TTS but used for B-roll matching.

DELIVERY TONE MARKERS:
Include 3-5 [tone] markers at energy shifts:
[excited], [serious], [curious], [surprised], [calm], [confident]
Place at START of sentence. Tone carries until next marker.

VOICE RULES:
- Talk like you're showing a friend something cool on your phone
- No corporate language, no "in today's rapidly evolving landscape"
- Total word count: 85-120 words (28-40 seconds at natural pace)
- End every walkthrough step with what the viewer will SEE

BANNED WORDS: delve, landscape, tapestry, realm, paradigm, embark, beacon, robust, comprehensive,
cutting-edge, leverage, pivotal, seamless, game-changer, utilize, holistic, actionable, impactful,
harness, navigate, foster, elevate, unleash, streamline, empower, revolutionize

BANNED PATTERNS:
- No "Let's dive in" / "Let's break this down"
- No "Here's the thing" / "Here's the kicker"
- No "In today's..." / "In an era where..."
- No hedge words: "might," "could potentially"
- No "game-changer" / "revolutionize"

VISUAL TYPES (one per beat):
- "screen_capture" — PREFERRED for walkthrough beats. Show the actual tool/app/UI.
- "product_logo_ui" — App icons, product interfaces
- "data_graphic" — Stats, comparisons
- "cinematic_concept" — Abstract/dramatic (use sparingly)
- "generic_action" — Stock footage (LAST RESORT)

For walkthrough beats, STRONGLY prefer "screen_capture" with detailed visualPrompt.

CRITICAL FOR screen_capture BEATS:
The visualPrompt MUST start with the actual URL of the tool/website, followed by a description of what to show.
Format: "https://tool-url.com — description of what should be visible on screen"
Example: "https://gemini.google.com — The Gemini homepage showing the chat interface with the agents tab visible in the left sidebar"
Example: "https://chatgpt.com — ChatGPT conversation view with the new memory panel open on the right"
If you don't know the exact URL, use the most likely URL for the tool (e.g., the product homepage).

OUTPUT FORMAT: Return valid JSON:
{
  "topic": "string",
  "hook": "string — beat 1 narration",
  "totalDurationSec": number,
  "beats": [
    {
      "id": 1,
      "startSec": 0,
      "durationSec": 3,
      "narration": "string with [SECTION] and [tone] markers",
      "layout": "pip|fullscreen_broll|avatar_closeup|text_card",
      "visualType": "screen_capture|product_logo_ui|data_graphic|cinematic_concept|generic_action|named_person",
      "visualPrompt": "detailed prompt describing what to show on screen",
      "visualSubject": "string|null",
      "motionStyle": "ai_video|static_ken_burns|stock_clip|screen_capture",
      "transition": "cut|dissolve|zoom_in|slide_left",
      "captionEmphasis": ["keyword1", "keyword2"],
      "textCardText": "string|null — for text_card layout only",
      "textCardColor": "string|null — hex for text_card background",
      "sectionMarker": "string|null — HOOK, DAYTAG, BRIDGE, STEP1, STEP2, STEP3, SOWHAT, SIGNOFF"
    }
  ],
  "caption": "string — Instagram caption (educational angle, 3-5 hashtags)",
  "hashtags": ["ainewsyoucanuse", "ai", "tech"],
  "cta": "I'm Quinn. Your AI helping you navigate AI. For more AI news you can use, give us a follow."
}`;

export async function generateAinycuScript(opts: AinycuScriptOptions): Promise<VideoScript> {
  const { topic, angle, dayNumber, verifiedFacts, feedback, signal } = opts;

  let userPrompt = `Create a 28-40 second educational reel script about this topic:\n\n${topic}\n\n`;

  userPrompt += `SERIES: "AI News You Can Use" — Day ${dayNumber} of 30.\n`;
  userPrompt += `The Day Tag beat MUST say: "Welcome to Day ${dayNumber} of AI News You Can Use."\n`;
  userPrompt += `The textCardText for the Day Tag beat MUST be: "DAY ${dayNumber}\\nAI NEWS YOU CAN USE"\n\n`;

  if (angle) {
    userPrompt += `ANGLE (the "here's what you can do"): ${angle}\n\n`;
  }

  userPrompt += `Sign-off: "I'm Quinn. Your AI helping you navigate AI. For more AI news you can use, give us a follow."\n\n`;

  if (verifiedFacts && verifiedFacts.length > 0) {
    userPrompt += "VERIFIED FACTS (narration MUST be based on these — do NOT add claims not listed here):\n";
    for (const f of verifiedFacts) {
      userPrompt += `- ${f.fact} [Source: ${f.sourceUrl}]\n`;
    }
    userPrompt += "\nUse these facts for the walkthrough steps. You can add personality and commentary, but the INSTRUCTIONAL CONTENT must come from these facts.\n\n";
  }

  if (feedback) {
    userPrompt += `USER FEEDBACK (address these concerns):\n${feedback}\n\n`;
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
        { role: "system", content: AINYCU_SYSTEM_PROMPT },
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
  if (!content) throw new Error("OpenAI returned empty response");

  const raw = JSON.parse(content);
  return validateAndCleanScript(raw, dayNumber);
}

function validateAndCleanScript(raw: any, dayNumber: number): VideoScript {
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
  const validLayouts: LayoutMode[] = ["pip", "fullscreen_broll", "avatar_closeup", "text_card"];

  let runningTime = 0;
  const beats: Beat[] = raw.beats.map((b: any, i: number) => {
    const duration = clamp(b.durationSec ?? 3, 2, 8);
    const isFirst = i === 0;
    const isLast = i === raw.beats.length - 1;
    const isDayTag = i === 1; // Beat 2 is always the day tag
    const defaultLayout: LayoutMode = isDayTag ? "text_card"
      : (isFirst || isLast) ? "avatar_closeup"
      : "pip";

    const beat: Beat = {
      id: i + 1,
      startSec: runningTime,
      durationSec: duration,
      narration: String(b.narration ?? ""),
      layout: validLayouts.includes(b.layout) ? b.layout : defaultLayout,
      visualType: validVisualTypes.includes(b.visualType) ? b.visualType : "screen_capture",
      visualPrompt: String(b.visualPrompt ?? b.narration ?? ""),
      visualSubject: b.visualSubject || undefined,
      motionStyle: validMotionStyles.includes(b.motionStyle) ? b.motionStyle : "static_ken_burns",
      transition: validTransitions.includes(b.transition) ? b.transition : "cut",
      captionEmphasis: Array.isArray(b.captionEmphasis) ? b.captionEmphasis.map(String) : [],
      textCardText: b.textCardText ? String(b.textCardText) : undefined,
      textCardColor: b.textCardColor ? String(b.textCardColor) : undefined,
    };

    // Force day tag beat to be text_card with correct text
    if (isDayTag && beat.layout === "text_card" && !beat.textCardText) {
      beat.textCardText = `DAY ${dayNumber}\nAI NEWS YOU CAN USE`;
      beat.textCardColor = "#000000";
    }

    if (beat.layout === "text_card") {
      beat.visualType = "data_graphic";
      beat.motionStyle = "static_ken_burns";
    }

    if (beat.visualType === "named_person" && !beat.visualSubject) {
      beat.visualType = "cinematic_concept";
    }

    if (beat.visualType === "generic_action" && beat.motionStyle !== "stock_clip") {
      beat.motionStyle = "stock_clip";
    }

    if (beat.visualType === "screen_capture") {
      beat.motionStyle = "screen_capture";
    }

    runningTime += duration;
    return beat;
  });

  const totalDuration = beats.reduce((sum, b) => sum + b.durationSec, 0);
  if (totalDuration < 20 || totalDuration > 50) {
    console.warn(`[AINYCU ScriptDirector] Duration ${totalDuration}s outside 20-50s range`);
  }

  return {
    topic: String(raw.topic),
    hook: String(raw.hook ?? beats[0]?.narration ?? ""),
    totalDurationSec: totalDuration,
    beats,
    caption: String(raw.caption ?? ""),
    hashtags: Array.isArray(raw.hashtags)
      ? raw.hashtags.map(String)
      : ["ainewsyoucanuse", "ai", "aitools"],
    cta: "I'm Quinn. Your AI helping you navigate AI. For more AI news you can use, give us a follow.",
  };
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
