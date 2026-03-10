/**
 * creativeDirector.ts
 *
 * The Creative Director agent sits between Stage 4 (Research) and Stage 5 (Media Generation).
 * For each slide in the carousel, it decides the VISUAL STRATEGY — not the text, not the
 * caption, just how the image/video should be composed.
 *
 * Design principles:
 * 1. ENGAGEMENT-FIRST: Strategies are scored by predicted P(share) and P(save) — the
 *    two strongest Instagram algorithm signals (DM shares = 5x weight, saves = 3.5x).
 * 2. VARIETY IS MANDATORY: At least 2 different strategies across 5 slides.
 * 3. COVER SLIDE = 80%: Slide 0 gets elevated creative reasoning.
 * 4. CINEMATIC PROMPTS: Scene descriptions follow the PROMPTHIS framework
 *    (Setting → Camera → Subject → Lighting → Mood) for professional-grade AI images.
 * 5. FALLBACK CASCADE: Every strategy degrades gracefully if assets aren't available.
 *
 * Research sources integrated:
 * - viralityFramework.ts (ALGORITHM_SIGNAL_WEIGHTS, CAROUSEL_ENGAGEMENT_TACTICS,
 *   MARKETING_BRAIN_ENHANCEMENT, COVER_HOOK_TEMPLATES)
 * - MaxsPrompts/Marketing-Prompts (546 skills, 4,368 prompts)
 * - PROMPTHIS Director's Console (cinematic prompt architecture)
 * - Buffer/Hootsuite/Emplifi 2026 Instagram research
 * - @evolving.ai reference style analysis
 */

import { invokeLLM } from "./_core/llm";
import {
  MARKETING_BRAIN_ENHANCEMENT,
  ALGORITHM_SIGNAL_WEIGHTS,
  CAROUSEL_ENGAGEMENT_TACTICS,
} from "./viralityFramework";
import { findAllLogosForText, LOGO_LIBRARY } from "./assetLibrary";

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * The 4 visual strategies the Creative Director can assign.
 *
 * "cinematic_scene"  — Pure AI-generated dramatic scene. NO logos, NO cutouts.
 *                      The image itself tells the story through metaphor/symbolism.
 *                      Best for: abstract trends, industry shifts, dramatic moments.
 *
 * "scene_with_badge" — AI-generated scene + 1-2 small corner logo badges (80-100px).
 *                      The scene is the hero; logos provide company context.
 *                      Best for: company-specific news where the scene IS the story.
 *
 * "person_composite" — AI-generated photorealistic scene with a named public figure
 *                      rendered naturally IN the environment via Nano Banana (Gemini).
 *                      Best for: CEO announcements, founder drama, executive moves.
 *                      ONLY for well-known public figures.
 *
 * "kling_video"      — 5-second cinematic video clip via Kling 2.5 Turbo (sole video provider).
 *                      Most engaging format. 2 per carousel (cost + time).
 *                      Best for: the most dramatic/action-oriented story.
 */
export type VisualStrategy =
  | "cinematic_scene"
  | "scene_with_badge"
  | "person_composite"
  | "kling_video";

/**
 * The 8 cover template layouts the Creative Director can choose for the cover slide (index 0).
 * Each template is a plug-and-play layout schema — the CD fills in the actual images and logos.
 */
export type CoverTemplate =
  | "council_of_players"
  | "backs_to_the_storm"
  | "solo_machine"
  | "person_floating_orbs"
  | "real_photo_corner_badges"
  | "left_column_logos"
  | "duo_reaction"
  | "screenshot_overlay"
  | "freeform_composition";

/** Per-slide creative brief — the output of the Creative Director for one slide */
export interface SlideCreativeBrief {
  slideIndex: number;
  strategy: VisualStrategy;

  /** Why this strategy was chosen — logged for debugging */
  reasoning: string;

  /**
   * PROMPTHIS-structured scene description for AI image generation.
   * Used as the background for ALL image strategies.
   * For kling_video, this is the video prompt with camera motion.
   */
  scenePrompt: string;

  /**
   * For scene_with_badge: which company key(s) to look up in LOGO_LIBRARY.
   * Max 2 (for dual-badge competition slides).
   * e.g. ["openai"] or ["google", "openai"]
   */
  logoKeys?: string[];

  /**
   * For person_composite: the Google Image Search query.
   * Must be specific: "Sam Altman CEO OpenAI photo transparent PNG cutout"
   */
  personSearchQuery?: string;

  /**
   * For person_composite: where to place the person on the 1080×1350 canvas.
   */
  personPlacement?: "center" | "left" | "right";

  /**
   * For the COVER SLIDE (index 0) only: which of the 8 cover templates to use.
   * Determines the layout schema for compositing figures, logos, and background.
   * Content slides (index 1+) do not use this field.
   */
  coverTemplate?: CoverTemplate;

  /**
   * For cover templates that require multiple people (council_of_players, duo_reaction,
   * backs_to_the_storm): additional person search queries beyond the primary one.
   * Array of up to 3 additional person search queries.
   */
  additionalPersonQueries?: string[];

  /**
   * For cover templates that require multiple logos (left_column_logos, backs_to_the_storm,
   * council_of_players): logo keys beyond the primary logoKeys (which is already max 2).
   * Combined with logoKeys for a total of up to 4 logos.
   */
  additionalLogoKeys?: string[];

  /**
   * For screenshot_overlay template: a description of what the screenshot should show.
   * Used to generate or source the product screenshot image.
   */
  screenshotDescription?: string;

  /**
   * Predicted engagement score (0-10) for this visual strategy.
   * Higher = more likely to drive DM shares and saves.
   */
  engagementScore?: number;

  // ─── SuggestedByGPT 2.0: Rich composition fields ────────────────────────

  /**
   * For cover slide (index 0) with freeform_composition template:
   * Rich multi-element composition manifest describing background, people, and logos separately.
   */
  coverComposition?: {
    /** Background scene prompt — generated SEPARATELY via DALL-E 3, must contain NO PEOPLE */
    backgroundPrompt: string;
    /** People to composite into the scene (each generated individually via Nano Banana (Gemini)) */
    subjects: Array<{
      name: string;               // "Sam Altman"
      role: string;               // "CEO of OpenAI"
      expression: string;         // "intense, determined gaze"
      placement: "center" | "left" | "right" | "background-left" | "background-right";
      scale: "dominant" | "supporting" | "background";
      /** Full Nano Banana (Gemini) prompt for this person — must be cinematic, editorial quality */
      promptFragment: string;
    }>;
    /** Per-logo placement and sizing instructions */
    logoTreatment: Array<{
      logoKey: string;
      size: "small" | "medium" | "large";  // 80px / 140px / 200px
      placement: string;                    // "top-right", "bottom-center", "above-text-left", etc.
    }>;
    /** single_shot = 1-2 people in one Nano Banana (Gemini) call (more cohesive). multi_layer = generate each person separately and composite (for 3+ people). */
    compositionMode: "single_shot" | "multi_layer";
    /** Text description of the overall composition for logging/debugging */
    compositionDescription: string;
  };

  /**
   * For video slides (kling_video): story-driven narrative with beginning/middle/end.
   * Connected to the headline's actual story — NOT a generic environment description.
   */
  videoNarrative?: {
    beginning: string;     // "A young professional opens a laptop..."
    middle: string;        // "Results stream in, eyes widen..."
    end: string;           // "They lean back with a satisfied smile"
    /** Complete assembled prompt for the video generation API */
    fullPrompt: string;
  };

  /**
   * Per-slide logo rendering style override.
   * full_color = large, brand-colored, with drop shadow (company IS the story)
   * badge = traditional dark circle badge (subtle context)
   * none = no logos on this slide
   */
  logoStyle?: "full_color" | "badge" | "none";
  /** Logo size in pixels (80-200). Used when logoStyle is full_color or badge. */
  logoSize?: number;
}

/** Full creative brief for an entire carousel */
export interface CarouselCreativeBrief {
  runId: number;
  slides: SlideCreativeBrief[];
  /** Global style note for visual cohesion across all slides */
  globalStyleNotes: string;
}

// ─── Known Public Figures ────────────────────────────────────────────────────
// The Creative Director can only use person_composite for people on this list.
// This prevents hallucination (searching for obscure researchers with no photos).

const KNOWN_FIGURES: Record<string, string> = {
  // AI / Tech CEOs (core)
  "sam altman": "CEO of OpenAI",
  "sundar pichai": "CEO of Google / Alphabet",
  "elon musk": "CEO of Tesla, SpaceX, xAI",
  "mark zuckerberg": "CEO of Meta",
  "tim cook": "CEO of Apple",
  "satya nadella": "CEO of Microsoft",
  "dario amodei": "CEO of Anthropic",
  "daniela amodei": "President of Anthropic",
  "jensen huang": "CEO of NVIDIA",
  "demis hassabis": "CEO of Google DeepMind",
  "yann lecun": "Chief AI Scientist at Meta",
  "ilya sutskever": "Co-founder of Safe Superintelligence",
  "mira murati": "Former CTO of OpenAI",
  "jeff bezos": "Founder of Amazon",
  "bill gates": "Co-founder of Microsoft",
  "lisa su": "CEO of AMD",
  "arvind krishna": "CEO of IBM",
  "alex karp": "CEO of Palantir",
  "andy jassy": "CEO of Amazon",
  "greg brockman": "Co-founder of OpenAI",
  "mustafa suleyman": "CEO of Microsoft AI",
  "arthur mensch": "CEO of Mistral AI",
  "aravind srinivas": "CEO of Perplexity AI",
  "emad mostaque": "Founder of Stability AI",
  "robin li": "CEO of Baidu",
  "liang wenfeng": "CEO of DeepSeek",
  // Social / Tech founders
  "jack dorsey": "Co-founder of Twitter/Square",
  "susan wojcicki": "Former CEO of YouTube",
  "evan spiegel": "CEO of Snap",
  "reed hastings": "Co-founder of Netflix",
  "brian chesky": "CEO of Airbnb",
  "patrick collison": "CEO of Stripe",
  "john collison": "Co-founder of Stripe",
  // Global tech leaders
  "lei jun": "CEO of Xiaomi",
  "pony ma": "CEO of Tencent",
  "zhang yiming": "Founder of ByteDance",
  "jack ma": "Founder of Alibaba",
  "masayoshi son": "CEO of SoftBank",
  // Political (tech regulation context)
  "donald trump": "President of the United States",
  "joe biden": "Former President of the United States",
  // AI researchers / notable
  "andrej karpathy": "AI researcher, former Tesla/OpenAI",
  "fei-fei li": "Stanford AI Lab, former Google VP",
  "geoffrey hinton": "AI pioneer, Turing Award winner",
  "yoshua bengio": "AI pioneer, Turing Award winner",
  "andrew ng": "AI researcher, founder of DeepLearning.AI",
};

