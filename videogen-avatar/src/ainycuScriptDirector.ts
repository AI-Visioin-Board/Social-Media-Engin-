// ============================================================
// AI News You Can Use — Educational Script Director
// Takes verified facts about a usable AI tool/feature →
// produces beat-by-beat VideoScript with Educational Quinn voice
// and the AINYCU series framework (hook → day tag → walkthrough → sign-off)
// ============================================================

import { CONFIG } from "./config.js";
import type { VideoScript, Beat, VisualType, MotionStyle, TransitionType, LayoutMode, ShotSpec, HookArchetype } from "./types.js";

// V9 Law 0.6 — hard cap per shot duration (seconds).
const MAX_SHOT_SEC = 2.0;
// V9 Law 0.1 — script-stage spoken target (not runtime). Target is PROSE LENGTH;
// avatar TTS runs ~1.4× that. 45s prose → ~60-63s reel after audio + hook + CRT TV.
const MAX_SPOKEN_SEC = 45;
const MIN_SPOKEN_SEC = 30;

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

V9 CORE LAWS (protocol-level, non-negotiable — see REEL_PRODUCTION_PROTOCOL.md Section 0):
- Law 0.1 Duration: 30–45 seconds of SPOKEN prose. Never runtime-truncate. Quinn finishes her sentence.
- Law 0.2 Density: every non-closeup beat fans into 2–3 sub-shots with varied transitions/entrances.
- Law 0.3 Progressive Construction: every on-screen element enters with motion. Static appears are banned.
- Law 0.4 Prompt Quality: cinematographer-grade visualPrompts (shot type, angle, lens, lighting, negatives).
- Law 0.5 Sub-Shot Structure: each non-closeup beat emits a subShots array of 2–3 ShotSpec entries.
- Law 0.6 Pace: no single sub-shot > 2.0s. Nothing on screen more than ~2s. Cut early.

SCRIPT STRUCTURE (follow EXACTLY — 9-11 beats, 30-45 seconds total — SHORTER IS BETTER, the avatar speaks slower than you think):

Beat 1 — COLD-OPEN HOOK (3-6 sec, VISUAL PATTERN INTERRUPT — NOT Quinn's face):
  Layout: MUST be "cold_open_hook" — replaces the old avatar_closeup opener. Quinn does NOT appear here.
  The first frame on screen is an object / cartoon / UI gesture / kinetic typography that visually
  renders the subject of the reel before any words are spoken. Quinn's VO may start at ~1.5s over
  the visuals (set voOverVisuals: true — this is the default).

  Pick ONE hookArchetype that matches the subject:
    - "A1_object_collision" — efficiency/time ("cut work time in half" → clock + scissors)
    - "A2_villain_vs_hero" — competition ("X killed Y", "X destroys Z")
    - "A3_before_after_jumpcut" — transformation/automation
    - "A4_cartoon_reaction" — surprising/shocking ("you won't believe…")
    - "A5_ui_gesture_macro" — specific feature reveal (autonomous cursor, click cascade)
    - "A6_icon_storm" — tool-overload / consolidation / "war" framing
    - "A7_text_as_visual" — stat/quote/announcement (kinetic typography)
    - "A8_pov_first_person" — workflow / new user experience

  Emit a subShots array with 2–3 ShotSpec entries, each durationSec between 0.8 and 2.0 (HARD CAP).
  Total hook duration is the sum of subShots[].durationSec — should land 3.0–6.0s.

  Narration (if voOverVisuals true): punchy conflict-framed single sentence. Example (subject = Canva
  editable layers): "Canva just wiped out a million design jobs — and made it this simple."
  Ban boring educational openings ("Today we're going to talk about…", "Hey Quinn here…").
  Ban "AI News You Can Use" as the opening words — brand moment is Beat 2, NOT Beat 1.

Beat 2 — AINYCU BRAND MOMENT (DAY TAG, 2.5-3 sec): CRT TV drop + title reveal.
  Layout: MUST be "text_card" (Remotion renders the CRT TV composition for this text_card content)
  textCardText: "DAY [X]\\nAI NEWS YOU CAN USE"
  textCardColor: "#000000"
  Narration: "Welcome to Day [X] of AI News You Can Use." (Quinn still off-screen — TV is hero)

Beat 3 — BRIDGE (2-3 sec): Connect the topic to the viewer's life.
  Layout: "avatar_closeup" or "icon_grid" (if listing what this helps with)
  Example: "If you have an old flyer, menu, or poster, this saves you from rebuilding the whole thing."

Beats 4-7 — THE WALKTHROUGH (15-25 sec): 2-3 concrete steps, 1-2 beats per step. Keep it tight — only the most impressive features.
  Step intro beat (2 sec): avatar_closeup or text_card — set up what they'll do
  Step demo beat (3-4 sec): pip, device_mockup, or icon_grid — show it
  Use phrases: "All you have to do is..." "Step one..." "Now do this..."
  Each step = 1-2 sentences max
  End each step with what the viewer will SEE, not what they'll "learn"
  MIX layouts across steps — never do 3 pips in a row.

  CRITICAL — LEAD WITH FEATURES, NOT PROMPTING TIPS:
  The walkthrough must showcase the tool's most impressive CAPABILITIES and FEATURES.
  - What can it DO that surprises people? (integrations, automations, scheduled tasks, connections)
  - What real tasks does it handle? (send emails, control apps, generate content, manage files)
  - What makes it MORE than just a chatbot?
  Do NOT waste walkthrough beats on "how to write a good prompt" or "give it a role."
  The audience wants to know WHAT THE TOOL CAN DO, not how to talk to it.
  Show the features that make someone say "wait, it can do THAT?"

  ANTI-REPETITION RULE (MANDATORY):
  Each walkthrough step MUST cover a COMPLETELY DIFFERENT named feature or capability.
  - Use the tool's OFFICIAL feature name as a proper noun (e.g., "Tasks", "Scheduled Tasks", "Dispatch", "Computer Use", "MCP Connectors")
  - If Step 1 mentions file management, Steps 2-5 CANNOT mention file management again — even rephrased
  - Before writing the walkthrough, mentally list 3-5 DISTINCT features, then assign ONE per step
  - NEVER describe the same capability twice using different words
  - Test: if you removed the feature name from two steps and they sound the same, one must be replaced

  FEATURE DEPTH RULE:
  Each step should name the specific feature AND show one concrete thing it does.
  BAD: "It can also help with your work tasks" (vague, no feature name)
  GOOD: "Step three — Scheduled Tasks. Set Claude to check your inbox every morning and flag anything urgent." (named feature + concrete action)

Beat 8 — SO WHAT (2-3 sec): Why this matters to THEM personally. Concrete, not abstract.
  Layout: "avatar_closeup" or "motion_graphic" (if comparing before/after)
  Example: "This is the fastest way to update old graphics without starting from zero."

Beats 9-10 — SIGN-OFF (3-4 sec): Series closer + CTA.
  Layout: "avatar_closeup"
  End with ONE of these CTA patterns (rotate across episodes — Option A is the default):
  A) "I'm Quinn, your AI helping you navigate AI. I drop a new tool you can use every Tuesday and Thursday. Follow to catch the next one."
  B) "That's Day [X]. [30 minus X] more to go. Follow @suggestedbygpt — I'll see you [next Tue/Thu]."
  C) "That's how [tool] can [benefit]. Follow for more AI you can actually use."
  Do NOT say "Stay suggested." Do NOT use generic "like and subscribe."

