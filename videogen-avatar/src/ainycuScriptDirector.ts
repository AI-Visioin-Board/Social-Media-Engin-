// ============================================================
// AI News You Can Use — Educational Script Director
// Takes verified facts about a usable AI tool/feature →
// produces beat-by-beat VideoScript with Educational Quinn voice
// and the AINYCU series framework (hook → day tag → walkthrough → sign-off)
// ============================================================

import { CONFIG } from "./config.js";
import type { VideoScript, Beat, Shot, VisualType, MotionStyle, TransitionType, LayoutMode } from "./types.js";

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

SCRIPT LENGTH — HARD RULES (this is the single most common failure mode):

The avatar speaks at ~150-160 words per minute. A 60-second video = 135-145 words TOTAL.
You will be REJECTED and retried if you exceed 145 words. Budget every word.

WORD BUDGET PER BEAT (MUST fit within these caps):
- HOOK: 12-18 words   (~5-7s)
- DAYTAG: 8-10 words  (~4s)
- BRIDGE: 10-14 words (~5s)
- Each STEP beat: 12-16 words (~5-6s)     [NEVER more than 16 per step]
- SOWHAT: 14-20 words (~6-8s)
- SIGNOFF: 10-14 words (~5s)

HARD LENGTH RULE: Total script word count MUST be ≤ 145 words. If you write 200 words, you failed.

ANTI-BLOAT RULES (these are what turn 60s scripts into 100s scripts):

1. DO NOT narrate UI click paths. The visuals show the clicks.
   BAD (11 words of audio describing clicks): "Go to Settings, Integrations, Slack, hit Connect, then tag @manus in a thread."
   GOOD (6 words — the shots show the path): "Tag @manus in any Slack thread."

2. DO NOT double-describe what the visuals already show.
   BAD (14 words naming outputs TWICE): "ask for a presentation, landing page, document analysis. You see PPT, PDF, Excel come out."
   GOOD (7 words — shots show the file icons): "Ask for a deck, a doc, anything."

3. DO NOT pad with "You see…" phrases. They narrate the visuals at the viewer, who is already watching.
   BAD: "You see repeat work start with your rules already loaded."
   GOOD: "Every task inherits your rules."

4. DO NOT list every product SKU/tier audibly. Visuals show tables.
   BAD: "Free gives you 1.6 Lite in Agent Mode, Pro adds 1.6 and 1.6 Max, both include Chat Mode."
   GOOD: "Free gets you Agent Mode. Pro unlocks Max."

5. Every sentence earns its words. Contract, trim articles, cut "that"/"which" where unnecessary.

SCRIPT STRUCTURE (follow EXACTLY — 8-10 beats, 55-65 seconds total):

Beat 1 — HOOK (5-6 sec, 12-18 words): CONFLICT-FRAMED or NEWS-HOOKABLE opener. Stops the scroll in 2 seconds.
  Layout: "avatar_closeup"

  The hook is the single most important beat. A bland hook ("X is a cool new AI tool")
  wastes the entire reel. Use one of these proven patterns — pick the ONE that fits the topic:

  A) "Just killed" / "just nuked" / "just made obsolete" framing
     - "Manus AI Agent just killed every other agent out there."
     - "This new tool just made ChatGPT Plus look ancient."
     - "Claude just nuked every writing app on your phone."

  B) Authority figure + bold claim
     - "Meta CEO Mark Zuckerberg just nuked the competition with Manus AI."
     - "Sam Altman says this is ChatGPT's biggest update ever — here's what changed."
     - "Google's head of AI just said this tool beats Gemini. Here's what it does."

  C) "Just dropped" / "Everyone's using" / breaking-news framing
     - "A new AI agent just dropped. Here's five things it can do for you."
     - "Everyone's sleeping on this one. It's the best AI tool I've tested this year."
     - "This launched 48 hours ago and it's already replacing three of my apps."

  D) Number-payoff / listicle hook
     - "Five things Manus AI can do in your daily work that nothing else can."
     - "Three ways this new tool saves you an hour every day."

  E) Pattern-interrupt question
     - "What if ChatGPT could send your emails for you? It can now."
     - "You're still paying for this software? Not after you see what Canva AI just added."

  RULES:
  - 12-18 words. No longer. The first 5 words have to hook — put the conflict/news up front.
  - NEVER open with "Today we're talking about..." or "Let me show you..." — those are dead hooks.
  - NEVER describe the feature generically — name the tool AND the framing in one sentence.
  - If the topic genuinely lacks a news hook, use pattern D (number-payoff). Do NOT invent fake news.
  - Avoid "revolutionary", "game-changing", "next-gen" — these are weak corporate filler words.