// ─── Company → CEO Inference ─────────────────────────────────────────────────
// When a topic mentions a company name (e.g. "OpenAI") but not the CEO by name,
// we infer the CEO so the Creative Director can consider person_composite.
// This is what was missing — topics saying "OpenAI" never triggered person_composite
// because detectKnownPeople only looked for "Sam Altman" literally.

const COMPANY_TO_CEO: Record<string, string> = {
  openai: "sam altman",
  "open ai": "sam altman",
  chatgpt: "sam altman",
  "gpt-5": "sam altman",
  google: "sundar pichai",
  alphabet: "sundar pichai",
  deepmind: "demis hassabis",
  "google deepmind": "demis hassabis",
  meta: "mark zuckerberg",
  facebook: "mark zuckerberg",
  whatsapp: "mark zuckerberg",
  instagram: "mark zuckerberg",
  apple: "tim cook",
  microsoft: "satya nadella",
  anthropic: "dario amodei",
  claude: "dario amodei",
  nvidia: "jensen huang",
  tesla: "elon musk",
  spacex: "elon musk",
  xai: "elon musk",
  grok: "elon musk",
  amazon: "andy jassy",
  aws: "andy jassy",
  ibm: "arvind krishna",
  palantir: "alex karp",
  amd: "lisa su",
  mistral: "arthur mensch",
  "mistral ai": "arthur mensch",
  perplexity: "aravind srinivas",
  "perplexity ai": "aravind srinivas",
  "stability ai": "emad mostaque",
  baidu: "robin li",
  deepseek: "liang wenfeng",
  twitter: "jack dorsey",
  snap: "evan spiegel",
  snapchat: "evan spiegel",
  youtube: "susan wojcicki",
  xiaomi: "lei jun",
  tencent: "pony ma",
  bytedance: "zhang yiming",
  tiktok: "zhang yiming",
  alibaba: "jack ma",
  softbank: "masayoshi son",
  stripe: "patrick collison",
  netflix: "reed hastings",
  airbnb: "brian chesky",
};

/**
 * Check if a match at position `pos` in `text` sits at a word boundary.
 * Prevents "meta" from matching inside "metadata", "su" from matching inside "results", etc.
 * A word boundary means the character before and after the match is non-alphanumeric
 * (or it's the start/end of the string).
 */
function isWordBoundary(text: string, pos: number, matchLen: number): boolean {
  const before = pos > 0 ? text[pos - 1] : " ";
  const after = pos + matchLen < text.length ? text[pos + matchLen] : " ";
  return !/[a-z0-9]/i.test(before) && !/[a-z0-9]/i.test(after);
}

/** Scan text for known public figures and return matches.
 *  Now also infers CEOs from company name mentions (e.g. "OpenAI" → Sam Altman)
 *  so the Creative Director can consider person_composite even when the topic
 *  doesn't name the person explicitly.
 */
export function detectKnownPeople(text: string): Array<{ name: string; title: string }> {
  const lower = text.toLowerCase();
  const found: Array<{ name: string; title: string; pos: number }> = [];
  const foundNames = new Set<string>();

  // 1. Direct full-name matches (highest confidence — multi-word, very specific)
  for (const [name, title] of Object.entries(KNOWN_FIGURES)) {
    const pos = lower.indexOf(name);
    if (pos >= 0 && !foundNames.has(name)) {
      foundNames.add(name);
      found.push({ name, title, pos });
    }
  }

  // 2. Last-name-only matches for very famous figures
  // IMPORTANT: Word boundary check prevents "huang" matching inside "huangshan",
  // "cook" inside "cookie", etc. Short names (≤3 chars like "su", "li") are excluded
  // entirely — too many false positives even with boundaries.
  const LAST_NAME_MAP: Record<string, string> = {
    altman: "sam altman",
    pichai: "sundar pichai",
    zuckerberg: "mark zuckerberg",
    nadella: "satya nadella",
    amodei: "dario amodei",
    huang: "jensen huang",
    hassabis: "demis hassabis",
    lecun: "yann lecun",
    sutskever: "ilya sutskever",
    bezos: "jeff bezos",
    jassy: "andy jassy",
    cook: "tim cook",
    // "su" REMOVED — 2 chars matches inside "results", "issue", "visual", etc.
    // Lisa Su is still detected via full name "lisa su" or company "amd" → CEO inference.
  };

  for (const [lastName, fullName] of Object.entries(LAST_NAME_MAP)) {
    if (!foundNames.has(fullName)) {
      const pos = lower.indexOf(lastName);
      if (pos >= 0 && isWordBoundary(lower, pos, lastName.length)) {
        foundNames.add(fullName);
        found.push({
          name: fullName,
          title: KNOWN_FIGURES[fullName],
          pos,
        });
      }
    }
  }

  // 3. Company name → CEO inference (fixes the "OpenAI" → Sam Altman gap)
  // Only infer if the CEO wasn't already found by name/last-name above.
  // Sort COMPANY_TO_CEO keys longest-first so "google deepmind" matches before "google".
  // WORD BOUNDARY CHECK is critical here — prevents "meta" matching "metadata",
  // "aws" matching "laws", "amd" matching "commanded", etc.
  const companyKeys = Object.keys(COMPANY_TO_CEO).sort((a, b) => b.length - a.length);

  for (const company of companyKeys) {
    const ceoName = COMPANY_TO_CEO[company];
    if (foundNames.has(ceoName)) continue; // already found this person

    const pos = lower.indexOf(company);
    if (pos >= 0 && isWordBoundary(lower, pos, company.length)) {
      foundNames.add(ceoName);
      found.push({
        name: ceoName,
        title: KNOWN_FIGURES[ceoName] + " (inferred from company mention)",
        pos,
      });
      console.log(`[CreativeDirector] 🔍 Inferred person "${ceoName}" from company mention "${company}"`);
    }
  }

  found.sort((a, b) => a.pos - b.pos);
  return found.map(({ name, title }) => ({ name, title }));
}

// ─── The Creative Director System Prompt ─────────────────────────────────────