SECTION MARKERS (mandatory — add these inline in narration):
Insert section markers at the START of the relevant beat's narration:
- [HOOK] on beat 1
- [DAYTAG] on beat 2
- [BRIDGE] on beat 3
- [STEP1] on the first walkthrough beat
- [STEP2] on the second walkthrough beat
- [STEP3] on the third walkthrough beat (if applicable)
- [STEP4] on the fourth walkthrough beat (if applicable)
- [STEP5] on the fifth walkthrough beat (if applicable)
- [SOWHAT] on the "so what" beat
- [SIGNOFF] on the sign-off beat

These markers are stripped before TTS but used for B-roll matching.

VOICE RULES:
- Talk like you're showing a friend something cool on your phone
- No corporate language, no "in today's rapidly evolving landscape"
- Total word count: 70–105 words (30–45 seconds of spoken prose at ~2.3 words/sec — final reel ~55–63s after hook + CRT + outro)
- End every walkthrough step with what the viewer will SEE
- Visual change MINIMUM every 2 seconds — V9 Law 0.6. Hard cap per sub-shot 2.0s.

BANNED WORDS: delve, landscape, tapestry, realm, paradigm, embark, beacon, robust, comprehensive,
cutting-edge, leverage, pivotal, seamless, game-changer, utilize, holistic, actionable, impactful,
harness, navigate, foster, elevate, unleash, streamline, empower, revolutionize

BANNED PATTERNS:
- No "Let's dive in" / "Let's break this down"
- No "Here's the thing" / "Here's the kicker"
- No "In today's..." / "In an era where..."
- No hedge words: "might," "could potentially"
- No "game-changer" / "revolutionize"

LAYOUT OPTIONS (one per beat):
- "cold_open_hook" — V9 Beat 1 ONLY. Visual pattern interrupt, no Quinn on screen. Uses hookArchetype + subShots.
- "pip" — Avatar bottom + B-roll top in TV frame. USE when showing an actual tool screen or video clip.
- "fullscreen_broll" — Full-screen B-roll with caption overlay. USE for dramatic/cinematic moments.
- "avatar_closeup" — Full-screen Quinn. USE for bridge, so-what, sign-off (personal connection). NEVER beat 1.
- "text_card" — Bold text on colored background. USE for day tags (beat 2), stats, bold claims, pull quotes.
- "device_mockup" — B-roll inside a CSS MacBook or iPhone frame. USE when showing a website or app screenshot.
- "icon_grid" — Animated emoji grid (2-4 items). USE for lists of features, categories, or options.
- "motion_graphic" — Animated workflow/process diagram. USE for step-by-step concepts or before/after comparisons.

