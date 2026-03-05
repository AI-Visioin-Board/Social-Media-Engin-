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
 * "person_composite" — Google Image Search for a real person photo (transparent/cutout)
 *                      composited onto an AI-generated background.
 *                      Best for: CEO announcements, founder drama, executive moves.
 *                      ONLY for well-known public figures with many available photos.
 *
 * "kling_video"      — 5-second cinematic video clip via Kling 2.5 Turbo.
 *                      Most engaging format. 1-2 per carousel max (cost + time).
 *                      Best for: the most dramatic/action-oriented story.
 */
export type VisualStrategy =
  | "cinematic_scene"
  | "scene_with_badge"
  | "person_composite"
  | "kling_video";

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
   * Predicted engagement score (0-10) for this visual strategy.
   * Higher = more likely to drive DM shares and saves.
   */
  engagementScore?: number;
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
  "sam altman": "CEO of OpenAI",
  "sundar pichai": "CEO of Google / Alphabet",
  "elon musk": "CEO of Tesla, SpaceX, xAI",
  "mark zuckerberg": "CEO of Meta",
  "tim cook": "CEO of Apple",
  "satya nadella": "CEO of Microsoft",
  "dario amodei": "CEO of Anthropic",
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
};

/** Scan text for known public figures and return matches */
export function detectKnownPeople(text: string): Array<{ name: string; title: string }> {
  const lower = text.toLowerCase();
  const found: Array<{ name: string; title: string; pos: number }> = [];

  for (const [name, title] of Object.entries(KNOWN_FIGURES)) {
    const pos = lower.indexOf(name);
    if (pos >= 0) {
      found.push({ name, title, pos });
    }
  }

  // Also check last names alone for very famous figures
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
  };

  for (const [lastName, fullName] of Object.entries(LAST_NAME_MAP)) {
    // Only match if full name wasn't already found
    if (!found.some(f => f.name === fullName)) {
      const pos = lower.indexOf(lastName);
      if (pos >= 0) {
        found.push({
          name: fullName,
          title: KNOWN_FIGURES[fullName],
          pos,
        });
      }
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

3. "person_composite" — Google Image Search for a REAL PHOTO of a public figure, composited onto a dramatic AI-generated background. The person becomes the visual anchor.
   WHEN: Stories dominated by a specific well-known person (CEO, founder, executive). ONLY use for people on the known figures list. This is the HIGHEST IMPACT strategy for personality-driven stories.
   ENGAGEMENT: Very high P(share) — people share content about people they recognize. High P(dwell) — faces draw eyes.
   EXAMPLE: "Sam Altman announces GPT-5" → cutout of Sam Altman on a dramatic tech background.
   CONSTRAINT: ONLY use for these verified public figures: ${Object.entries(KNOWN_FIGURES).map(([n, t]) => `${n} (${t})`).join(", ")}

4. "kling_video" — 5-second cinematic video clip via Kling 2.5 Turbo AI. Video prompts MUST include camera movement (slow push-in, orbit, dolly zoom, parallax) and dynamic action.
   WHEN: The story has dramatic visual potential — action, confrontation, transformation, or spectacle.
   ENGAGEMENT: Highest P(dwell). Very high P(share) for dramatic clips. Instagram mixed-media carousels outperform.
   LIMIT: Assign to exactly 1-2 slides per carousel (expensive, slow, rate-limited).

═══ CRITICAL RULES ═══

VARIETY IS MANDATORY:
- You MUST use at least 2 DIFFERENT strategies across the 5 slides.
- NEVER use scene_with_badge on every slide. That's boring repetition.
- If 3+ stories involve specific companies, vary between cinematic_scene, scene_with_badge, and person_composite.

COVER SLIDE (index 0) = 80% OF THE POST:
- The cover must be the single most scroll-stopping image in the carousel.
- PREFER: person_composite (if a famous person is central), cinematic_scene (for maximum visual drama), or kling_video (if the biggest story is action-oriented).
- AVOID: scene_with_badge for the cover — a small corner logo is too subtle for a thumbnail.

VIDEO STRATEGY:
- Assign kling_video to exactly 1-2 slides (indices 1-4, NOT the cover unless it's spectacular).
- Choose stories with the MOST DYNAMIC visual potential for video.
- Video prompts MUST describe: camera movement type, action/motion, lighting changes, 5-second arc.

SCENE PROMPT QUALITY (PROMPTHIS Framework):
Every scenePrompt must follow this structure for maximum AI image quality:
1. SETTING: Specific location/environment (not "futuristic room" — say "a glass-walled boardroom overlooking a neon-lit Tokyo skyline at night")
2. CAMERA: Shot type + lens + angle ("extreme close-up, 85mm lens, low angle looking up")
3. SUBJECT: The main visual element in specific detail ("a pair of hands hovering over a glowing green holographic interface")
4. LIGHTING: Specific light sources + quality ("dramatic side-lit by a single cyan neon strip, deep shadows on the right")
5. MOOD: Color palette + emotional tone ("cold blue-green palette, tension, corporate thriller feel")

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
      "strategy": "cinematic_scene" | "scene_with_badge" | "person_composite" | "kling_video",
      "reasoning": "Why this strategy for this specific story (1-2 sentences)",
      "scenePrompt": "The full PROMPTHIS-structured scene description for AI image/video generation",
      "logoKeys": ["openai"] (only if strategy is scene_with_badge, max 2 keys),
      "personSearchQuery": "Full Name Title Company photo transparent PNG cutout" (only if person_composite),
      "personPlacement": "center" | "left" | "right" (only if person_composite),
      "engagementScore": 7.5 (your predicted engagement score 0-10 for this visual)
    }
  ]
}`;
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

  const userPrompt = `Decide the visual strategy for each slide in this AI news carousel.