function buildSystemPrompt(availableLogos: string[]): string {
  return `You are the Creative Director for @suggestedbygpt, a fast-growing AI news Instagram page (style reference: @evolving.ai, 4M followers). You decide the VISUAL STRATEGY for each slide in a 5-slide carousel.

YOUR ROLE: Given researched AI news stories, decide for EACH slide which visual approach maximizes engagement. Your decisions are scored by predicted DM shares (the #1 Instagram algorithm signal) and saves (#2 signal).

═══ INSTAGRAM ALGORITHM INTELLIGENCE ═══

Signal weights (from 2026 algorithm research):
- DM Shares/Sends: ${ALGORITHM_SIGNAL_WEIGHTS.sends_per_reach.weight}x weight (STRONGEST)
- Saves/Bookmarks: ${ALGORITHM_SIGNAL_WEIGHTS.saves_per_reach.weight}x weight
- Quality Comments (>5 words): ${ALGORITHM_SIGNAL_WEIGHTS.comments_quality.weight}x weight
- Dwell Time (reading/swiping): ${ALGORITHM_SIGNAL_WEIGHTS.dwell_time.weight}x weight
- Likes: ${ALGORITHM_SIGNAL_WEIGHTS.likes_per_reach.weight}x weight (weakest)

Carousel facts:
- ${CAROUSEL_ENGAGEMENT_TACTICS.firstSlide}
- ${CAROUSEL_ENGAGEMENT_TACTICS.progression}
- ${CAROUSEL_ENGAGEMENT_TACTICS.independentValue}
- ${CAROUSEL_ENGAGEMENT_TACTICS.textDensity}
- Mixed-media carousels (images + video) get 2.33% engagement rate — highest of any format.

═══ YOUR 4 VISUAL STRATEGIES ═══

1. "cinematic_scene" — Pure AI-generated dramatic scene. NO logos, NO cutouts. The image itself IS the story through metaphor, symbolism, or literal depiction. The background is the star.
   WHEN: Abstract industry trends, dramatic moments, stories where no specific company is the main focus, or when the visual metaphor is stronger than any logo.
   ENGAGEMENT: High P(save) if visually stunning. High P(share) if emotionally resonant.
   EXAMPLE: "AI robots replace warehouse workers" → cinematic robot factory scene, no logos needed.

2. "scene_with_badge" — AI-generated dramatic scene + 1-2 small logo badges (80-100px circles) in the top-left corner. Scene is the hero; logos are contextual identifiers.
   WHEN: Company-specific news where you want the scene to tell the story AND identify the company.
   ENGAGEMENT: Moderate P(share). Good brand recognition. Can use dual badges for competition stories.
   EXAMPLE: "OpenAI releases new reasoning model" → dramatic AI scene in green tones + OpenAI badge.

3. "person_composite" — AI-generated photorealistic scene featuring a named public figure, rendered naturally IN the environment using Nano Banana (Gemini). The person IS the image — they should fill 60-80% of the frame. Their expression, pose, and body language match the story's emotional context.
   WHEN: Stories dominated by a specific well-known person (CEO, founder, executive). ONLY use for people on the known figures list. This is the HIGHEST IMPACT strategy for personality-driven stories.
   ENGAGEMENT: Very high P(share) — people share content about people they recognize. High P(dwell) — faces draw eyes.
   CONSTRAINT: ONLY use for these verified public figures: ${Object.entries(KNOWN_FIGURES).map(([n, t]) => `${n} (${t})`).join(", ")}
   CRITICAL — THE PERSON IS THE HERO OF THE IMAGE. Not the environment. The person fills the frame.
   SCENE PROMPT REQUIREMENTS — include ALL of these:
   • PERSON: Full name + signature appearance detail (e.g., "Sam Altman, CEO of OpenAI, wearing his signature dark grey crewneck" or "Jensen Huang, CEO of NVIDIA, in his trademark black leather jacket")
   • EXPRESSION/POSE: Match the story's emotional context — concerned/furrowed brow for bad news, triumphant/arms raised for victories, thoughtful/chin resting on hand for strategy, defiant/crossed arms for conflicts, smirking/confident for wins
   • FRAMING: The person should be chest-up or waist-up, filling most of the frame. NOT full body. NOT tiny in a vast scene.
   • LIGHTING: ALWAYS specify 2+ light sources with colors. E.g., "dramatic orange-cyan split lighting from opposing neon signs" or "cold blue rim light from behind, warm key light from above-left"
   • LENS: Always specify a lens. 85mm f/1.4 for intense portraits, 50mm f/2 for medium shots, 35mm f/2.8 for environmental portraits
   • COLOR GRADE: Always specify. "teal-and-orange", "cold blue steel", "warm golden hour", "high-contrast noir"
   • ENVIRONMENT: The environment should reinforce the story mood but stay BEHIND the person as atmosphere, NOT compete with them

   ❌ BAD PROMPT: "Sam Altman standing in a boardroom overlooking Silicon Valley at twilight, wearing a polo"
   ✅ GOOD PROMPT: "Sam Altman, CEO of OpenAI, standing at the edge of a rain-slicked rooftop at night, city lights reflecting in puddles around his feet, wearing a dark grey crewneck, arms crossed, expression halfway between a smirk and concern, dramatic orange-cyan split lighting from opposing neon signs below, shallow depth of field 85mm f/1.4, photorealistic editorial portrait, cinematic color grade"
   ✅ GOOD PROMPT: "Jensen Huang, CEO of NVIDIA, caught mid-gesture on the GTC stage, pointing emphatically at the audience, wearing his signature black leather jacket, massive LED wall behind him displaying swirling neural network visualizations in green and purple, dramatic stage spotlights with deep purple and green spots casting long shadows, wide-angle 24mm lens capturing the scale, photorealistic"
   ✅ GOOD PROMPT: "Tim Cook, CEO of Apple, sitting alone at the head of an impossibly long dark conference table, fingers steepled, looking directly at camera with quiet intensity, single overhead spotlight creating a pool of warm light in otherwise pitch darkness, reflection in the polished table surface, 85mm f/1.4 shallow depth of field, noir color grade, photorealistic"

4. "kling_video" — 5-second cinematic video clip (Seedance or Kling 2.5 Turbo). Video slides tell a STORY with beginning, middle, and end — NOT just a pretty environment.
   WHEN: The story has dramatic visual potential — action, confrontation, transformation, or spectacle.
   ENGAGEMENT: Highest P(dwell). Very high P(share) for dramatic clips. Instagram mixed-media carousels outperform.
   LIMIT: Assign to exactly 2 slides per carousel (expensive, slow, rate-limited).
   CRITICAL — STORY-DRIVEN VIDEO NARRATIVES:
   Every video prompt must describe a CHARACTER doing something with a clear beginning, middle, and end. The video connects to the headline's actual news story.
   • BEGINNING: Establish the character and setting (1-2 seconds)
   • MIDDLE: The key action or revelation happens (2-3 seconds)
   • END: The emotional payoff — a reaction, a consequence, a dramatic moment (1-2 seconds)
   • CAMERA: Must MOVE — slow push-in, orbit, dolly zoom, pull-back reveal. No static shots.

   ❌ BAD VIDEO PROMPT: "A glowing server room with blue neon lights and data flowing through cables"
   ❌ BAD VIDEO PROMPT: "A futuristic AI interface with holographic displays"
   ✅ GOOD VIDEO PROMPT: "A figure in a hoodie sits at a dual-monitor setup in a dark room, typing rapidly. The screens flash bright green — OpenAI's interface appears with streaming text. The figure leans back slowly, the screens' glow illuminating their amazed expression as a holographic interface begins expanding from the monitors into the room around them. Slow dolly zoom from over-the-shoulder to wide shot. Cyan and green lighting, volumetric haze."
   ✅ GOOD VIDEO PROMPT: "A CEO in a sharp suit walks down a long glass corridor in a tech headquarters, city skyline visible through the windows. They pause at the end, looking out at the city below. A massive holographic display activates beside them showing stock charts plunging downward. Their reflection in the glass shows concern. Slow tracking shot following from behind, transitioning to profile close-up. Cold blue-steel color grade, dramatic backlighting."

   You MUST fill the videoNarrative field for all kling_video slides:
   { "beginning": "...", "middle": "...", "end": "...", "fullPrompt": "the complete assembled narrative prompt" }

═══ PART B: COVER SLIDE (index 0) — MOVIE POSTER COMPOSITION ═══

The cover slide is 80% of the post's performance. Think like a MOVIE POSTER DESIGNER, not an AI image prompter.

Study these real examples of covers that get 5,000-10,000+ likes:
- @theaifield: Trump with glowing eyes CENTER, Sam Altman LEFT, another figure RIGHT, stormy Pentagon background, small contextual logos at bottom. Multiple people arranged dramatically like an ensemble movie poster.
- @evolving.ai: Two chrome robots standing in a desert with a nuclear explosion behind them. No people needed — the dramatic scene IS the hook. Small colorful logos in the lower corners.
- @airesearches: One person (Sam Altman) filling 70% of the frame in a medium shot, big colorful logos floating around him at various sizes.

KEY PRINCIPLE: Every cover must feel UNIQUE. Do NOT apply the same formula every time. The composition depends on THIS WEEK'S specific stories.

You have TWO approaches for covers:

APPROACH 1: "freeform_composition" (PREFERRED for multi-person or complex covers)
  Use when you want to compose multiple people, specific logo arrangements, or complex layered scenes.
  Set coverTemplate to "freeform_composition" and fill the coverComposition field:
  - backgroundPrompt: Dramatic environment with NO PEOPLE (generated separately via DALL-E 3)
  - subjects[]: Array of people, each with name, expression, placement, scale, and a Nano Banana (Gemini) prompt
  - logoTreatment[]: Array of logos with size (small/medium/large) and placement
  - compositionMode: "single_shot" (1-2 people, one image) or "multi_layer" (3+ people, composite)
  - compositionDescription: Text description of the overall vision

  COMPOSITION THINKING:
  - WHO is in this cover? Which people are the story?
  - WHERE does each person go? (center = dominant, sides = supporting, corners = background)
  - HOW BIG is each person? dominant = 70% height, supporting = 40%, background = 30%
  - WHAT LOGOS are relevant? Are they prominent (large, full-color) or contextual (small, subtle)?
  - WHAT BACKGROUND reinforces the story mood?

APPROACH 2: Legacy templates (for simpler covers)
  The 8 original templates still work as fallbacks:
  "council_of_players" — 1 main figure + 3-4 supporting + 2 logos (weekly roundups)
  "backs_to_the_storm" — 3 logos + dramatic bg (multi-company events)
  "solo_machine" — AI robot/machine, no logos (abstract AI stories)
  "person_floating_orbs" — 1 person + floating logo orbs (X vs everyone)
  "real_photo_corner_badges" — photo bg + 2 corner badges (events/partnerships)
  "left_column_logos" — 3 logos stacked left + AI bg (logo-heavy stories)
  "duo_reaction" — 2 people side by side + 2 logos (rivalries)
  "screenshot_overlay" — screenshot + dark vignette + YELLOW headline (product launches)

WHEN TO USE WHICH:
  - 2+ recognizable people → freeform_composition (multi_layer) + strategy "person_composite" — arrange them like a movie poster
  - 1 person + logos → freeform_composition (single_shot) + strategy "person_composite" — person IS the scene
  - No people, dramatic metaphor → solo_machine + strategy "cinematic_scene"
  - Product launch with UI → screenshot_overlay + strategy "cinematic_scene"
  - Pure logo story → backs_to_the_storm or left_column_logos + strategy "scene_with_badge"
  REMEMBER: freeform_composition with subjects[] REQUIRES strategy "person_composite". This is what makes the Nano Banana pipeline generate actual faces.

═══ LOGO STRATEGY ═══

Logos are NOT always dark circle badges. You decide per-slide how logos should appear:

logoStyle options:
- "full_color" — Large (140-200px), rendered in the brand's actual colors, with subtle drop shadow. Use when the COMPANY is central to the story.
- "badge" — Traditional small (80-100px) dark circular badge. Use for subtle context when the scene is the hero.
- "none" — No logos at all. Use when the visual speaks for itself (e.g., recognizable person needs no logo, or dramatic metaphor scene).

Set logoStyle and optionally logoSize (80-200) per slide.

═══ CRITICAL RULES ═══

STRATEGY PRIORITY — person_composite FIRST:
- People-centric content gets 3× more DM shares than abstract scenes (Instagram algorithm data).
- ALWAYS prefer person_composite when a known figure is detected in the story.
- For ANY story mentioning a specific CEO or public figure by name, person_composite should be your DEFAULT choice unless there's a compelling visual reason not to.
- scene_with_badge is your second choice — use it for company news that isn't about a person.
- cinematic_scene is your fallback — only when no specific company or person is central.
- Aim for 2-3 person_composite slides per carousel when the stories support it.

VARIETY IS MANDATORY:
- You MUST use at least 2 DIFFERENT strategies across the 5 slides.
- NEVER use the same strategy on every slide. That's boring repetition.
- Best mix: 1-2 person_composite + 1-2 scene_with_badge + 0-1 cinematic_scene + 2 kling_video.

COVER SLIDE (index 0) = 80% OF THE POST:
- The cover must be the single most scroll-stopping image in the carousel.
- ALWAYS set coverTemplate for slide 0. Choose the template that best fits the week's stories.
- STRATEGY RULE FOR COVERS:
  • If the cover has ANY people (freeform_composition with subjects, council_of_players, person_floating_orbs, duo_reaction): set strategy to "person_composite" and provide personSearchQuery.
  • If the cover is purely scenic with NO people (solo_machine, backs_to_the_storm, left_column_logos, screenshot_overlay, real_photo_corner_badges): set strategy to "cinematic_scene" or "scene_with_badge".
  • freeform_composition with subjects[] ALWAYS requires strategy "person_composite" — this is what triggers Nano Banana to generate recognizable faces.
- DEFAULT TO PEOPLE ON COVERS. Most weeks have at least 1-2 recognizable figures in the news. Put them on the cover. People-centric covers get 3× more engagement than abstract scenes.
- Only use cinematic_scene for the cover when NONE of the week's stories involve recognizable public figures.

VIDEO STRATEGY:
- Assign kling_video to exactly 2 slides (indices 1-4, NOT the cover).
- Choose the 2 stories with the MOST DYNAMIC visual potential for video.
- Video prompts MUST describe: camera movement type, action/motion, lighting changes, 5-second arc.

SCENE PROMPT QUALITY (PROMPTHIS Framework):
Every scenePrompt must follow this structure for maximum AI image quality:
1. SETTING: Specific location/environment (not "futuristic room" — say "a glass-walled boardroom overlooking a neon-lit Tokyo skyline at night")
2. CAMERA: Shot type + lens + angle ("extreme close-up, 85mm lens, low angle looking up")
3. SUBJECT: The main visual element in specific detail ("a pair of hands hovering over a glowing green holographic interface")
4. LIGHTING: Specific light sources + quality ("dramatic side-lit by a single cyan neon strip, deep shadows on the right")
5. MOOD: Color palette + emotional tone ("cold blue-green palette, tension, corporate thriller feel")

🚫 BANNED SCENES — NEVER use these overused visuals:
- Server rooms, data centers, server racks (WE HAVE USED THESE 6 TIMES IN A ROW)
- Generic glowing circuits or motherboards
- Abstract floating data/code streams
- Faceless silhouettes in front of screens
- Plain office/boardroom interiors
Instead use: outdoor cityscapes, rooftops at night, stages/arenas, desert landscapes, underwater labs, space stations, neon-lit streets, mountain peaks, glass skyscrapers from dramatic angles, or any SPECIFIC setting that connects to the actual news story

${MARKETING_BRAIN_ENHANCEMENT}

═══ AVAILABLE LOGOS ═══
These company keys have curated transparent PNG logos available: ${availableLogos.join(", ")}

═══ OUTPUT FORMAT ═══
Return valid JSON matching this exact schema:
{
  "globalStyleNotes": "1-2 sentences about visual cohesion for this carousel",
  "slides": [
    {
      "slideIndex": 0,
      "strategy": "cinematic_scene" | "person_composite",
      "coverTemplate": "freeform_composition" | "council_of_players" | "backs_to_the_storm" | "solo_machine" | "person_floating_orbs" | "real_photo_corner_badges" | "left_column_logos" | "duo_reaction" | "screenshot_overlay",
      "reasoning": "Why this composition for this specific cover (1-2 sentences)",
      "scenePrompt": "Fallback scene prompt if coverComposition is not used",
      "coverComposition": {
        "backgroundPrompt": "Dramatic environment with NO PEOPLE — used as the background layer",
        "subjects": [
          {
            "name": "Sam Altman",
            "role": "CEO of OpenAI",
            "expression": "intense, determined gaze, slight smirk",
            "placement": "center",
            "scale": "dominant",
            "promptFragment": "Sam Altman, CEO of OpenAI, wearing a dark grey crewneck, arms crossed, expression halfway between a smirk and concern, dramatic orange-cyan split lighting, shallow depth of field 85mm f/1.4, photorealistic editorial portrait, dark moody background"
          }
        ],
        "logoTreatment": [
          { "logoKey": "openai", "size": "medium", "placement": "top-right" }
        ],
        "compositionMode": "single_shot" | "multi_layer",
        "compositionDescription": "Movie-poster style with Altman as dominant center figure..."
      },
      "logoKeys": ["openai", "anthropic"],
      "additionalLogoKeys": ["google"],
      "logoStyle": "full_color" | "badge" | "none",
      "logoSize": 140,
      "personSearchQuery": "Full Name Title Company photo portrait" (if legacy person-based template),
      "additionalPersonQueries": ["Person 2 Name Title photo portrait"],
      "personPlacement": "center" | "left" | "right",
      "screenshotDescription": "..." (only for screenshot_overlay),
      "engagementScore": 8.5
    },
    {
      "slideIndex": 1,
      "strategy": "cinematic_scene" | "scene_with_badge" | "person_composite" | "kling_video",
      "reasoning": "Why this strategy (1-2 sentences)",
      "scenePrompt": "PROMPTHIS scene description (person-first for person_composite, environment for cinematic_scene)",
      "logoKeys": ["openai"],
      "logoStyle": "full_color" | "badge" | "none",
      "logoSize": 140,
      "personSearchQuery": "Full Name Title Company photo portrait" (only if person_composite),
      "personPlacement": "center" | "left" | "right",
      "videoNarrative": {
        "beginning": "A person opens their laptop...",
        "middle": "Results stream in, eyes widen...",
        "end": "They lean back with a satisfied smile",
        "fullPrompt": "Complete assembled video narrative prompt"
      },
      "engagementScore": 7.5
    }
  ]
}`;
}