Beat 2 — DAY TAG (4 sec, 8-10 words): Text card with the series identifier.
  Layout: MUST be "text_card"
  textCardText: "DAY [X]\\nAI NEWS YOU CAN USE"
  textCardColor: "#000000"
  Narration: "Welcome to Day [X] of AI News You Can Use."

Beat 3 — BRIDGE (5 sec, 10-14 words): Connect the topic to the viewer's life.
  Layout: "avatar_closeup" or "icon_grid" (if listing what this helps with)
  Example: "If your work lives in chats and repeat tasks, this is for you."

Beats 4-7 — THE WALKTHROUGH (20-28 sec, 12-16 words per step beat): 2-3 concrete steps.
  Each step beat = ONE sentence. Maximum 16 words. No UI click paths in audio.
  The VISUALS show the clicks — your job is to name the feature and its payoff.
  Layout mix: pip, device_mockup, icon_grid, motion_graphic (never 3 pips in a row).
  Use: "Step one..." "Step two..." "And..." to transition between.

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
- Total word count: 125-145 words (55-65 seconds at natural pace) — HARD CAP 145
- Name each feature once, then move on — no restating for emphasis
- Visual change every 1-2 seconds via shots[] — see SHOT DENSITY below

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
- "pip" — Avatar bottom + B-roll top in TV frame. USE when showing an actual tool screen or video clip.
- "fullscreen_broll" — Full-screen B-roll with caption overlay. USE for dramatic/cinematic moments.
- "avatar_closeup" — Full-screen Quinn. USE for hook, bridge, so-what, sign-off (personal connection).
- "text_card" — Bold text on colored background. USE for day tags, stats, bold claims, pull quotes.
- "device_mockup" — B-roll inside a CSS MacBook or iPhone frame. USE when showing a website or app screenshot.
- "icon_grid" — Animated emoji grid (2-4 items). USE for lists of features, categories, or options.
- "motion_graphic" — Animated workflow/process diagram. USE for step-by-step concepts or before/after comparisons.

LAYOUT RULES:
- NEVER use the same layout 2 beats in a row (except avatar_closeup for hook→daytag transition)
- Open with avatar_closeup (beat 1)
- Close with avatar_closeup (last beat)
- Beat 2 is ALWAYS text_card (day tag)
- Include at least 1 icon_grid OR 1 motion_graphic per script (visual variety)
- Walkthrough beats: mix pip + device_mockup + icon_grid — don't do 3 pips in a row

VISUAL TYPES (one per beat — or one per SHOT when shots[] is used):
- "screen_capture" — Real screenshot of a website/app. ONLY use for PUBLIC pages (see rules below).
- "product_logo_ui" — AI-generated image of app icons, product UI, clean interfaces.
- "data_graphic" — Stats, comparisons, infographic-style.
- "cinematic_concept" — Abstract/dramatic (use sparingly).
- "generic_action" — Stock footage (LAST RESORT).
- "reaction_clip" — Talking-head clip of a named public AI figure (Sam Altman, Dario Amodei, etc.) or a reaction shot. Requires visualSubject.
- "brand_logo_card" — A single product/company logo centered on a clean gradient background. Use when naming a brand or tool. Set visualSubject to the brand name (e.g. "Slack", "Manus", "Microsoft").
- "stat_card" — Huge number + tiny label, Remotion-rendered. Use for dollar figures, percentages, multipliers, counts. visualPrompt MUST be JSON-ish: "number:$20 | label:per month" or "number:10M | label:users".