LAYOUT RULES (V9):
- Beat 1 is ALWAYS "cold_open_hook" — the pattern interrupt. Never avatar_closeup for beat 1. Never text_card.
- Beat 2 is ALWAYS "text_card" (CRT TV day tag — brand moment AFTER the hook).
- Beat 3 onward: avatar_closeup for bridge, then mix pip / device_mockup / icon_grid / motion_graphic for walkthrough.
- NEVER use the same layout 2 beats in a row (except cold_open_hook → text_card, which is the required V9 opener sequence).
- Close with avatar_closeup (last beat — signoff).
- Include at least 1 icon_grid OR 1 motion_graphic per script (visual variety).
- Walkthrough beats: mix pip + device_mockup + icon_grid — don't do 3 pips in a row.
- Non-closeup beats MUST have a subShots array (2–3 ShotSpec entries, each 0.8–2.0s).

VISUAL TYPES (one per beat):
- "screen_capture" — Real screenshot of a website/app. ONLY use for PUBLIC pages (see rules below).
- "product_logo_ui" — AI-generated image of app icons, product UI, clean interfaces.
- "data_graphic" — Stats, comparisons, infographic-style.
- "cinematic_concept" — Abstract/dramatic (use sparingly).
- "generic_action" — Stock footage (LAST RESORT).

SCREEN CAPTURE INTELLIGENCE:
When choosing "screen_capture", the pipeline takes a real screenshot via headless browser.
Sites behind login walls return garbage. Be smart about which URLs will actually work.

WILL FAIL — do NOT use screen_capture for these (use device_mockup + product_logo_ui instead):
- Google products requiring sign-in (Docs, Sheets, Drive, Gmail, Google Vids editor)
- ChatGPT / OpenAI (login wall)
- Any SaaS dashboard behind auth (Notion workspace, Figma files, Canva editor view)
- Social media feeds (Instagram, Twitter/X, TikTok)
- Any URL with /login, /signin, /auth, /dashboard in the path

WILL SUCCEED — screen_capture is fine for:
- Product homepages / landing pages (canva.com, gemini.google.com, openai.com)
- Documentation pages, public help articles
- Blog posts, news articles, Wikipedia
- Public GitHub repos

When in doubt, use "device_mockup" layout with "product_logo_ui" visual type.
It generates a clean AI image of the UI inside a device frame — ALWAYS looks better than a failed screenshot.

CRITICAL FOR screen_capture BEATS:
The visualPrompt MUST start with the actual URL, followed by a description.
Format: "https://tool-url.com — description of what should be visible on screen"

ZOOM PUNCH (mark 2-4 beats per script):
Set "zoomPunch": true on beats with emphatic moments — bold claims, step reveals, power words.
Good candidates: "Step one...", "This is the fastest way...", SO WHAT beats.
Do NOT put zoomPunch on every beat — 2-4 per script max.

WORD STYLES (multi-style captions):
For each beat, include a "wordStyles" object that maps specific spoken words to visual treatments:
- "hero" — Tool names, feature names, proper nouns (serif italic, 30% larger). E.g., "Canva", "Magic Layers", "Gemini"
- "action" — Verbs, action words (gold bold, 15% larger). E.g., "upload", "click", "generate", "open"
- "danger" — Warnings, bold claims, superlatives (red, 20% larger). E.g., "fastest", "never", "impossible"
- "pill" — Quoted terms, categories, tags (black on gold pill). E.g., "flyer", "menu", "poster"

Include 3-6 word style mappings per beat. Don't over-style — most words stay normal.

ICON GRID ITEMS (for icon_grid layout beats only):
Include "iconGridItems" array with 2-4 items, each having emoji + short label.
Example: [{"emoji": "📄", "label": "Flyers"}, {"emoji": "🍔", "label": "Menus"}, {"emoji": "📱", "label": "Posts"}]

DEVICE TYPE (for device_mockup layout beats only):
Include "deviceType": "macbook" for desktop tools/websites, "iphone" for mobile apps.

OUTPUT FORMAT: Return valid JSON. V9 additions are REQUIRED for every non-closeup beat (subShots), and REQUIRED for beat 1 (hookArchetype + subShots + layout="cold_open_hook").