// ─── Shared Brief Sanitization ──────────────────────────────────────────────
// Used by BOTH the Creative Director (initial output) AND the Quality Director
// (revised output). Ensures every brief meets structural/data constraints before
// it reaches Stage 5 (Media Generation).

/** Raw slide shape coming from either CD or QD LLM calls */
interface RawSlideInput {
  slideIndex: number;
  strategy: string;
  coverTemplate?: string;
  reasoning?: string;
  scenePrompt?: string;
  logoKeys?: string[];
  additionalLogoKeys?: string[];
  personSearchQuery?: string;
  additionalPersonQueries?: string[];
  personPlacement?: string;
  screenshotDescription?: string;
  engagementScore?: number;
  coverComposition?: any;
  videoNarrative?: any;
  logoStyle?: string;
  logoSize?: number;
}

interface TopicAnalysisInput {
  index: number;
  slideIndex: number;
  headline: string;
  summary: string;
  detectedLogos: string[];
  detectedPeople: Array<{ name: string; title: string }>;
}

const VALID_STRATEGIES = new Set<VisualStrategy>([
  "cinematic_scene", "scene_with_badge", "person_composite", "kling_video",
]);
const VALID_COVER_TEMPLATES = new Set<CoverTemplate>([
  "council_of_players", "backs_to_the_storm", "solo_machine", "person_floating_orbs",
  "real_photo_corner_badges", "left_column_logos", "duo_reaction", "screenshot_overlay",
  "freeform_composition",
]);