SHOT DENSITY (v9 — 4x density pass — MANDATORY for visual-heavy layouts):

Every b-roll-driven beat MUST be broken into SHOTS that each hold for 0.8-2.0 seconds.
Without shots[], a 5-second pip beat holds ONE image for 5 seconds — which looks amateur.
With shots[], the same 5 seconds shows 3-4 different visuals with hard cuts between them.

WHEN TO PROVIDE shots[]:
- REQUIRED on every beat with layout "pip", "fullscreen_broll", or "device_mockup" ≥ 3s
- OPTIONAL on "icon_grid", "motion_graphic", "avatar_closeup", "text_card" — those layouts
  animate internally, so shots[] is usually unnecessary

SHOT COUNT FORMULA:
- Beat duration 3-4s  → 2-3 shots  (each ~1.3s)
- Beat duration 5-6s  → 3-4 shots  (each ~1.5s)
- Beat duration 7-8s  → 4-5 shots  (each ~1.6s)

SHOT SCHEMA — inside each b-roll beat:
"shots": [
  {
    "idx": 1,
    "startSec": 0,
    "durationSec": 1.2,
    "visualType": "brand_logo_card",
    "visualPrompt": "Slack logo on gradient",
    "visualSubject": "Slack",
    "motionStyle": "static_ken_burns",
    "emphasisWord": "Slack"
  },
  {
    "idx": 2,
    "startSec": 1.2,
    "durationSec": 1.5,
    "visualType": "product_logo_ui",
    "visualPrompt": "Slack thread with @manus tag highlighted in yellow pill",
    "motionStyle": "ai_video",
    "emphasisWord": "@manus"
  },
  { "idx": 3, "startSec": 2.7, "durationSec": 1.3, ... },
  { "idx": 4, "startSec": 4.0, "durationSec": 1.0, ... }
]

SHOT DESIGN RULES:
- Shot 1 is usually a BRAND ANCHOR — brand_logo_card or product_logo_ui of the app being discussed
- Shots 2-3 show CONCRETE UI MOMENTS — specific buttons, screens, or actions
- Shot 4 is often a PAYOFF — the file appearing, the result, the stat
- MIX visualTypes across shots — never 4 brand_logo_cards in a row
- Each shot's visualPrompt is a TIGHT description of ONE specific thing visible on screen
- emphasisWord is 1-3 words that burn-in as a yellow-pill chyron while the shot is visible.
  Pick the single most important word the viewer should remember from that micro-moment.
- startSec values must be monotonically increasing. Sum of durationSec across shots MUST equal beat.durationSec.