{
  "topic": "string",
  "hook": "string — beat 1 narration",
  "totalDurationSec": number,
  "beats": [
    {
      "id": 1,
      "startSec": 0,
      "durationSec": 4,
      "narration": "string with [SECTION] markers",
      "layout": "cold_open_hook|pip|fullscreen_broll|avatar_closeup|text_card|device_mockup|icon_grid|motion_graphic",
      "visualType": "screen_capture|product_logo_ui|data_graphic|cinematic_concept|generic_action|named_person",
      "visualPrompt": "detailed cinematographer-grade prompt (shot type + angle + lens + lighting + negatives)",
      "visualSubject": "string|null",
      "motionStyle": "ai_video|static_ken_burns|stock_clip|screen_capture",
      "transition": "cut|dissolve|zoom_in|slide_left",
      "captionEmphasis": ["keyword1", "keyword2"],
      "textCardText": "string|null — for text_card layout only",
      "textCardColor": "string|null — hex for text_card background",
      "sectionMarker": "string|null — HOOK, DAYTAG, BRIDGE, STEP1-5, SOWHAT, SIGNOFF",
      "wordStyles": {"ToolName": "hero", "click": "action"},
      "zoomPunch": false,
      "iconGridItems": null,
      "deviceType": null,

      "hookArchetype": "A1_object_collision | ... | A8_pov_first_person (ONLY on beat 1, layout=cold_open_hook)",
      "voOverVisuals": true,
      "subShots": [
        {
          "durationSec": 1.4,
          "cameraMove": "locked|slow_push_in|slow_pull_out|whip_pan|handheld_drift|macro_rack_focus|crane_down|orbit",
          "onScreenContent": "cinematographer-grade description of what the viewer sees",
          "progressiveElements": [
            {"what": "second-hand ticks", "appearsAtMs": 0, "how": "write_on|slide_left|slide_right|slide_up|slide_down|scale_up|scale_down|letter_by_letter|fade_in|wipe_in"}
          ],
          "captionOverlay": {
            "text": "WORK TIME, GONE.",
            "entryDirection": "letter_by_letter|slide_left|slide_right|slide_up|slide_down|scale_up",
            "offsetMs": 300
          },
          "transitionOut": "whip_pan|cut|flash_cut|shader_wipe|cross_dissolve|zoom_punch|jumbotron",
          "assetPrompt": "full cinematographer-grade generation prompt — shot type, angle, lens feel, scene contents, motion spec, lighting, focus, reference aesthetic, negative prompts"
        }
      ]
    }
  ],
  "caption": "string — Instagram caption (educational angle, 3-5 hashtags)",
  "hashtags": ["ainewsyoucanuse", "ai", "tech"],
  "cta": "I'm Quinn. Your AI helping you navigate AI. For more AI news you can use, give us a follow."
}

SUB-SHOTS RULES (V9 Laws 0.2 + 0.5 + 0.6):
- Beat 1 (cold_open_hook): 2–3 subShots, each 0.8–2.0s, total 3.0–6.0s.
- Non-closeup beats (pip/fullscreen_broll/device_mockup/icon_grid/motion_graphic): 2–3 subShots, each 0.8–2.0s.
- avatar_closeup and text_card beats: subShots optional (Remotion renders them with motion-rich components).
- Never more than 2.0s on any single sub-shot.
- Vary transitionOut across the reel — no two consecutive sub-shots use the same transition.
- Vary captionOverlay.entryDirection — ≥4 distinct styles per reel.