function sanitizeSlides(
  rawSlides: RawSlideInput[],
  topicAnalysis: TopicAnalysisInput[],
  researched: ResearchedTopicInput[],
  callerLabel: string,
): SlideCreativeBrief[] {
  const sanitizedSlides: SlideCreativeBrief[] = rawSlides.map((s) => {
    let strategy = s.strategy as VisualStrategy;

    // Validate strategy name
    if (!VALID_STRATEGIES.has(strategy)) {
      console.warn(`[${callerLabel}] Invalid strategy "${s.strategy}" for slide ${s.slideIndex} — falling back to cinematic_scene`);
      strategy = "cinematic_scene";
    }

    // Validate coverTemplate for cover slide
    let coverTemplate: CoverTemplate | undefined;
    if (s.slideIndex === 0) {
      if (s.coverTemplate && VALID_COVER_TEMPLATES.has(s.coverTemplate as CoverTemplate)) {
        coverTemplate = s.coverTemplate as CoverTemplate;
      } else {
        coverTemplate = strategy === "person_composite" ? "freeform_composition" : "solo_machine";
        console.warn(`[${callerLabel}] Slide 0: missing/invalid coverTemplate "${s.coverTemplate}" — defaulting to ${coverTemplate}`);
      }

      // ── AUTO-UPGRADE: freeform_composition with subjects MUST use person_composite ──
      // This is the critical safety net: the LLM may pair freeform_composition with
      // cinematic_scene (which bypasses the Nano Banana pipeline entirely, producing
      // generic cityscapes instead of movie-poster people compositions).
      // If the LLM provided subjects[], the intent is clearly people-on-cover.
      const hasSubjects = s.coverComposition?.subjects?.length > 0;
      const isPersonTemplate = ["freeform_composition", "council_of_players", "person_floating_orbs", "duo_reaction"].includes(coverTemplate);
      if (isPersonTemplate && hasSubjects && strategy !== "person_composite") {
        console.warn(`[${callerLabel}] Slide 0: ⚠️ AUTO-UPGRADE: ${coverTemplate} has ${s.coverComposition.subjects.length} subjects but strategy was "${strategy}" — upgrading to person_composite`);
        strategy = "person_composite";
        // Ensure we have a personSearchQuery for the primary subject
        if (!s.personSearchQuery && s.coverComposition.subjects[0]?.name) {
          s.personSearchQuery = `${s.coverComposition.subjects[0].name} portrait photo`;
        }
      }

      // ── AUTO-UPGRADE: Cover with known people should use person_composite ──
      // Even if the LLM didn't pick freeform_composition, if the headlines mention
      // known figures, upgrade to person_composite + freeform_composition.
      if (strategy !== "person_composite" && !hasSubjects) {
        const allHeadlines = researched.map(t => t.headline).join(" ");
        const coverPeople = detectKnownPeople(allHeadlines);
        if (coverPeople.length > 0) {
          console.warn(`[${callerLabel}] Slide 0: ⚠️ AUTO-UPGRADE: headlines mention ${coverPeople.map(p => p.name).join(", ")} but strategy was "${strategy}" — upgrading to person_composite + freeform_composition`);
          strategy = "person_composite";
          coverTemplate = "freeform_composition";
          // Build a personSearchQuery from the first detected person
          if (!s.personSearchQuery) {
            s.personSearchQuery = `${coverPeople[0].name} portrait photo`;
          }
        }
      }

      console.log(`[${callerLabel}] Cover template: ${coverTemplate} (strategy: ${strategy})`);
    }

    // Validate person_composite: prefer known figures, but allow if LLM provided a search query
    if (strategy === "person_composite") {
      const topicIdx = s.slideIndex === 0 ? -1 : s.slideIndex - 1;
      const analysis = topicIdx >= 0 ? topicAnalysis[topicIdx] : null;
      const allText = analysis
        ? `${analysis.headline} ${analysis.summary}`
        : researched.map(t => t.headline).join(" ");
      const knownPeople = detectKnownPeople(allText);

      if (knownPeople.length === 0) {
        if (s.personSearchQuery && s.personSearchQuery.trim().length > 10) {
          console.warn(`[${callerLabel}] Slide ${s.slideIndex}: person_composite for non-verified figure — allowing (LLM query: "${s.personSearchQuery?.slice(0, 50)}")`);
        } else {
          console.warn(`[${callerLabel}] Slide ${s.slideIndex}: person_composite requested but no known figures and no search query — downgrading to scene_with_badge`);
          strategy = "scene_with_badge";
          if (s.slideIndex === 0 && coverTemplate && ["council_of_players", "person_floating_orbs", "duo_reaction", "freeform_composition"].includes(coverTemplate)) {
            coverTemplate = "backs_to_the_storm";
          }
        }
      }
    }

    // Validate logoKeys: only allow keys that exist in LOGO_LIBRARY
    let logoKeys = s.logoKeys?.filter(k => k in LOGO_LIBRARY).slice(0, 2);
    let additionalLogoKeys = s.additionalLogoKeys?.filter(k => k in LOGO_LIBRARY).slice(0, 2);
    if (strategy === "scene_with_badge" && (!logoKeys || logoKeys.length === 0)) {
      const topicIdx = s.slideIndex === 0 ? -1 : s.slideIndex - 1;
      if (topicIdx >= 0 && topicAnalysis[topicIdx]?.detectedLogos.length > 0) {
        logoKeys = topicAnalysis[topicIdx].detectedLogos.slice(0, 2);
      } else {
        console.warn(`[${callerLabel}] Slide ${s.slideIndex}: scene_with_badge but no valid logos — downgrading to cinematic_scene`);
        strategy = "cinematic_scene";
      }
    }

    // For cover templates that need logos but none provided, try auto-detect
    if (s.slideIndex === 0 && coverTemplate && !(["solo_machine"].includes(coverTemplate))) {
      if (!logoKeys || logoKeys.length === 0) {
        const uniqueLogos = Array.from(new Set(topicAnalysis.flatMap(ta => ta.detectedLogos))).slice(0, 3);
        if (uniqueLogos.length > 0) {
          logoKeys = uniqueLogos.slice(0, 2);
          additionalLogoKeys = uniqueLogos.slice(2);
          console.log(`[${callerLabel}] Cover: auto-detected logos for template ${coverTemplate}: ${uniqueLogos.join(", ")}`);
        }
      }
    }

    // Validate personPlacement
    const validPlacements = new Set(["center", "left", "right"]);
    const personPlacement = validPlacements.has(s.personPlacement ?? "")
      ? (s.personPlacement as "center" | "left" | "right")
      : "center";

    // Validate additionalPersonQueries
    const additionalPersonQueries = Array.isArray(s.additionalPersonQueries)
      ? s.additionalPersonQueries.filter(q => typeof q === "string" && q.length > 0).slice(0, 3)
      : undefined;

    // Auto-detect logos for ALL content slides (not just scene_with_badge)
    if (s.slideIndex !== 0 && (!logoKeys || logoKeys.length === 0)) {
      const topicIdx = s.slideIndex - 1;
      if (topicIdx >= 0 && topicAnalysis[topicIdx]?.detectedLogos.length > 0) {
        logoKeys = topicAnalysis[topicIdx].detectedLogos.slice(0, 2);
        console.log(`[${callerLabel}] Slide ${s.slideIndex}: auto-detected logos for ${strategy}: ${logoKeys.join(", ")}`);
      }
    }

    // ── Parse 2.0 fields ──
    let coverComposition: SlideCreativeBrief["coverComposition"];
    if (s.slideIndex === 0 && coverTemplate === "freeform_composition" && s.coverComposition) {
      const cc = s.coverComposition;
      coverComposition = {
        backgroundPrompt: cc.backgroundPrompt ?? "Dark dramatic cinematic environment, neon lighting, no people, vertical 9:16",
        subjects: Array.isArray(cc.subjects) ? cc.subjects.map((sub: any) => ({
          name: sub.name ?? "Unknown",
          role: sub.role ?? "",
          expression: sub.expression ?? "neutral",
          placement: ["center", "left", "right", "background-left", "background-right"].includes(sub.placement) ? sub.placement : "center",
          scale: ["dominant", "supporting", "background"].includes(sub.scale) ? sub.scale : "supporting",
          promptFragment: sub.promptFragment ?? `${sub.name ?? "A person"}, photorealistic editorial portrait, dramatic lighting, 85mm f/1.4`,
        })) : [],
        logoTreatment: Array.isArray(cc.logoTreatment) ? cc.logoTreatment.filter((lt: any) => lt.logoKey && lt.logoKey in LOGO_LIBRARY).map((lt: any) => ({
          logoKey: lt.logoKey,
          size: ["small", "medium", "large"].includes(lt.size) ? lt.size : "medium",
          placement: lt.placement ?? "top-right",
        })) : [],
        compositionMode: cc.compositionMode === "multi_layer" ? "multi_layer" : "single_shot",
        compositionDescription: cc.compositionDescription ?? "Freeform composition",
      };
      console.log(`[${callerLabel}] Cover: freeform_composition with ${coverComposition.subjects.length} subjects, ${coverComposition.logoTreatment.length} logos, mode=${coverComposition.compositionMode}`);
    }

    let videoNarrative: SlideCreativeBrief["videoNarrative"];
    if (strategy === "kling_video" && s.videoNarrative) {
      const vn = s.videoNarrative;
      videoNarrative = {
        beginning: vn.beginning ?? "",
        middle: vn.middle ?? "",
        end: vn.end ?? "",
        fullPrompt: vn.fullPrompt ?? `${vn.beginning ?? ""} ${vn.middle ?? ""} ${vn.end ?? ""}`.trim(),
      };
    }

    const validLogoStyles = ["full_color", "badge", "none"] as const;
    const logoStyle = validLogoStyles.includes(s.logoStyle as any) ? s.logoStyle as "full_color" | "badge" | "none" : undefined;
    const logoSize = typeof s.logoSize === "number" && s.logoSize >= 80 && s.logoSize <= 200
      ? s.logoSize : undefined;

    return {
      slideIndex: s.slideIndex,
      strategy,
      coverTemplate,
      reasoning: s.reasoning ?? "No reasoning provided",
      scenePrompt: s.scenePrompt ?? "",
      logoKeys: logoKeys?.length ? logoKeys : undefined,
      additionalLogoKeys: s.slideIndex === 0 ? (additionalLogoKeys?.length ? additionalLogoKeys : undefined) : undefined,
      personSearchQuery: (strategy === "person_composite" || s.slideIndex === 0) ? s.personSearchQuery : undefined,
      additionalPersonQueries: s.slideIndex === 0 ? additionalPersonQueries : undefined,
      personPlacement: strategy === "person_composite" ? personPlacement : undefined,
      screenshotDescription: s.slideIndex === 0 && coverTemplate === "screenshot_overlay" ? s.screenshotDescription : undefined,
      engagementScore: typeof s.engagementScore === "number" ? s.engagementScore : undefined,
      coverComposition,
      videoNarrative,
      logoStyle,
      logoSize,
    };
  });

  // ── Ensure correct slide count: must have cover (0) + one per topic (1..N) ──
  const expectedCount = researched.length + 1;
  const existingIndices = new Set(sanitizedSlides.map(s => s.slideIndex));

  for (let idx = 0; idx < expectedCount; idx++) {
    if (!existingIndices.has(idx)) {
      console.warn(`[${callerLabel}] LLM omitted slide ${idx} — adding cinematic_scene default`);
      const topicIdx = idx === 0 ? 0 : idx - 1;
      sanitizedSlides.push({
        slideIndex: idx,
        strategy: "cinematic_scene",
        coverTemplate: idx === 0 ? "solo_machine" : undefined,
        reasoning: "Auto-filled — LLM omitted this slide",
        scenePrompt: idx === 0
          ? researched.map(t => t.headline).join(". ") + ". Dramatic cinematic AI scene, vertical 9:16, no text."
          : researched[topicIdx]?.videoPrompt ?? "Dramatic cinematic AI technology scene, neon lighting, vertical 9:16",
        engagementScore: 5,
      });
    }
  }

  // Remove excess slides / deduplicate
  if (sanitizedSlides.length > expectedCount) {
    console.warn(`[${callerLabel}] ${sanitizedSlides.length} slides, expected ${expectedCount} — trimming`);
    const validSlides = sanitizedSlides.filter(s => s.slideIndex >= 0 && s.slideIndex < expectedCount);
    const seen = new Set<number>();
    sanitizedSlides.length = 0;
    for (const s of validSlides) {
      if (!seen.has(s.slideIndex)) {
        seen.add(s.slideIndex);
        sanitizedSlides.push(s);
      }
    }
  }

  sanitizedSlides.sort((a, b) => a.slideIndex - b.slideIndex);

  // ── Ensure variety: at least 2 different strategies ──
  const uniqueStrategies = new Set(sanitizedSlides.map(s => s.strategy));
  if (uniqueStrategies.size < 2 && sanitizedSlides.length >= 3) {
    console.warn(`[${callerLabel}] Only ${uniqueStrategies.size} unique strategy — forcing variety`);
    const sorted = [...sanitizedSlides].sort(
      (a, b) => (a.engagementScore ?? 5) - (b.engagementScore ?? 5)
    );
    const weakest = sorted[0];
    if (weakest.strategy !== "cinematic_scene") {
      weakest.strategy = "cinematic_scene";
      weakest.logoKeys = undefined;
    } else {
      weakest.strategy = "scene_with_badge";
      const topicIdx = weakest.slideIndex === 0 ? 0 : weakest.slideIndex - 1;
      const logos = topicAnalysis[topicIdx]?.detectedLogos;
      if (logos && logos.length > 0) {
        weakest.logoKeys = logos.slice(0, 2);
      } else {
        weakest.strategy = "cinematic_scene";
      }
    }
  }

  // ── Ensure video count: exactly 2 video slides ──
  const videoSlides = sanitizedSlides.filter(s => s.strategy === "kling_video");
  if (videoSlides.length < 2) {
    const nonVideoContent = sanitizedSlides
      .filter(s => s.slideIndex > 0 && s.strategy !== "kling_video")
      .sort((a, b) => (b.engagementScore ?? 5) - (a.engagementScore ?? 5));
    const needed = 2 - videoSlides.length;
    for (let i = 0; i < Math.min(needed, nonVideoContent.length); i++) {
      const slide = nonVideoContent[i];
      console.log(`[${callerLabel}] Upgrading slide ${slide.slideIndex} to kling_video (enforcing min 2 videos)`);
      slide.strategy = "kling_video";
      slide.logoKeys = undefined;
      slide.personSearchQuery = undefined;
    }
  } else if (videoSlides.length > 2) {
    const toDowngrade = videoSlides.slice(2);
    for (const slide of toDowngrade) {
      console.log(`[${callerLabel}] Too many video slides — downgrading slide ${slide.slideIndex} to cinematic_scene`);
      slide.strategy = "cinematic_scene";
    }
  }

  return sanitizedSlides;
}