SHOT PROMPT QUALITY — each visualPrompt should be SPECIFIC, like a cinematographer's shot list:
BAD: "Slack interface"
GOOD: "MacBook screen showing Slack channel sidebar with 'general' selected and a @manus thread below with 3 replies"
BAD: "Manus screenshot"
GOOD: "Manus Settings panel with Integrations tab open, Slack row highlighted, Connect button glowing"

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
      "narration": "string with [SECTION] markers",
      "layout": "pip|fullscreen_broll|avatar_closeup|text_card|device_mockup|icon_grid|motion_graphic",
      "visualType": "screen_capture|product_logo_ui|data_graphic|cinematic_concept|generic_action|named_person|reaction_clip|brand_logo_card|stat_card",
      "visualPrompt": "detailed prompt describing what to show on screen",
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
      "shots": [
        {
          "idx": 1,
          "startSec": 0,
          "durationSec": 1.2,
          "visualType": "brand_logo_card",
          "visualPrompt": "Slack logo on gradient",
          "visualSubject": "Slack",
          "motionStyle": "static_ken_burns",
          "emphasisWord": "Slack"
        }
      ]
    }
  ],
  "caption": "string — Instagram caption (educational angle, 3-5 hashtags)",
  "hashtags": ["ainewsyoucanuse", "ai", "tech"],
  "cta": "I'm Quinn. Your AI helping you navigate AI. For more AI news you can use, give us a follow."
}`;

// Hard word-count ceiling. Above this we retry with a trimming nudge.
const MAX_NARRATION_WORDS = 145;
// Soft ceiling. Logged but not retried.
const SOFT_NARRATION_WORDS = 135;

export async function generateAinycuScript(opts: AinycuScriptOptions): Promise<VideoScript> {
  const { topic, angle, dayNumber, verifiedFacts, feedback, signal } = opts;

  const baseUserPrompt = buildUserPrompt({ topic, angle, dayNumber, verifiedFacts, feedback });

  // First attempt
  let raw = await callOpenAI(baseUserPrompt, signal);
  let wordCount = countNarrationWords(raw);
  console.log(`[AINYCU ScriptDirector] Draft 1: ${wordCount} words`);

  // Retry once with explicit trimming nudge if over hard cap
  if (wordCount > MAX_NARRATION_WORDS) {
    console.warn(`[AINYCU ScriptDirector] ${wordCount} words > ${MAX_NARRATION_WORDS} cap — retrying with trim nudge`);
    const trimPrompt = baseUserPrompt +
      `\n\nYOUR PREVIOUS DRAFT WAS ${wordCount} WORDS — OVER THE 145-WORD HARD CAP.\n` +
      `Rewrite with the SAME structure and facts, but cut to ≤ ${SOFT_NARRATION_WORDS} words total.\n` +
      `Apply the anti-bloat rules from the system prompt aggressively:\n` +
      `- Cut "You see..." phrases entirely\n` +
      `- Replace UI click paths with a single feature name (the visuals show the path)\n` +
      `- Do not double-describe outputs\n` +
      `- Contract articles and drop filler ("that", "which", "just")\n` +
      `Return JSON only.`;
    raw = await callOpenAI(trimPrompt, signal);
    wordCount = countNarrationWords(raw);
    console.log(`[AINYCU ScriptDirector] Draft 2 (trimmed): ${wordCount} words`);
    if (wordCount > MAX_NARRATION_WORDS) {
      console.warn(`[AINYCU ScriptDirector] Still over cap at ${wordCount} words — validator will hard-trim by beat`);
    }
  }

  return validateAndCleanScript(raw, dayNumber);
}

function buildUserPrompt(p: {
  topic: string;
  angle?: string;
  dayNumber: number;
  verifiedFacts?: VerifiedFact[];
  feedback?: string;
}): string {
  const { topic, angle, dayNumber, verifiedFacts, feedback } = p;

  let userPrompt = `Create a 55-65 second educational reel script about this topic:\n\n${topic}\n\n`;

  userPrompt += `SERIES: "AI News You Can Use" — Day ${dayNumber} of 30.\n`;
  userPrompt += `The Day Tag beat MUST say: "Welcome to Day ${dayNumber} of AI News You Can Use."\n`;
  userPrompt += `The textCardText for the Day Tag beat MUST be: "DAY ${dayNumber}\\nAI NEWS YOU CAN USE"\n\n`;

  userPrompt += `HARD LENGTH CONSTRAINT: Total narration across all beats must be ≤ ${SOFT_NARRATION_WORDS} words (${MAX_NARRATION_WORDS} absolute max). Budget each beat per the word caps in the system prompt.\n\n`;

  if (angle) {
    userPrompt += `ANGLE (the "here's what you can do"): ${angle}\n\n`;
  }

  userPrompt += `Sign-off CTA: Pick one of the rotating CTA options from the system prompt (Option A is the default). Do NOT say "Stay suggested." Do NOT say "give us a follow."\n\n`;

  if (verifiedFacts && verifiedFacts.length > 0) {
    userPrompt += "VERIFIED FACTS (narration MUST be based on these — do NOT add claims not listed here):\n";
    for (const f of verifiedFacts) {
      userPrompt += `- ${f.fact} [Source: ${f.sourceUrl}]\n`;
    }
    userPrompt += "\nUse these facts for the walkthrough steps. LEAD WITH THE MOST IMPRESSIVE FEATURES AND CAPABILITIES. Do NOT waste beats on generic prompting advice. Show what the tool can DO.\n\nCRITICAL: Each walkthrough step must cover a DIFFERENT fact/feature. NAME each feature explicitly in ≤ 16 words per beat.\n\n";
  }

  if (feedback) {
    userPrompt += `USER FEEDBACK (address these concerns):\n${feedback}\n\n`;
  }

  userPrompt += "REMEMBER:\n";
  userPrompt += "- Every pip / fullscreen_broll / device_mockup beat ≥ 3s MUST include a shots[] array with 2-4 shots.\n";
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

  return JSON.parse(content);
}

// Count spoken words in narration, stripping [SECTION] markers.
function countNarrationWords(raw: any): number {
  if (!raw?.beats || !Array.isArray(raw.beats)) return 0;
  return raw.beats.reduce((sum: number, b: any) => {
    const n = String(b?.narration ?? "");
    // Strip section markers like [HOOK], [STEP1], etc. before counting
    const stripped = n.replace(/\[[A-Z0-9]+\]/g, "").trim();
    if (!stripped) return sum;
    return sum + stripped.split(/\s+/).filter(Boolean).length;
  }, 0);
}

// Layouts that are rendered entirely by Remotion — no external b-roll needed
const REMOTION_ONLY_LAYOUTS: LayoutMode[] = ["icon_grid", "motion_graphic"];

// Layouts that REQUIRE shots[] (b-roll-driven, hold > 1 shot looks amateur)
const SHOT_REQUIRED_LAYOUTS: LayoutMode[] = ["pip", "fullscreen_broll", "device_mockup"];

// Stat-card visualType is Remotion-rendered; brand_logo_card uses Nano Banana
const REMOTION_ONLY_VISUAL_TYPES: VisualType[] = ["stat_card"];

const VALID_WORD_STYLES = ["hero", "action", "danger", "pill"] as const;

const VALID_VISUAL_TYPES: VisualType[] = [
  "named_person", "product_logo_ui", "cinematic_concept",
  "generic_action", "data_graphic", "screen_capture",
  "reaction_clip", "brand_logo_card", "stat_card",
];
const VALID_MOTION_STYLES: MotionStyle[] = [
  "static_ken_burns", "ai_video", "stock_clip", "screen_capture",
];

function validateAndCleanScript(raw: any, dayNumber: number): VideoScript {
  if (!raw.topic || !raw.beats || !Array.isArray(raw.beats) || raw.beats.length === 0) {
    throw new Error("Invalid script: missing topic or beats array");
  }

  const validVisualTypes: VisualType[] = VALID_VISUAL_TYPES;
  const validMotionStyles: MotionStyle[] = VALID_MOTION_STYLES;
  const validTransitions: TransitionType[] = ["cut", "dissolve", "zoom_in", "slide_left"];
  const validLayouts: LayoutMode[] = [
    "pip", "fullscreen_broll", "avatar_closeup", "text_card",
    "device_mockup", "icon_grid", "motion_graphic",
  ];

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

    if (beat.visualType === "reaction_clip" && !beat.visualSubject) {
      // reaction_clip requires a subject (named person); downgrade if missing
      beat.visualType = "cinematic_concept";
    }

    if (beat.visualType === "generic_action" && beat.motionStyle !== "stock_clip") {
      beat.motionStyle = "stock_clip";
    }

    if (beat.visualType === "screen_capture") {
      beat.motionStyle = "screen_capture";
    }

    if (beat.visualType === "stat_card") {
      beat.motionStyle = "static_ken_burns";
      beat.remotionOnly = true; // rendered by Remotion, no asset fetch needed
    }

    if (beat.visualType === "brand_logo_card") {
      // Nano Banana render of a single brand logo on a clean gradient
      beat.motionStyle = "static_ken_burns";
    }

    // Extract section marker from narration leading tag (e.g. "[HOOK] Manus is...")
    const sectionMatch = beat.narration.match(/^\[([A-Z0-9]+)\]/);
    if (sectionMatch) {
      beat.section = sectionMatch[1].toLowerCase();
    }

    // ── Validate / Repair Shots ──
    // If the beat is a shot-required layout and no shots[] was provided, auto-split.
    // If shots[] was provided, normalize its timings to fit beat.durationSec.
    if (SHOT_REQUIRED_LAYOUTS.includes(beat.layout) && beat.durationSec >= 3) {
      beat.shots = validateAndRepairShots(beat, b.shots);
    } else if (Array.isArray(b.shots) && b.shots.length > 0) {
      // Caller provided shots[] on a layout that normally doesn't need them —
      // keep them if they're valid, they'll be honored downstream.
      beat.shots = validateAndRepairShots(beat, b.shots);
    }

    runningTime += duration;
    return beat;
  });

  // Hard trim: if over 50s estimated, remove walkthrough beats from the end
  // until we're under budget. Avatar speaks ~1.5-2x slower than estimated,
  // so 50s script → ~75-100s video. Target 40s → ~60-80s video.
  const MAX_SCRIPT_SEC = 50;
  let totalDuration = beats.reduce((sum, b) => sum + b.durationSec, 0);
  while (totalDuration > MAX_SCRIPT_SEC && beats.length > 6) {
    // Find last walkthrough beat (not hook, daytag, bridge, sowhat, or signoff)
    const sections = ["hook", "daytag", "bridge", "sowhat", "signoff"];
    let removeIdx = -1;
    for (let i = beats.length - 1; i >= 0; i--) {
      if (!sections.includes(beats[i].section ?? "")) {
        removeIdx = i;
        break;
      }
    }
    if (removeIdx === -1) break;
    const removed = beats.splice(removeIdx, 1)[0];
    totalDuration -= removed.durationSec;
    console.log(`[AINYCU ScriptDirector] Trimmed beat "${removed.narration?.slice(0, 40)}..." (${removed.durationSec}s) — now ${totalDuration}s`);
  }

  if (totalDuration < 25 || totalDuration > 55) {
    console.warn(`[AINYCU ScriptDirector] Duration ${totalDuration}s outside 25-55s range (target ~40s for ~60s actual video)`);
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
    cta: String(raw.cta ?? "I'm Quinn, your AI helping you navigate AI. I drop a new tool you can use every Tuesday and Thursday. Follow to catch the next one."),
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

  // Ideal shot count per the system prompt formula
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

  // If the LLM omitted shots[] or provided < 2, auto-split the beat evenly.
  if (shots.length < 2) {
    shots = autoSplitBeat(beat, targetCount);
  }

  // Clamp durations: 0.6s minimum, 2.5s max, and force sum == beat.durationSec
  shots = normalizeShotTimings(shots, duration);

  // Renumber idx + ensure monotonic startSec
  let cursor = 0;
  shots.forEach((s, i) => {
    s.idx = i + 1;
    s.startSec = cursor;
    cursor += s.durationSec;
  });

  return shots;
}

// Auto-generate N evenly-spaced shots for a beat that was missing shots[].
// Each shot inherits the beat's visual direction; the LLM has no sub-shot
// vocabulary here, so we fall back to "show the same thing from a different
// angle" — better than a single 5-second held frame.
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

// Enforce min/max shot duration and make the sum match beat duration exactly.
function normalizeShotTimings(shots: Shot[], totalDuration: number): Shot[] {
  if (shots.length === 0) return shots;

  const MIN = 0.6;
  const MAX = 2.5;

  // First pass: clamp each shot
  const clamped = shots.map(s => ({
    ...s,
    durationSec: clamp(s.durationSec, MIN, MAX),
  }));

  // Second pass: scale to match totalDuration
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