COVER SLIDE (index 0) — must synthesize this week's stories into ONE attention-grabbing visual:
${coverContext}

CONTENT SLIDES (indices 1-${researched.length}):

${slideDetails}

Remember:
- Slide 0 (cover) carries 80% of the post's weight — maximum visual impact
- Use at least 2 different strategies across all 5 slides
- Assign kling_video to exactly 1-2 content slides (NOT the cover unless exceptional)
- person_composite ONLY for verified public figures listed in the system prompt
- Every scenePrompt must follow PROMPTHIS structure (Setting → Camera → Subject → Lighting → Mood)
- Scene prompts must contain ZERO text — no letters, words, numbers, or readable characters

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
        reasoning: string;
        scenePrompt: string;
        logoKeys?: string[];
        personSearchQuery?: string;
        personPlacement?: string;
        engagementScore?: number;
      }>;
    };

    if (!parsed.slides || !Array.isArray(parsed.slides)) {
      throw new Error("LLM response missing 'slides' array");
    }

    // ── Validate and sanitize the response ──
    const validStrategies = new Set<VisualStrategy>([
      "cinematic_scene", "scene_with_badge", "person_composite", "kling_video",
    ]);

    const sanitizedSlides: SlideCreativeBrief[] = parsed.slides.map((s) => {
      let strategy = s.strategy as VisualStrategy;

      // Validate strategy name
      if (!validStrategies.has(strategy)) {
        console.warn(`[CreativeDirector] Invalid strategy "${s.strategy}" for slide ${s.slideIndex} — falling back to cinematic_scene`);
        strategy = "cinematic_scene";
      }

      // Validate person_composite: only allow for known figures
      if (strategy === "person_composite") {
        const topicIdx = s.slideIndex === 0 ? -1 : s.slideIndex - 1;
        const analysis = topicIdx >= 0 ? topicAnalysis[topicIdx] : null;
        const allText = analysis
          ? `${analysis.headline} ${analysis.summary}`
          : researched.map(t => t.headline).join(" ");
        const knownPeople = detectKnownPeople(allText);

        if (knownPeople.length === 0) {
          console.warn(`[CreativeDirector] Slide ${s.slideIndex}: person_composite requested but no known figures detected — downgrading to cinematic_scene`);
          strategy = "cinematic_scene";
        }
      }

      // Validate logoKeys: only allow keys that exist in LOGO_LIBRARY
      let logoKeys = s.logoKeys?.filter(k => k in LOGO_LIBRARY).slice(0, 2);
      if (strategy === "scene_with_badge" && (!logoKeys || logoKeys.length === 0)) {
        // Try to auto-detect logos from the topic
        const topicIdx = s.slideIndex === 0 ? -1 : s.slideIndex - 1;
        if (topicIdx >= 0 && topicAnalysis[topicIdx]?.detectedLogos.length > 0) {
          logoKeys = topicAnalysis[topicIdx].detectedLogos.slice(0, 2);
        } else {
          console.warn(`[CreativeDirector] Slide ${s.slideIndex}: scene_with_badge but no valid logos — downgrading to cinematic_scene`);
          strategy = "cinematic_scene";
        }
      }

      // Validate personPlacement
      const validPlacements = new Set(["center", "left", "right"]);
      const personPlacement = validPlacements.has(s.personPlacement ?? "")
        ? (s.personPlacement as "center" | "left" | "right")
        : "center";

      return {
        slideIndex: s.slideIndex,
        strategy,
        reasoning: s.reasoning ?? "No reasoning provided",
        scenePrompt: s.scenePrompt ?? "",
        logoKeys: strategy === "scene_with_badge" ? logoKeys : undefined,
        personSearchQuery: strategy === "person_composite" ? s.personSearchQuery : undefined,
        personPlacement: strategy === "person_composite" ? personPlacement : undefined,
        engagementScore: typeof s.engagementScore === "number" ? s.engagementScore : undefined,
      };
    });

    // ── Ensure correct slide count: must have cover (0) + one per topic (1..N) ──
    const expectedCount = researched.length + 1; // cover + content slides
    const existingIndices = new Set(sanitizedSlides.map(s => s.slideIndex));

    // Fill in any missing slides with cinematic_scene defaults
    for (let idx = 0; idx < expectedCount; idx++) {
      if (!existingIndices.has(idx)) {
        console.warn(`[CreativeDirector] LLM omitted slide ${idx} — adding cinematic_scene default`);
        const topicIdx = idx === 0 ? 0 : idx - 1;
        sanitizedSlides.push({
          slideIndex: idx,
          strategy: "cinematic_scene",
          reasoning: "Auto-filled — LLM omitted this slide",
          scenePrompt: idx === 0
            ? researched.map(t => t.headline).join(". ") + ". Dramatic cinematic AI scene, vertical 9:16, no text."
            : researched[topicIdx]?.videoPrompt ?? "Dramatic cinematic AI technology scene, neon lighting, vertical 9:16",
          engagementScore: 5,
        });
      }
    }

    // Remove any excess slides beyond expected count
    if (sanitizedSlides.length > expectedCount) {
      console.warn(`[CreativeDirector] LLM returned ${sanitizedSlides.length} slides, expected ${expectedCount} — trimming`);
      // Keep only the expected indices, sorted
      const validSlides = sanitizedSlides.filter(s => s.slideIndex >= 0 && s.slideIndex < expectedCount);
      // Deduplicate: keep first occurrence of each slideIndex
      const seen = new Set<number>();
      sanitizedSlides.length = 0;
      for (const s of validSlides) {
        if (!seen.has(s.slideIndex)) {
          seen.add(s.slideIndex);
          sanitizedSlides.push(s);
        }
      }
    }

    // Sort by slideIndex for consistent ordering
    sanitizedSlides.sort((a, b) => a.slideIndex - b.slideIndex);

    // ── Ensure variety: at least 2 different strategies ──
    const uniqueStrategies = new Set(sanitizedSlides.map(s => s.strategy));
    if (uniqueStrategies.size < 2 && sanitizedSlides.length >= 3) {
      console.warn(`[CreativeDirector] Only ${uniqueStrategies.size} unique strategy — forcing variety`);
      // Find the slide with the lowest engagement score and switch it
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
          // Pick a random available logo relevant to the headline
          weakest.strategy = "cinematic_scene";
        }
      }
    }

    // ── Ensure video count: exactly 1-2 video slides ──
    const videoSlides = sanitizedSlides.filter(s => s.strategy === "kling_video");
    if (videoSlides.length === 0) {
      // Force the content slide with highest engagement score to be video
      const contentSlides = sanitizedSlides
        .filter(s => s.slideIndex > 0)
        .sort((a, b) => (b.engagementScore ?? 5) - (a.engagementScore ?? 5));
      if (contentSlides.length > 0) {
        const best = contentSlides[0];
        console.log(`[CreativeDirector] No video slides — upgrading slide ${best.slideIndex} to kling_video`);
        best.strategy = "kling_video";
        best.logoKeys = undefined;
        best.personSearchQuery = undefined;
      }
    } else if (videoSlides.length > 2) {
      // Downgrade excess video slides
      const toDowngrade = videoSlides.slice(2);
      for (const slide of toDowngrade) {
        console.log(`[CreativeDirector] Too many video slides — downgrading slide ${slide.slideIndex} to cinematic_scene`);
        slide.strategy = "cinematic_scene";
      }
    }

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

  // ── Log the brief ──
  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`\n[CreativeDirector] ═══ Creative Brief (${elapsed}s) ═══`);
  console.log(`[CreativeDirector] Global: ${brief.globalStyleNotes}`);
  for (const s of brief.slides) {
    console.log(`[CreativeDirector]   Slide ${s.slideIndex}: ${s.strategy}${s.logoKeys ? ` [${s.logoKeys.join("+")}]` : ""}${s.personSearchQuery ? ` [person: ${s.personSearchQuery.slice(0, 40)}...]` : ""} | engagement: ${s.engagementScore ?? "?"}/10 | ${s.reasoning.slice(0, 80)}`);
  }
  console.log(`[CreativeDirector] ═══════════════════════════════════════\n`);

  return brief;
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

  // Cover slide (index 0): cinematic_scene or person_composite if a famous person dominates
  const allPeople = topicAnalysis.flatMap(ta => ta.detectedPeople);
  const coverStrategy: VisualStrategy = allPeople.length > 0
    ? "person_composite"
    : "cinematic_scene";

  slides.push({
    slideIndex: 0,
    strategy: coverStrategy,
    reasoning: coverStrategy === "person_composite"
      ? `Famous person detected: ${allPeople[0].name} — high-impact cover`
      : "Dramatic cinematic scene for maximum scroll-stop impact",
    scenePrompt: researched[0]?.videoPrompt ?? "Dramatic cinematic AI technology scene, neon lighting, vertical 9:16",
    personSearchQuery: coverStrategy === "person_composite"
      ? `${allPeople[0].name} ${allPeople[0].title} photo portrait high quality`
      : undefined,
    personPlacement: "center",
    engagementScore: 7,
  });

  // Content slides (1-4): alternate strategies for variety
  // Slides 1 and 3 lean toward video, slides 2 and 4 lean toward images
  for (let i = 0; i < researched.length; i++) {
    const ta = topicAnalysis[i];
    const slideIndex = i + 1;
    const isVideoCandidate = slideIndex === 1 || slideIndex === 3;

    let strategy: VisualStrategy;
    if (isVideoCandidate && i === 0) {
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

  // Ensure at least 1 video slide
  if (!slides.some(s => s.strategy === "kling_video") && slides.length > 1) {
    slides[1].strategy = "kling_video";
    slides[1].logoKeys = undefined;
    slides[1].personSearchQuery = undefined;
  }

  return {
    runId,
    slides,
    globalStyleNotes: "Fallback brief — maintain dark cinematic aesthetic with cyan accent highlights.",
  };
}