// ─── The Creative Director Agent ─────────────────────────────────────────────

export interface ResearchedTopicInput {
  title: string;
  headline: string;
  summary: string;
  insightLine?: string;
  videoPrompt: string;
  citations: Array<{ source: string; url: string }>;
}

/**
 * The main Creative Director function.
 *
 * Takes researched topics and produces a creative brief for each slide,
 * deciding the visual strategy, scene prompts, and asset requirements.
 *
 * Called between Stage 4 (Research) and Stage 5 (Media Generation).
 */
export async function creativeDirectorAgent(
  researched: ResearchedTopicInput[],
  runId: number,
): Promise<CarouselCreativeBrief> {
  console.log(`\n[CreativeDirector] ═══ Starting Creative Direction for run #${runId} ═══`);
  console.log(`[CreativeDirector] ${researched.length} topics to direct`);

  // ── Pre-analysis: detect logos and people in each topic ──
  const availableLogos = Object.keys(LOGO_LIBRARY);
  const topicAnalysis = researched.map((topic, i) => {
    const fullText = `${topic.headline} ${topic.summary} ${topic.title}`;
    const logos = findAllLogosForText(fullText);
    const people = detectKnownPeople(fullText);

    console.log(`[CreativeDirector] Topic ${i}: "${topic.headline.slice(0, 60)}..." | logos: [${logos.map(l => l.key).join(",")}] | people: [${people.map(p => p.name).join(",")}]`);

    return {
      index: i,
      slideIndex: i + 1, // 0 is cover
      headline: topic.headline,
      summary: topic.summary,
      researchSnippet: topic.videoPrompt.slice(0, 300),
      detectedLogos: logos.map(l => l.key),
      detectedPeople: people,
    };
  });

  // ── Build the user prompt with all context ──
  const coverContext = researched.map(t => `• ${t.headline}`).join("\n");

  const slideDetails = topicAnalysis.map(ta => {
    const logoStr = ta.detectedLogos.length > 0
      ? `Logos available: ${ta.detectedLogos.join(", ")}`
      : "No logos detected";
    const peopleStr = ta.detectedPeople.length > 0
      ? `People mentioned: ${ta.detectedPeople.map(p => `${p.name} (${p.title})`).join(", ")}`
      : "No known public figures detected";
    return `Slide ${ta.slideIndex}:
  Headline: ${ta.headline}
  Summary: ${ta.summary}
  ${logoStr}
  ${peopleStr}`;
  }).join("\n\n");

  // Collect all detected logos and people across all topics for cover context
  const allDetectedLogos = Array.from(new Set(topicAnalysis.flatMap(ta => ta.detectedLogos)));
  const allDetectedPeople = topicAnalysis.flatMap(ta => ta.detectedPeople).map(p => `${p.name} (${p.title})`);

  const userPrompt = `Decide the visual strategy for each slide in this AI news carousel.

COVER SLIDE (index 0) — must synthesize this week's stories into ONE attention-grabbing visual:
${coverContext}

All logos available across all stories: ${allDetectedLogos.length > 0 ? allDetectedLogos.join(", ") : "none"}
All people mentioned across all stories: ${allDetectedPeople.length > 0 ? allDetectedPeople.join(", ") : "none"}

For the cover, choose the BEST template from the 8 options in the system prompt. Set both "strategy" and "coverTemplate" for slide 0.

CONTENT SLIDES (indices 1-${researched.length}):

${slideDetails}

Remember:
- Slide 0 (cover) carries 80% of the post's weight — maximum visual impact
- ALWAYS set coverTemplate for slide 0
- Use at least 2 different strategies across all 5 slides
- Assign kling_video to exactly 2 content slides (NOT the cover)
- person_composite ONLY for verified public figures listed in the system prompt
- DALL-E 3 is ONLY for cinematic_scene (environments/metaphors with ZERO people). ANY slide with a person MUST use person_composite → Nano Banana (Gemini).
- Every scenePrompt must follow PROMPTHIS structure (Setting → Camera → Subject → Lighting → Mood)
- Scene prompts must contain ZERO text — no letters, words, numbers, or readable characters
- For freeform_composition covers: fill the coverComposition field with backgroundPrompt, subjects, logoTreatment, compositionMode
- For kling_video slides: fill the videoNarrative field with beginning, middle, end, fullPrompt
- Set logoStyle per slide: "full_color", "badge", or "none"
- For legacy cover templates needing 3+ logos, use additionalLogoKeys for the 3rd logo
- For legacy cover templates needing 2+ people, use additionalPersonQueries for the 2nd and 3rd people

Return ONLY the JSON object. No explanation, no preamble.`;

  // ── Call the LLM ──
  console.log(`[CreativeDirector] Calling LLM for creative brief...`);
  const startMs = Date.now();

  let brief: CarouselCreativeBrief;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: buildSystemPrompt(availableLogos) },
        { role: "user", content: userPrompt },
      ],
      responseFormat: { type: "json_object" },
      maxTokens: 4096,
    });

    const raw = response?.choices?.[0]?.message?.content;
    const text = typeof raw === "string" ? raw.trim() : "";

    if (!text) {
      throw new Error("Empty response from LLM");
    }

    const parsed = JSON.parse(text) as {
      globalStyleNotes?: string;
      slides?: Array<{
        slideIndex: number;
        strategy: string;
        coverTemplate?: string;
        reasoning: string;
        scenePrompt: string;
        logoKeys?: string[];
        additionalLogoKeys?: string[];
        personSearchQuery?: string;
        additionalPersonQueries?: string[];
        personPlacement?: string;
        screenshotDescription?: string;
        engagementScore?: number;
        // 2.0 fields
        coverComposition?: any;
        videoNarrative?: any;
        logoStyle?: string;
        logoSize?: number;
      }>;
    };

    if (!parsed.slides || !Array.isArray(parsed.slides)) {
      throw new Error("LLM response missing 'slides' array");
    }

    // ── Validate and sanitize the response ──
    const sanitizedSlides = sanitizeSlides(parsed.slides, topicAnalysis, researched, "CreativeDirector");

    brief = {
      runId,
      slides: sanitizedSlides,
      globalStyleNotes: parsed.globalStyleNotes ?? "Maintain consistent dark cinematic aesthetic with cyan accent highlights.",
    };

  } catch (err: any) {
    console.error(`[CreativeDirector] LLM call failed: ${err?.message} — using fallback briefs`);

    // ── Fallback: generate reasonable briefs without LLM ──
    brief = generateFallbackBrief(researched, topicAnalysis, runId);
  }

  // ── Log the brief (summary + full JSON for diagnosis) ──
  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`\n[CreativeDirector] ═══ Creative Brief (${elapsed}s) ═══`);
  console.log(`[CreativeDirector] Global: ${brief.globalStyleNotes}`);
  for (const s of brief.slides) {
    const templateTag = s.slideIndex === 0 && s.coverTemplate ? ` [template: ${s.coverTemplate}]` : "";
    const logoTag = s.logoKeys ? ` [logos: ${[...s.logoKeys, ...(s.additionalLogoKeys ?? [])].join("+")}]` : "";
    const personTag = s.personSearchQuery ? ` [person: ${s.personSearchQuery.slice(0, 40)}...]` : "";
    console.log(`[CreativeDirector]   Slide ${s.slideIndex}: ${s.strategy}${templateTag}${logoTag}${personTag} | engagement: ${s.engagementScore ?? "?"}/10 | ${s.reasoning.slice(0, 80)}`);
    console.log(`[CreativeDirector]   Slide ${s.slideIndex} scenePrompt: ${s.scenePrompt?.slice(0, 200)}`);
    if (s.videoNarrative) console.log(`[CreativeDirector]   Slide ${s.slideIndex} videoNarrative: ${s.videoNarrative.fullPrompt?.slice(0, 200)}`);
    console.log(`[CreativeDirector]   Slide ${s.slideIndex} logoStyle: ${s.logoStyle ?? "default"} | logoSize: ${s.logoSize ?? "default"}`);
  }
  // Full JSON dump for deep diagnosis (check Railway logs)
  console.log(`[CreativeDirector] FULL_BRIEF_JSON: ${JSON.stringify(brief)}`);
  console.log(`[CreativeDirector] ═══════════════════════════════════════\n`);

  // ── Quality Director Review (Supervisor) ──
  // A second LLM pass reviews the CD brief for quality issues before media generation.
  // If issues are found, the QD sends corrections back and the CD brief is revised.
  try {
    const reviewedBrief = await qualityDirectorReview(brief, researched, topicAnalysis);
    return reviewedBrief;
  } catch (qdErr: any) {
    console.warn(`[QualityDirector] ⚠️ Review failed: ${qdErr?.message} — using original brief`);
    return brief;
  }
}