HOOK PROMPT QUALITY (Law 0.4) — assetPrompt for Beat 1 sub-shots MUST include:
- Shot type + camera angle + lens feel (e.g. "Macro closeup, 85mm-equivalent, locked-off head-on")
- Aspect + duration + fps (e.g. "vertical 1080×1920, 1.4 seconds at 30fps")
- Exact scene contents (what objects / UI / cartoon elements are visible, where they sit)
- Motion spec (what moves, in what direction, at what pace, over how many ms)
- Lighting + focus (quality, direction, mood, what's sharp, what falls off)
- Reference aesthetic ("Apple keynote", "early 2000s Adult Swim bumper", "Wes Anderson macro")
- Negative prompts ("no hallucinated text, no watermarks, no stock-photo look, no real-person faces, consistent style")`;

export async function generateAinycuScript(opts: AinycuScriptOptions): Promise<VideoScript> {
  const { topic, angle, dayNumber, verifiedFacts, feedback, signal } = opts;

  let userPrompt = `Create a V9 educational reel script about this topic — target 30–45 seconds of SPOKEN prose (Quinn's TTS runs ~1.4× the prose length, so the final reel lands ~55–63s including the 4s cold-open hook, 2.6s CRT TV drop, and 4s outro). Write for MAX 45 spoken seconds — the pipeline prunes beats beyond that so your script gets shorter, not longer, in post.\n\n${topic}\n\n`;

  userPrompt += `SERIES: "AI News You Can Use" — Day ${dayNumber} of 30.\n`;
  userPrompt += `The Day Tag beat MUST say: "Welcome to Day ${dayNumber} of AI News You Can Use."\n`;
  userPrompt += `The textCardText for the Day Tag beat MUST be: "DAY ${dayNumber}\\nAI NEWS YOU CAN USE"\n\n`;

  if (angle) {
    userPrompt += `ANGLE (the "here's what you can do"): ${angle}\n\n`;
  }

  userPrompt += `Sign-off CTA: Pick one of the rotating CTA options from the system prompt (Option A is the default). Do NOT say "Stay suggested." Do NOT say "give us a follow."\n\n`;

  if (verifiedFacts && verifiedFacts.length > 0) {
    userPrompt += "VERIFIED FACTS (narration MUST be based on these — do NOT add claims not listed here):\n";
    for (const f of verifiedFacts) {
      userPrompt += `- ${f.fact} [Source: ${f.sourceUrl}]\n`;
    }
    userPrompt += "\nUse these facts for the walkthrough steps. LEAD WITH THE MOST IMPRESSIVE FEATURES AND CAPABILITIES — the things that make people say 'wait, it can do THAT?' Do NOT waste beats on generic prompting advice. Show what the tool can DO. You can add personality and commentary, but the INSTRUCTIONAL CONTENT must come from these facts.\n\nCRITICAL: Each walkthrough step must cover a DIFFERENT fact/feature from the list above. Do NOT reuse or rephrase the same capability across multiple steps. If the facts mention 5 distinct features, your walkthrough should cover 3-5 of them — one per step. Name each feature explicitly.\n\n";
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

// Layouts that are rendered entirely by Remotion — no external b-roll needed
const REMOTION_ONLY_LAYOUTS: LayoutMode[] = ["icon_grid", "motion_graphic"];

const VALID_WORD_STYLES = ["hero", "action", "danger", "pill"] as const;

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
  const validLayouts: LayoutMode[] = [
    "pip", "fullscreen_broll", "avatar_closeup", "text_card",
    "device_mockup", "icon_grid", "motion_graphic", "cold_open_hook",
  ];
  const validHookArchetypes: HookArchetype[] = [
    "A1_object_collision", "A2_villain_vs_hero", "A3_before_after_jumpcut",
    "A4_cartoon_reaction", "A5_ui_gesture_macro", "A6_icon_storm",
    "A7_text_as_visual", "A8_pov_first_person",
  ];

  let runningTime = 0;
  const beats: Beat[] = raw.beats.map((b: any, i: number) => {
    const duration = clamp(b.durationSec ?? 3, 2, 8);
    const isFirst = i === 0;
    const isLast = i === raw.beats.length - 1;
    const isDayTag = i === 1; // Beat 2 is always the day tag (CRT TV brand moment)
    const defaultLayout: LayoutMode = isDayTag ? "text_card"
      : isFirst ? "cold_open_hook"
      : isLast ? "avatar_closeup"
      : "pip";

    // V9 Section 12a — beat 1 MUST be cold_open_hook regardless of what the LLM returned.
    // Do NOT honor an LLM-returned avatar_closeup for beat 1 — that silently bypasses the
    // pattern-interrupt protocol and degrades V9 quality.
    const resolvedLayout: LayoutMode = isFirst
      ? "cold_open_hook"
      : validLayouts.includes(b.layout) ? b.layout : defaultLayout;

    const beat: Beat = {
      id: i + 1,
      startSec: runningTime,
      durationSec: duration,
      narration: String(b.narration ?? ""),
      layout: resolvedLayout,
      visualType: validVisualTypes.includes(b.visualType) ? b.visualType : "screen_capture",
      visualPrompt: String(b.visualPrompt ?? b.narration ?? ""),
      visualSubject: b.visualSubject || undefined,
      motionStyle: validMotionStyles.includes(b.motionStyle) ? b.motionStyle : "static_ken_burns",
      transition: validTransitions.includes(b.transition) ? b.transition : "cut",
      captionEmphasis: Array.isArray(b.captionEmphasis) ? b.captionEmphasis.map(String) : [],
      textCardText: b.textCardText ? String(b.textCardText) : undefined,
      textCardColor: b.textCardColor ? String(b.textCardColor) : undefined,
    };

    // V9 — section marker (used by pruning logic + asset router)
    const rawSection = (b.sectionMarker ?? b.section ?? "").toString().toLowerCase();
    if (rawSection) beat.section = rawSection;
    else if (isFirst) beat.section = "hook";
    else if (isDayTag) beat.section = "daytag";
    else if (isLast) beat.section = "signoff";

    // V9 Section 12a — hook archetype + subShots (required on beat 1)
    if (beat.layout === "cold_open_hook") {
      if (validHookArchetypes.includes(b.hookArchetype)) {
        beat.hookArchetype = b.hookArchetype as HookArchetype;
      } else {
        // Default to the most generically usable archetype; asset generator will still produce output.
        beat.hookArchetype = "A7_text_as_visual";
        console.warn(`[AINYCU ScriptDirector] Beat 1 hookArchetype missing/invalid — defaulted to A7_text_as_visual`);
      }
      beat.voOverVisuals = b.voOverVisuals !== false; // default true
      beat.section = "hook";
    }

    // V9 Law 0.5 — subShots for any non-closeup/non-textcard beat
    if (Array.isArray(b.subShots) && b.subShots.length > 0) {
      beat.subShots = sanitizeSubShots(b.subShots, beat.layout);
    } else if (beat.layout === "cold_open_hook") {
      // Missing subShots on the hook is a critical gap — generate a minimal-viable 3-shot fallback
      // so the pipeline doesn't fail. Asset generator will still apply cinematographer-grade wrapping.
      beat.subShots = buildHookFallbackSubShots(beat);
      console.warn(`[AINYCU ScriptDirector] Beat 1 missing subShots — generated fallback hook subShots`);
    }

    // V9 Law 0.6 — total hook duration reflects sum of subShots
    if (beat.layout === "cold_open_hook" && beat.subShots && beat.subShots.length > 0) {
      const hookSum = beat.subShots.reduce((s, shot) => s + shot.durationSec, 0);
      beat.durationSec = Math.min(Math.max(hookSum, 3.0), 6.0);
    }

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
        .slice(0, 4)  // max 4 items
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

  // V9 Law 0.1 — SCRIPT-STAGE duration cap on SPOKEN prose, not runtime.
  // Avatar TTS runs ~1.4× estimated, so 45s spoken → ~63s reel (hook 4s + brand 2.6s + body +
  // outro 4s). Prune whole beats at GENERATION time. Never runtime-truncate — Quinn finishes her sentence.
  // Prefer removing the second-to-last walkthrough beat first (keeps bridge→steps→sowhat arc tight).
  const PROTECTED_SECTIONS = new Set(["hook", "daytag", "bridge", "sowhat", "signoff"]);
  let spokenDuration = estimateSpokenSec(beats);
  while (spokenDuration > MAX_SPOKEN_SEC && beats.length > 6) {
    // Walk from end backwards, skip protected sections, prefer the LAST walkthrough beat
    // (which is usually the least important step if the director already ordered by priority)
    let removeIdx = -1;
    for (let i = beats.length - 1; i >= 0; i--) {
      if (!PROTECTED_SECTIONS.has(beats[i].section ?? "")) {
        removeIdx = i;
        break;
      }
    }
    if (removeIdx === -1) break;
    const removed = beats.splice(removeIdx, 1)[0];
    spokenDuration = estimateSpokenSec(beats);
    console.log(`[AINYCU ScriptDirector] V9 duration prune: removed beat "${removed.narration?.slice(0, 40)}..." (~${removed.durationSec}s visual) — est spoken now ${spokenDuration.toFixed(1)}s`);
  }

  // Re-time after pruning so startSec is sequential and beats.id is stable
  let t = 0;
  for (const b of beats) { b.startSec = t; t += b.durationSec; }
  beats.forEach((b, i) => { b.id = i + 1; });
  const totalDuration = beats.reduce((sum, b) => sum + b.durationSec, 0);

  if (spokenDuration < MIN_SPOKEN_SEC) {
    console.warn(`[AINYCU ScriptDirector] Spoken duration ~${spokenDuration.toFixed(1)}s is under MIN_SPOKEN_SEC ${MIN_SPOKEN_SEC}s — reel will feel thin`);
  }
  if (spokenDuration > MAX_SPOKEN_SEC) {
    console.warn(`[AINYCU ScriptDirector] Spoken duration ~${spokenDuration.toFixed(1)}s still > MAX_SPOKEN_SEC ${MAX_SPOKEN_SEC}s after pruning — script too dense, may need regeneration`);
  }

  // V9 Laws 0.2 / 0.5 — post-hoc lint of sub-shot coverage + pace
  lintV9Density(beats);

  return {
    topic: String(raw.topic),
    hook: String(raw.hook ?? beats[0]?.narration ?? ""),
    totalDurationSec: totalDuration,
    beats,
    caption: String(raw.caption ?? ""),
    hashtags: Array.isArray(raw.hashtags)
      ? raw.hashtags.map(String)
      : ["ainewsyoucanuse", "ai", "aitools"],
    cta: String(raw.cta ?? "I'm Quinn, your AI helping you navigate AI. I drop a new tool you can use every Tuesday and Thursday. Follow to catch the next one."),
  };
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ─── V9 Helpers ─────────────────────────────────────────────

/**
 * Estimate spoken duration from NARRATION TEXT (not beat.durationSec which includes
 * visual padding). Uses ~2.3 words/second as Quinn's natural TTS pace.
 */
function estimateSpokenSec(beats: Beat[]): number {
  const WORDS_PER_SEC = 2.3;
  const totalWords = beats
    .map(b => (b.narration ?? "")
      .replace(/\[[A-Z0-9]+\]/g, "")  // strip section markers
      .split(/\s+/).filter(Boolean).length)
    .reduce((a, b) => a + b, 0);
  return totalWords / WORDS_PER_SEC;
}

/**
 * Coerce LLM-emitted subShots into valid ShotSpec[] — clamps duration to 0.8–2.0s
 * (Law 0.6), validates cameraMove/transitionOut enums, caps at 3 entries.
 */
function sanitizeSubShots(raw: any[], layout: LayoutMode): ShotSpec[] {
  const validCameraMoves: ShotSpec["cameraMove"][] = [
    "locked", "slow_push_in", "slow_pull_out", "whip_pan",
    "handheld_drift", "macro_rack_focus", "crane_down", "orbit",
  ];
  const validTransitions: ShotSpec["transitionOut"][] = [
    "cut", "whip_pan", "flash_cut", "shader_wipe",
    "cross_dissolve", "zoom_punch", "jumbotron",
  ];
  const validEntryDirections = [
    "slide_left", "slide_right", "slide_up", "slide_down",
    "scale_up", "letter_by_letter",
  ] as const;
  const validHow = [
    "slide_left", "slide_right", "slide_up", "slide_down",
    "scale_up", "scale_down", "letter_by_letter", "write_on",
    "fade_in", "wipe_in",
  ] as const;

  const shots: ShotSpec[] = raw.slice(0, 3).map((s: any, idx: number): ShotSpec => {
    const dur = clamp(Number(s.durationSec) || 1.4, 0.8, MAX_SHOT_SEC);
    const cameraMove = (validCameraMoves as string[]).includes(s.cameraMove) ? s.cameraMove : "locked";
    const transitionOut = (validTransitions as string[]).includes(s.transitionOut) ? s.transitionOut : "cut";

    const shot: ShotSpec = {
      durationSec: dur,
      cameraMove,
      onScreenContent: String(s.onScreenContent ?? s.prompt ?? ""),
      transitionOut,
      assetPrompt: String(s.assetPrompt ?? s.onScreenContent ?? ""),
    };

    if (Array.isArray(s.progressiveElements)) {
      shot.progressiveElements = s.progressiveElements
        .filter((p: any) => p && typeof p === "object")
        .slice(0, 5)
        .map((p: any) => ({
          what: String(p.what ?? ""),
          appearsAtMs: Math.max(0, Number(p.appearsAtMs) || 0),
          how: (validHow as readonly string[]).includes(p.how) ? p.how : "fade_in",
        }));
    }

    if (s.captionOverlay && typeof s.captionOverlay === "object") {
      const text = String(s.captionOverlay.text ?? "").trim();
      if (text && text.length > 0) {
        shot.captionOverlay = {
          text: text.split(/\s+/).slice(0, 6).join(" "),  // enforce ≤6 words
          entryDirection: (validEntryDirections as readonly string[]).includes(s.captionOverlay.entryDirection)
            ? s.captionOverlay.entryDirection
            : "letter_by_letter",
          offsetMs: Math.max(0, Number(s.captionOverlay.offsetMs) || 0),
        };
      }
    }

    return shot;
  });

  // Enforce minimum 2 sub-shots for cold_open_hook (pattern interrupt needs a beat + a payoff)
  if (layout === "cold_open_hook" && shots.length < 2) {
    shots.push({
      durationSec: 1.2,
      cameraMove: "locked",
      onScreenContent: "Payoff shot — resolves the interrupt visually",
      transitionOut: "cut",
      assetPrompt: "Cinematic resolution shot matching the hook's subject. Vertical 1080x1920, 1.2s at 30fps. Locked-off composition. Clean frame, final element in focus, hard lighting, editorial style. Negative: no text hallucination, no watermarks, no stock-photo look.",
    });
  }

  return shots;
}

/**
 * Minimum-viable fallback hook subShots when the LLM forgets to emit them.
 * Produces a 3-shot (1.4 + 1.6 + 1.0 = 4.0s) pattern interrupt using the A7 text-as-visual
 * archetype, which works for any subject since kinetic typography fits any topic.
 */
function buildHookFallbackSubShots(beat: Beat): ShotSpec[] {
  // Strip [SECTION] markers before using narration in prompts — otherwise "[HOOK]" leaks to Nano Banana.
  const cleanNarration = (beat.narration ?? "").replace(/\[[A-Z0-9]+\]/g, "").trim();
  const subject = cleanNarration.slice(0, 50) || "AI news you can use";
  return [
    {
      durationSec: 1.4,
      cameraMove: "slow_push_in",
      onScreenContent: `Massive kinetic typography on matte black. Key phrase from: "${subject}". Letters spring in staggered.`,
      progressiveElements: [
        { what: "key phrase letters", appearsAtMs: 0, how: "letter_by_letter" },
      ],
      transitionOut: "flash_cut",
      assetPrompt: `Vertical 1080x1920, 1.4 seconds at 30fps. Macro typography composition on matte black background. Massive bold sans-serif letters (Inter Black 900) in white with gold accent underline (#e89b06). Key phrase derived from: "${subject}". Letters spring-enter one at a time from below, scale 0.4→1.0 with overshoot. Lighting: hard rim light on letter edges. Focus: tack sharp. Style: Apple keynote title card, early 2000s MTV bumper energy. Negative: no hallucinated text, no watermarks, no stock-photo look, no real-person faces, consistent style.`,
    },
    {
      durationSec: 1.6,
      cameraMove: "whip_pan",
      onScreenContent: `Secondary visual metaphor tied to subject. Fast cut after the typography — delivers the "so what".`,
      progressiveElements: [
        { what: "metaphor object", appearsAtMs: 100, how: "slide_left" },
      ],
      captionOverlay: {
        text: "WATCH THIS.",
        entryDirection: "scale_up",
        offsetMs: 200,
      },
      transitionOut: "zoom_punch",
      assetPrompt: `Vertical 1080x1920, 1.6 seconds at 30fps. Macro shot of a visual metaphor for "${subject}" on matte black — flat vector illustration style, single subject centered, whipping in from the right with motion blur. Lighting: hard key light upper-left, deep shadows. Focus: tack sharp on subject, background matte black. Style: Wes Anderson symmetry, premium product demo. Negative: no hallucinated text, no watermarks, no stock-photo look, no real-person faces.`,
    },
    {
      durationSec: 1.0,
      cameraMove: "locked",
      onScreenContent: `Resolution beat — the subject fully revealed. Holds on final frame 0.6s then transitions to the CRT TV drop.`,
      transitionOut: "cross_dissolve",
      assetPrompt: `Vertical 1080x1920, 1.0 seconds at 30fps. Locked-off final composition showing the resolution of "${subject}". Clean frame, single hero element in focus, matte black background, hard editorial lighting. Style: final Apple keynote beat, settles rather than moves. Negative: no hallucinated text, no watermarks, no stock-photo look, consistent style.`,
    },
  ];
}

/**
 * V9 Laws 0.2 + 0.6 post-generation lint. Warns (not throws) — pipeline continues
 * but the issues surface in Railway logs and can inform script-director prompt tuning.
 */
function lintV9Density(beats: Beat[]): void {
  const issues: string[] = [];

  // Law 0.5 — every non-closeup/non-textcard beat should have subShots
  for (const b of beats) {
    const exempt = b.layout === "avatar_closeup" || b.layout === "text_card";
    if (!exempt && (!b.subShots || b.subShots.length < 2)) {
      issues.push(`Beat ${b.id} (${b.layout}) has ${b.subShots?.length ?? 0} sub-shots, need ≥2 (Law 0.5)`);
    }
  }

  // Law 0.6 — no sub-shot > 2.0s
  for (const b of beats) {
    if (!b.subShots) continue;
    for (let i = 0; i < b.subShots.length; i++) {
      const s = b.subShots[i];
      if (s.durationSec > MAX_SHOT_SEC + 0.01) {
        issues.push(`Beat ${b.id} sub-shot ${i} is ${s.durationSec.toFixed(2)}s (> ${MAX_SHOT_SEC}s cap, Law 0.6)`);
      }
    }
  }

  // Law 0.2 — entry-direction + transition variety
  const entries = beats.flatMap(b => b.subShots?.flatMap(s => s.captionOverlay?.entryDirection ?? []) ?? []);
  const transitions = beats.flatMap(b => b.subShots?.map(s => s.transitionOut) ?? []);
  const entryVariety = new Set(entries).size;
  const transitionVariety = new Set(transitions).size;
  if (entries.length > 0 && entryVariety < 3) {
    issues.push(`Only ${entryVariety} distinct caption entrance styles across reel (Law 0.2 wants ≥4)`);
  }
  if (transitions.length > 0 && transitionVariety < 3) {
    issues.push(`Only ${transitionVariety} distinct transitions across reel (Law 0.2 wants ≥4)`);
  }

  // Back-to-back repeat check
  for (let i = 1; i < transitions.length; i++) {
    if (transitions[i] === transitions[i - 1]) {
      issues.push(`Repeated transition "${transitions[i]}" back-to-back at sub-shot index ${i} (Law 0.2)`);
    }
  }

  if (issues.length > 0) {
    console.warn(`[AINYCU ScriptDirector] V9 density lint found ${issues.length} issue(s):`);
    for (const msg of issues) console.warn(`  - ${msg}`);
  } else {
    console.log(`[AINYCU ScriptDirector] V9 density lint passed (Laws 0.2/0.5/0.6)`);
  }
}