// ─── Fallback Brief Generator ────────────────────────────────────────────────
// Used when the LLM call fails. Produces a reasonable brief using rule-based logic.

function generateFallbackBrief(
  researched: ResearchedTopicInput[],
  topicAnalysis: Array<{
    index: number;
    slideIndex: number;
    headline: string;
    summary: string;
    detectedLogos: string[];
    detectedPeople: Array<{ name: string; title: string }>;
  }>,
  runId: number,
): CarouselCreativeBrief {
  console.log("[CreativeDirector] Generating fallback brief (rule-based)...");

  const slides: SlideCreativeBrief[] = [];

  // Cover slide (index 0): prefer freeform_composition for richest covers
  const allPeople = topicAnalysis.flatMap(ta => ta.detectedPeople);
  const allDetectedLogosFB = Array.from(new Set(topicAnalysis.flatMap(ta => ta.detectedLogos)));
  const coverStrategy: VisualStrategy = allPeople.length > 0
    ? "person_composite"
    : "cinematic_scene";

  // Choose a sensible fallback cover template — prefer freeform for people
  let fallbackCoverTemplate: CoverTemplate;
  if (coverStrategy === "person_composite") {
    fallbackCoverTemplate = "freeform_composition";
  } else if (allDetectedLogosFB.length >= 3) {
    fallbackCoverTemplate = "left_column_logos";
  } else if (allDetectedLogosFB.length >= 2) {
    fallbackCoverTemplate = "backs_to_the_storm";
  } else {
    fallbackCoverTemplate = "solo_machine";
  }

  // Build freeform coverComposition if we have people
  let coverComposition: SlideCreativeBrief["coverComposition"];
  if (fallbackCoverTemplate === "freeform_composition" && allPeople.length > 0) {
    const uniquePeople = allPeople.filter((p, i, arr) => arr.findIndex(x => x.name === p.name) === i).slice(0, 3);
    coverComposition = {
      backgroundPrompt: "A vast dark cinematic environment with dramatic volumetric lighting, deep shadows, neon accent lights in cyan and orange, no people present, vertical 9:16, photorealistic",
      subjects: uniquePeople.map((person, i) => ({
        name: person.name,
        role: person.title,
        expression: "intense, determined",
        placement: i === 0 ? "center" as const : i === 1 ? "left" as const : "right" as const,
        scale: i === 0 ? "dominant" as const : "supporting" as const,
        promptFragment: `${person.name}, ${person.title}, wearing professional attire, dramatic expression matching a high-stakes tech news story, dramatic side lighting with orange and cyan split tones, shallow depth of field 85mm f/1.4, photorealistic editorial portrait, dark moody background`,
      })),
      logoTreatment: allDetectedLogosFB.slice(0, 3).map((key, i) => ({
        logoKey: key,
        size: "medium" as const,
        placement: i === 0 ? "top-right" : i === 1 ? "top-left" : "above-text-center",
      })),
      compositionMode: uniquePeople.length <= 2 ? "single_shot" as const : "multi_layer" as const,
      compositionDescription: `Movie-poster cover featuring ${uniquePeople.map(p => p.name).join(", ")} with dramatic lighting`,
    };
  }

  slides.push({
    slideIndex: 0,
    strategy: coverStrategy,
    coverTemplate: fallbackCoverTemplate,
    reasoning: coverStrategy === "person_composite"
      ? `Famous person detected: ${allPeople[0].name} — high-impact movie-poster cover`
      : "Dramatic cinematic scene for maximum scroll-stop impact",
    scenePrompt: researched[0]?.videoPrompt ?? "Dramatic cinematic AI technology scene, neon lighting, vertical 9:16",
    logoKeys: allDetectedLogosFB.slice(0, 2),
    additionalLogoKeys: allDetectedLogosFB.slice(2, 4),
    personSearchQuery: coverStrategy === "person_composite"
      ? `${allPeople[0].name} ${allPeople[0].title} photo portrait high quality`
      : undefined,
    personPlacement: "center",
    engagementScore: 7,
    coverComposition,
    logoStyle: "full_color",
    logoSize: 140,
  });

  // Content slides (1-4): alternate strategies for variety
  // Slides 1 and 3 are video candidates (to ensure 2 video slots)
  for (let i = 0; i < researched.length; i++) {
    const ta = topicAnalysis[i];
    const slideIndex = i + 1;
    const isVideoCandidate = slideIndex === 1 || slideIndex === 3;

    let strategy: VisualStrategy;
    if (isVideoCandidate) {
      strategy = "kling_video";
    } else if (ta.detectedPeople.length > 0 && coverStrategy !== "person_composite") {
      strategy = "person_composite";
    } else if (ta.detectedLogos.length > 0) {
      strategy = "scene_with_badge";
    } else {
      strategy = "cinematic_scene";
    }

    slides.push({
      slideIndex,
      strategy,
      reasoning: `Fallback: ${strategy} based on detected assets`,
      scenePrompt: researched[i].videoPrompt,
      logoKeys: strategy === "scene_with_badge" ? ta.detectedLogos.slice(0, 2) : undefined,
      personSearchQuery: strategy === "person_composite" && ta.detectedPeople.length > 0
        ? `${ta.detectedPeople[0].name} ${ta.detectedPeople[0].title} photo portrait high quality`
        : undefined,
      personPlacement: "center",
      engagementScore: 5,
    });
  }

  // Ensure at least 2 video slides
  const fbVideoCount = slides.filter(s => s.strategy === "kling_video").length;
  if (fbVideoCount < 2 && slides.length > 2) {
    const nonVideo = slides
      .filter(s => s.slideIndex > 0 && s.strategy !== "kling_video")
      .sort((a, b) => (b.engagementScore ?? 5) - (a.engagementScore ?? 5));
    const needed = 2 - fbVideoCount;
    for (let i = 0; i < Math.min(needed, nonVideo.length); i++) {
      nonVideo[i].strategy = "kling_video";
      nonVideo[i].logoKeys = undefined;
      nonVideo[i].personSearchQuery = undefined;
    }
  }

  return {
    runId,
    slides,
    globalStyleNotes: "Fallback brief — maintain dark cinematic aesthetic with cyan accent highlights.",
  };
}

// ─── Quality Director (Supervisor) ──────────────────────────────────────────
// Reviews the Creative Director's brief for quality issues before media generation.
// Catches: banned scenes (server rooms), missing person_composite for CEO stories,
// weak/generic prompts, missing PROMPTHIS structure, strategy monotony.
// Returns revised brief if issues found, original brief if approved.

const BANNED_SCENE_PATTERNS = [
  /server\s*room/i, /data\s*center/i, /server\s*rack/i,
  /glowing\s*circuit/i, /motherboard/i, /floating\s*data/i,
  /code\s*stream/i, /faceless\s*silhouette/i, /neural\s*network\s*vis/i,
  /holographic\s*(ui|interface|display)/i, /futuristic\s*(room|lab|facility)/i,
];

const PROMPTHIS_CHECKLIST = [
  { label: "lighting", pattern: /light|lit|glow|shadow|neon|spotlight|backlight|rim\s*light/i },
  { label: "camera/lens", pattern: /\d+mm|lens|f\/\d|depth\s*of\s*field|close-up|wide.?angle|bokeh/i },
  { label: "color_grade", pattern: /color\s*grad|teal|orange|cyan|noir|golden\s*hour|cold\s*blue|warm/i },
];

async function qualityDirectorReview(
  brief: CarouselCreativeBrief,
  researched: ResearchedTopicInput[],
  topicAnalysis: TopicAnalysisInput[],
): Promise<CarouselCreativeBrief> {
  const startMs = Date.now();
  console.log(`\n[QualityDirector] ═══ Reviewing Creative Brief ═══`);

  const issues: Array<{ slideIndex: number; issue: string; fix: string }> = [];

  for (const slide of brief.slides) {
    const prompt = slide.scenePrompt || "";
    // For the cover (index 0), check ALL headlines — the cover synthesizes all stories.
    // For content slides, check just the matching headline.
    const headline = slide.slideIndex === 0
      ? researched.map(r => r.headline).join(" ")
      : researched[slide.slideIndex - 1]?.headline || "";

    // ── Check 1: Banned scenes ──
    for (const pattern of BANNED_SCENE_PATTERNS) {
      if (pattern.test(prompt)) {
        issues.push({
          slideIndex: slide.slideIndex,
          issue: `BANNED SCENE detected: "${prompt.match(pattern)?.[0]}"`,
          fix: "Replace with a specific, story-relevant setting (rooftop, stage, desert, neon street, etc.)",
        });
        break;
      }
    }

    // ── Check 2: Should be person_composite but isn't ──
    if (slide.strategy !== "person_composite" && slide.strategy !== "kling_video") {
      const headlineLower = headline.toLowerCase();
      const mentionedPerson = Object.entries(KNOWN_FIGURES).find(([name]) =>
        headlineLower.includes(name.toLowerCase())
      );
      if (mentionedPerson) {
        issues.push({
          slideIndex: slide.slideIndex,
          issue: `Story mentions "${mentionedPerson[0]}" but strategy is "${slide.strategy}" instead of person_composite`,
          fix: `Switch to person_composite with ${mentionedPerson[0]} as the subject. Generate a portrait-first prompt with 85mm f/1.4, dramatic lighting, person filling 60-80% of frame.`,
        });
      }
    }

    // ── Check 3: PROMPTHIS quality (skip video slides) ──
    if (slide.strategy !== "kling_video" && prompt.length > 0) {
      const missing = PROMPTHIS_CHECKLIST.filter(c => !c.pattern.test(prompt));
      if (missing.length >= 2) {
        issues.push({
          slideIndex: slide.slideIndex,
          issue: `Weak prompt — missing ${missing.map(m => m.label).join(", ")} from PROMPTHIS framework`,
          fix: `Add specific ${missing.map(m => m.label).join(" + ")} details to the scene prompt`,
        });
      }
    }

    // ── Check 4: Too-short prompts ──
    if (prompt.length > 0 && prompt.length < 80) {
      issues.push({
        slideIndex: slide.slideIndex,
        issue: `Scene prompt is only ${prompt.length} chars — too generic for quality output`,
        fix: "Expand with specific setting, lighting, camera, and mood details (aim for 150+ chars)",
      });
    }

    // ── Check 5: Video without story arc ──
    if (slide.strategy === "kling_video") {
      const videoPrompt = slide.videoNarrative?.fullPrompt || prompt;
      if (!/camera|push|dolly|orbit|pan|zoom|track|reveal/i.test(videoPrompt)) {
        issues.push({
          slideIndex: slide.slideIndex,
          issue: "Video prompt has no camera movement",
          fix: "Add camera direction: slow push-in, orbit, dolly zoom, tracking shot, or pull-back reveal",
        });
      }
    }
  }

  // ── Check 6: Strategy monotony ──
  const strategies = brief.slides.map(s => s.strategy);
  const uniqueStrategies = new Set(strategies);
  if (uniqueStrategies.size < 2) {
    issues.push({
      slideIndex: -1,
      issue: `Only ${uniqueStrategies.size} strategy used across all slides: ${Array.from(uniqueStrategies).join(", ")}`,
      fix: "Mix strategies: aim for 1-2 person_composite + 1-2 scene_with_badge + 2 kling_video",
    });
  }

  if (issues.length === 0) {
    console.log(`[QualityDirector] ✅ Brief APPROVED — no issues found (${((Date.now() - startMs) / 1000).toFixed(1)}s)`);
    return brief;
  }

  // ── Issues found — ask LLM to fix the brief ──
  console.log(`[QualityDirector] ⚠️ Found ${issues.length} issues:`);
  for (const iss of issues) {
    const slideLabel = iss.slideIndex >= 0 ? `Slide ${iss.slideIndex}` : "Global";
    console.log(`[QualityDirector]   ${slideLabel}: ${iss.issue}`);
    console.log(`[QualityDirector]     Fix: ${iss.fix}`);
  }

  // Build a trimmed version of the brief for the revision prompt to stay within token limits.
  // Strip verbose coverComposition fields — the QD only needs per-slide strategy/prompt info.
  const trimmedSlides = brief.slides.map(s => ({
    slideIndex: s.slideIndex,
    strategy: s.strategy,
    coverTemplate: s.coverTemplate,
    reasoning: s.reasoning,
    scenePrompt: s.scenePrompt,
    logoKeys: s.logoKeys,
    personSearchQuery: s.personSearchQuery,
    personPlacement: s.personPlacement,
    engagementScore: s.engagementScore,
    logoStyle: s.logoStyle,
    logoSize: s.logoSize,
    videoNarrative: s.videoNarrative,
    // coverComposition intentionally omitted — too large, QD doesn't need to rewrite it
  }));
  const trimmedBrief = { runId: brief.runId, globalStyleNotes: brief.globalStyleNotes, slides: trimmedSlides };

  const revisionPrompt = `You are the Quality Director reviewing a Creative Director's brief. Fix the issues listed below.

CURRENT BRIEF:
${JSON.stringify(trimmedBrief)}

ISSUES TO FIX:
${issues.map((iss, i) => `${i + 1}. [Slide ${iss.slideIndex}] ${iss.issue}\n   FIX: ${iss.fix}`).join("\n")}

RULES:
- Return the COMPLETE revised brief JSON (all slides, not just fixed ones)
- Keep everything that's already good — only fix the flagged issues
- For person_composite: use Nano Banana (Gemini) — it CAN generate named people with recognizable faces
- BANNED SCENES: no server rooms, data centers, server racks, generic circuits, floating data, holographic UIs
- Every scene prompt must have: setting, camera/lens, lighting (2+ sources), color grade, mood
- Return ONLY valid JSON, no explanation`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: "You are a quality control agent. Fix the creative brief based on the issues. Return ONLY the corrected JSON." },
        { role: "user", content: revisionPrompt },
      ],
      responseFormat: { type: "json_object" },
      maxTokens: 6000,
    });

    const raw = response?.choices?.[0]?.message?.content;
    const revised = typeof raw === "string" ? raw.trim() : "";
    if (!revised) throw new Error("Empty response from QD revision");

    const cleanJson = revised.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleanJson) as { runId?: number; globalStyleNotes?: string; slides?: RawSlideInput[] };

    if (!parsed.slides || !Array.isArray(parsed.slides) || parsed.slides.length === 0) {
      throw new Error("Revised brief has no slides");
    }

    // ── CRITICAL: Run the same sanitization on QD output as we do on CD output ──
    // The QD LLM could hallucinate invalid strategies, missing logoKeys, etc.
    const sanitizedSlides = sanitizeSlides(parsed.slides, topicAnalysis, researched, "QualityDirector");

    // Preserve coverComposition from original brief — QD revision doesn't touch it
    for (const slide of sanitizedSlides) {
      const original = brief.slides.find(s => s.slideIndex === slide.slideIndex);
      if (original?.coverComposition && !slide.coverComposition) {
        slide.coverComposition = original.coverComposition;
      }
    }

    const revisedBrief: CarouselCreativeBrief = {
      runId: brief.runId,
      globalStyleNotes: parsed.globalStyleNotes ?? brief.globalStyleNotes,
      slides: sanitizedSlides,
    };

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(`[QualityDirector] ✅ Brief REVISED + SANITIZED — ${issues.length} issues fixed (${elapsed}s)`);
    console.log(`[QualityDirector] REVISED_BRIEF_JSON: ${JSON.stringify(revisedBrief)}`);
    return revisedBrief;
  } catch (revErr: any) {
    console.warn(`[QualityDirector] ⚠️ Revision failed: ${revErr?.message} — using original brief`);
    return brief;
  }
}
