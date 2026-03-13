/**
 * Content Studio Pipeline
 * Automated twice-weekly AI news carousel generation
 *
 * Stages:
 * 1. Topic Discovery  — NewsAPI + Reddit JSON API + GPT-4o web search
 * 2. No-Repeat Filter — exclude topics published in last 14 days
 * 3. GPT Scoring      — score candidates on 5 virality criteria, pick best 4
 * 4. Deep Research    — GPT-4o web search (OpenAI Responses API) per topic
 * 5. Media Generation — Gemini Nano Banana images + Veo 3.1 video
 * 6. Slide Assembly   — HTML/CSS compositor (Puppeteer) + FFmpeg video overlay
 * 7. Instagram Post   — Make.com webhook trigger
 */

import { eq, gte, desc } from "drizzle-orm";
import { getDb } from "./db";
import {
  contentRuns,
  publishedTopics,
  generatedSlides,
  type ContentRun,
} from "../drizzle/schema";
import { invokeLLM } from "./_core/llm";
import { notifyOwner } from "./_core/notification";
import { storagePut } from "./storage";

import { ENV } from "./_core/env";
import { SignJWT } from "jose";

// ─── Progress Helper ─────────────────────────────────────────────────────────
// Updates the statusDetail column so the UI shows granular progress within each stage.
// Non-blocking — fires and forgets to avoid slowing down the pipeline.

async function updateProgress(runId: number, detail: string): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.update(contentRuns).set({ statusDetail: detail }).where(eq(contentRuns.id, runId));
    console.log(`[Progress] Run #${runId}: ${detail}`);
  } catch { /* never block pipeline on progress updates */ }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RawTopic {
  title: string;
  source: "reddit" | "news";
  url: string;
  engagementScore?: number; // views/likes/upvotes normalised 0-100
  publishedAt?: string;
}

export interface ScoredTopic {
  title: string;
  summary: string;
  source: string;
  url: string;
  scores: {
    // New virality-weighted criteria
    shareability?: number;    // 1-10, weight 5x — would someone DM this?
    saveWorthiness?: number;  // 1-10, weight 3.5x — would someone bookmark?
    debatePotential?: number; // 1-10, weight 2.5x — would people argue?
    informationGap?: number;  // 1-10, weight 2x — how unknown is this?
    personalImpact?: number;  // 1-10, weight 1x — affects viewer's life?
    // Legacy criteria (backwards compatibility)
    businessOwnerImpact?: number;
    generalPublicRelevance?: number;
    viralPotential?: number;
    worldImportance?: number;
    interestingness?: number;
    total: number;           // weighted sum
  };
}

export interface ResearchedTopic {
  title: string;
  headline: string;       // short punchy headline for slide
  summary: string;        // 2-sentence plain-English explanation
  insightLine?: string;   // optional 1-sentence context shown as chat bubble (null = not needed)
  citations: Array<{ source: string; url: string }>;
  videoPrompt: string;    // Video/image generation prompt
  verified: boolean;      // has 3+ credible sources
}

// ─── Stage 1: Topic Discovery ─────────────────────────────────────────────────

/**
 * Fetch trending AI topics from NewsAPI, Reddit, and GPT-4o web search simultaneously.
 * All sources run in parallel for speed.
 */
export async function discoverTopics(runType: "monday" | "friday" = "monday"): Promise<RawTopic[]> {
  console.log(`[ContentPipeline] Starting multi-source topic discovery for ${runType} run...`);
  // Run all sources in parallel: NewsAPI + Reddit + 3x GPT-4o web search
  const [newsApiResult, redditResult, ...gptResults] = await Promise.allSettled([
    discoverFromNewsAPI(runType),
    discoverFromRedditJSON(),
    ...buildGPT4oSearchQueries(runType).map((q) => runSingleGPT4oSearch(q, process.env.OPENAI_API_KEY ?? "")),
  ]);
  const topics: RawTopic[] = [];
  if (newsApiResult.status === "fulfilled") {
    console.log(`[ContentPipeline] NewsAPI: ${newsApiResult.value.length} articles`);
    topics.push(...newsApiResult.value);
  }
  if (redditResult.status === "fulfilled") {
    console.log(`[ContentPipeline] Reddit: ${redditResult.value.length} posts`);
    topics.push(...redditResult.value);
  }
  for (let i = 0; i < gptResults.length; i++) {
    const r = gptResults[i];
    if (r.status === "fulfilled") {
      console.log(`[ContentPipeline] GPT-4o query ${i + 1}: ${r.value.length} topics`);
      topics.push(...r.value);
    }
  }
  console.log(`[ContentPipeline] Total discovered: ${topics.length} raw topics from all sources`);
  // Last resort: static fallback
  if (topics.length < 5) {
    console.warn("[ContentPipeline] Low topic count — adding static fallback topics");
    topics.push(...getStaticFallbackTopics());
  }
  return topics;
}

async function discoverFromNewsAPI(runType: "monday" | "friday"): Promise<RawTopic[]> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    console.warn("[ContentPipeline] No NEWS_API_KEY — skipping NewsAPI");
    return [];
  }
  // Monday: last 7 days. Friday: last 3 days (fresher content)
  const daysBack = runType === "friday" ? 3 : 7;
  const from = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const queries = [
    "artificial intelligence",
    "AI model release",
    "machine learning breakthrough",
  ];
  const results: RawTopic[] = [];
  await Promise.allSettled(
    queries.map(async (q) => {
      try {
        const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&from=${from}&sortBy=popularity&pageSize=10&language=en&apiKey=${apiKey}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) return;
        const data = await res.json() as any;
        if (data.status !== "ok") return;
        for (const article of (data.articles ?? [])) {
          if (article.title && !article.title.includes("[Removed]")) {
            results.push({
              title: article.title.slice(0, 120),
              source: "news" as const,
              url: article.url ?? "",
              publishedAt: article.publishedAt,
            });
          }
        }
      } catch { /* skip */ }
    })
  );
  console.log(`[ContentPipeline] NewsAPI discovered ${results.length} articles (from ${from})`);
  return results;
}

// 3 focused GPT-4o web search queries with dynamic date injection to prevent stale results
// Date is injected at runtime so GPT knows exactly what "recent" means
function buildGPT4oSearchQueries(runType: "monday" | "friday"): string[] {
  const today = new Date();
  const todayStr = today.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const cutoffDate = new Date(today.getTime() - (runType === "friday" ? 3 : 7) * 24 * 60 * 60 * 1000);
  const cutoffStr = cutoffDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const window = runType === "friday" ? "last 48-72 hours" : "last 7 days";
  const focus = runType === "friday"
    ? "what just happened in AI this week — breaking news, just-released tools, announcements from the last 2-3 days"
    : "this week in AI — the most significant stories from the past 7 days";

  return [
    // Query 1: Major AI news & product launches
    `Today is ${todayStr}. Search the web for the 6 most significant AI news stories published AFTER ${cutoffStr} (${window}). Focus on: ${focus}. Include new AI model releases, major product launches, and viral AI moments. CRITICAL: Only include stories published after ${cutoffStr}. If you cannot find recent stories, say so — do NOT return old news. Return ONLY a JSON array: [{"title": "headline max 15 words", "url": "source url or empty string", "source": "news"}]`,

    // Query 2: Business & consumer AI impact
    `Today is ${todayStr}. Search the web for the 6 most impactful AI stories for business owners and everyday consumers published AFTER ${cutoffStr} (${window}). Focus on: new AI tools that save time or money, AI automating jobs or tasks, AI changing how people work or shop, AI regulation affecting businesses. CRITICAL: Only stories published after ${cutoffStr} — no older news. Return ONLY a JSON array: [{"title": "headline max 15 words", "url": "source url or empty string", "source": "news"}]`,

    // Query 3: Viral, surprising, or controversial AI
    `Today is ${todayStr}. Search the web for the 6 most surprising, controversial, or viral AI stories published AFTER ${cutoffStr} (${window}). Focus on: AI doing something shocking or unexpected, AI safety concerns, AI vs humans moments, AI art/creativity controversies, anything the internet is buzzing about. CRITICAL: Only stories published after ${cutoffStr}. Return ONLY a JSON array: [{"title": "headline max 15 words", "url": "source url or empty string", "source": "news"}]`,
  ];
}

async function runSingleGPT4oSearch(query: string, openAiKey: string): Promise<RawTopic[]> {
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ENV.openaiModel,
        tools: [{ type: "web_search_preview" }],
        input: query,
      }),
      signal: AbortSignal.timeout(90_000), // 90s timeout for discovery search (web search can be slow)
    });
    if (!response.ok) return [];
    const data = await response.json() as any;
    const outputItems: any[] = data?.output ?? [];
    const textItem = outputItems.find((o: any) => o.type === "message");
    const rawText: string = textItem?.content?.[0]?.text ?? "[]";
    let parsed: any[] = [];
    try {
      const jsonMatch = rawText.match(/\[[\s\S]*\]/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch { /* ignore */ }
    return parsed
      .filter((t: any) => t.title && t.url)
      .map((t: any) => ({ title: t.title, source: "news" as const, url: t.url }));
  } catch {
    return [];
  }
}

async function discoverFromRedditJSON(): Promise<RawTopic[]> {
  const subreddits = ["artificial", "MachineLearning", "singularity", "ChatGPT"];
  const results: RawTopic[] = [];
  await Promise.allSettled(
    subreddits.map(async (sub) => {
      try {
        const res = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=10`, {
          headers: { "User-Agent": "SuggestedByGPT/1.0" },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return;
        const data = await res.json() as any;
        const posts = data?.data?.children ?? [];
        for (const { data: post } of posts) {
          if (post?.title && post.score > 50) {
            results.push({
              title: post.title.slice(0, 120),
              source: "reddit" as const,
              url: `https://reddit.com${post.permalink}`,
              engagementScore: Math.min(100, Math.floor(post.score / 100)),
            });
          }
        }
      } catch { /* skip */ }
    })
  );
  console.log(`[ContentPipeline] Reddit JSON API discovered ${results.length} topics`);
  return results;
}

// discoverWithGPT4oWebSearch removed — logic merged into discoverTopics() above

function getStaticFallbackTopics(): RawTopic[] {
  // Last-resort static topics — will be replaced by real research in Stage 4
  return [
    { title: "OpenAI releases new GPT model with improved reasoning", source: "news", url: "https://openai.com/news" },
    { title: "Google DeepMind announces breakthrough in AI protein folding", source: "news", url: "https://deepmind.google" },
    { title: "Anthropic Claude gets major update with new capabilities", source: "news", url: "https://anthropic.com/news" },
    { title: "Meta AI open-sources new large language model", source: "news", url: "https://ai.meta.com" },
    { title: "AI agents can now autonomously complete complex business tasks", source: "news", url: "https://venturebeat.com/ai" },
    { title: "New AI tool helps small businesses automate customer service", source: "news", url: "https://techcrunch.com/ai" },
    { title: "AI regulation bill advances in US Congress", source: "news", url: "https://reuters.com/technology/ai" },
    { title: "Microsoft Copilot gets major upgrade for enterprise users", source: "news", url: "https://microsoft.com/copilot" },
    { title: "AI-powered video generation reaches new quality milestone", source: "news", url: "https://wired.com/ai" },
    { title: "Study shows AI can diagnose diseases as accurately as doctors", source: "news", url: "https://nature.com/ai" },
    { title: "New AI coding assistant outperforms human developers in tests", source: "news", url: "https://github.com/features/copilot" },
    { title: "AI startup raises $500M to build autonomous business agents", source: "news", url: "https://bloomberg.com/technology" },
  ];
}

// Dead Manus functions removed (discoverFromYouTube, discoverFromTikTok, discoverFromReddit).
// These imported from /opt/.manus/.sandbox-runtime/data_api.js which doesn't exist outside Manus.
// Topic discovery now uses: NewsAPI + Reddit JSON API + GPT-4o web search (see above).

// ─── Stage 2: No-Repeat Filter ────────────────────────────────────────────────

/**
 * Remove topics that are too similar to what was published in the last 14 days
 */
export async function filterNoRepeat(topics: RawTopic[]): Promise<RawTopic[]> {
  const db = await getDb();
  if (!db) return topics;

  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const recent = await db
    .select()
    .from(publishedTopics)
    .where(gte(publishedTopics.publishedAt, cutoff));

  const recentNormalized = recent.map((t) => normalizeTitle(t.title));

  return topics.filter((t) => {
    const norm = normalizeTitle(t.title);
    // Exclude if any recent topic shares 3+ consecutive words
    return !recentNormalized.some((r) => titleOverlap(norm, r));
  });
}

export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

function titleOverlap(a: string, b: string): boolean {
  const wordsA = a.split(" ").filter((w) => w.length > 3);
  const wordsB = new Set(b.split(" ").filter((w) => w.length > 3));
  const shared = wordsA.filter((w) => wordsB.has(w));
  return shared.length >= 3;
}

// ─── Stage 3: GPT Scoring Agent ───────────────────────────────────────────────

/**
 * Use GPT to score all topics on 5 criteria and select the best 5.
 * Deduplicates similar topics before scoring.
 */
export async function scoreAndSelectTopics(
  topics: RawTopic[],
  recentExclusions: string[] = []
): Promise<ScoredTopic[]> {
  // Deduplicate by normalised title similarity
  const deduped = deduplicateTopics(topics);

  // Take up to 50 candidates — 6 parallel GPT-4o searches + Reddit can yield 30-50 topics
  const candidates = deduped.slice(0, 50);

  const systemPrompt = `You are a world-class social media content strategist for @suggestedbygpt, an AI news Instagram page with a highly engaged audience of entrepreneurs, business owners, and tech-curious everyday people. Your job is to select the 4 BEST AI news stories from a large pool of candidates for this week's Instagram carousel.

AUDIENCE PROFILE:
- Small/medium business owners who want to use AI to grow their business
- Everyday people curious about how AI affects their lives
- Entrepreneurs and investors tracking AI trends
- Tech enthusiasts who share viral AI content

INSTAGRAM 2026 ALGORITHM INSIGHT (from real data):
- DM SHARES are the #1 ranking signal — weighted 3-5x more than likes
- SAVES are #2 — content that gets bookmarked gets Explore page distribution
- Comments >5 words = "high social relevance" signal
- Instagram now reshows UNSWIPED carousel slides as new content — every slide is a fresh engagement opportunity
- Shares per reach is the single strongest predictor of post going viral

SCORING CRITERIA (rate each 1-10, with VIRALITY WEIGHTS):
1. shareability (WEIGHT: 5x): Would someone DM this to a friend? Insider knowledge, career impact, controversy, "tag someone who..."
2. saveWorthiness (WEIGHT: 3.5x): Would someone bookmark this? Actionable data, tools, predictions, reference-worthy stats
3. debatePotential (WEIGHT: 2.5x): Would people argue about this? Strong opinions, winners vs losers, moral implications
4. informationGap (WEIGHT: 2x): How much do people NOT know about this? Unknown > "heard something" > "old news"
5. personalImpact (WEIGHT: 1x): Does this affect the viewer's life/career directly?

SELECTION RULES:
- Select exactly 4 topics with maximum variety (no two from the same company or angle)
- Prioritize CONCRETE news over vague announcements ("X released Y" beats "X is working on Y")
- Prefer stories with clear impact that can be explained in one sentence
- At least 1 topic should be directly actionable for business owners
- At least 1 topic should be broadly relatable to non-technical people
- Avoid: pure research papers, niche developer tools, incremental updates to existing products
- WEIGHTED SCORE = (shareability × 5) + (saveWorthiness × 3.5) + (debatePotential × 2.5) + (informationGap × 2) + (personalImpact × 1). Topics scoring below 50 total should be REPLACED.
${recentExclusions.length > 0 ? `
DO NOT SELECT these recently published topics or anything closely similar:\n${recentExclusions.slice(0, 20).join("\n")}` : ""}`;

  const userPrompt = `Here are the candidate topics. Score each on the 5 virality-weighted criteria and select the best 4.

CANDIDATES:
${candidates.map((t, i) => `${i + 1}. "${t.title}" (source: ${t.source})`).join("\n")}

Return a JSON object with a "topics" key containing an array of exactly 4 objects:
{"topics": [
  {
    "title": "original title from the list",
    "summary": "1-sentence plain English explanation of why this matters",
    "source": "reddit or news",
    "url": "original url",
    "scores": {
      "shareability": 8,
      "saveWorthiness": 7,
      "debatePotential": 9,
      "informationGap": 6,
      "personalImpact": 8,
      "total": 104
    }
  }
]}

NOTE: "total" = (shareability × 5) + (saveWorthiness × 3.5) + (debatePotential × 2.5) + (informationGap × 2) + (personalImpact × 1)`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    });

    const rawContent = response?.choices?.[0]?.message?.content;
    const content = typeof rawContent === "string" ? rawContent : null;
    if (!content) throw new Error("No response from LLM");

    const parsed = JSON.parse(content);

    // Resilient extraction: the model might wrap the array under any key
    // ("topics", "results", "scored_topics", etc.) — find the first array value
    let scoredArray: any[] = [];
    if (Array.isArray(parsed)) {
      scoredArray = parsed;
    } else if (parsed.topics && Array.isArray(parsed.topics)) {
      scoredArray = parsed.topics;
    } else {
      // Search all top-level keys for an array
      for (const key of Object.keys(parsed)) {
        if (Array.isArray(parsed[key]) && parsed[key].length > 0) {
          scoredArray = parsed[key];
          break;
        }
      }
    }

    if (scoredArray.length === 0) {
      console.warn("[ContentPipeline] Scoring: LLM returned no topics array, keys:", Object.keys(parsed));
      throw new Error("No topics array found in LLM scoring response");
    }

    console.log(`[ContentPipeline] Scoring: LLM returned ${scoredArray.length} scored topics`);
    return scoredArray.slice(0, 4) as ScoredTopic[];
  } catch (err) {
    console.error("[ContentPipeline] Scoring failed:", err);
    // Fallback: return first 5 as-is with default scores
    return candidates.slice(0, 4).map((t) => ({
      title: t.title,
      summary: "AI news update",
      source: t.source,
      url: t.url,
      scores: {
        shareability: 5,
        saveWorthiness: 5,
        debatePotential: 5,
        informationGap: 5,
        personalImpact: 5,
        total: 70,
      },
    }));
  }
}

function deduplicateTopics(topics: RawTopic[]): RawTopic[] {
  const seen: string[] = [];
  return topics.filter((t) => {
    const norm = normalizeTitle(t.title);
    if (seen.some((s) => titleOverlap(norm, s))) return false;
    seen.push(norm);
    return true;
  });
}

// ─── Stage 4: GPT-4o Web Search Deep Research ────────────────────────────────

/**
 * Research each topic using GPT-4o with web search (OpenAI Responses API).
 * Returns verified summaries with live citations — no Perplexity key needed.
 * Falls back to invokeLLM (Gemini) if OpenAI key not configured.
 */
export async function researchTopics(
  topics: ScoredTopic[],
  _perplexityApiKey?: string, // kept for API compatibility, no longer used
  runId?: number, // for progress tracking
): Promise<ResearchedTopic[]> {
  const openAiKey = process.env.OPENAI_API_KEY;

  // ── PARALLEL RESEARCH: all 4 topics concurrently ──
  // Each topic does GPT-4o web search (~15s) + Marketing Brain (~10s) = ~25s per topic.
  // Sequential: 4 × 25s = 100s. Parallel: ~25s. Saves ~75 seconds.
  console.log(`[ContentPipeline] Researching ${topics.length} topics in PARALLEL...`);
  const startMs = Date.now();

  // Track per-topic completion for progress updates
  let completedCount = 0;
  const total = topics.length;
  if (runId) await updateProgress(runId, `Researching 0/${total} topics...`);

  const settled = await Promise.allSettled(
    topics.map(async (topic, idx) => {
      try {
        const result = openAiKey
          ? await researchWithGPT4oWebSearch(topic, openAiKey)
          : await researchWithGPT(topic);
        completedCount++;
        if (runId) await updateProgress(runId, `Researched ${completedCount}/${total}: ${topic.title.slice(0, 50)}...`);
        return result;
      } catch (err) {
        console.error(`[ContentPipeline] Research failed for "${topic.title}":`, err);
        if (runId) await updateProgress(runId, `Research failed for "${topic.title.slice(0, 40)}" — retrying with fallback...`);
        // Fallback to Gemini (no web search)
        const fallback = await researchWithGPT(topic);
        completedCount++;
        if (runId) await updateProgress(runId, `Researched ${completedCount}/${total} (fallback): ${topic.title.slice(0, 50)}...`);
        return fallback;
      }
    })
  );

  const results: ResearchedTopic[] = [];
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    if (result.status === "fulfilled") {
      results.push(result.value);
    } else {
      // Both GPT-4o and Gemini failed — use minimal fallback
      console.error(`[ContentPipeline] All research methods failed for "${topics[i].title}": ${result.reason}`);
      if (runId) await updateProgress(runId, `⚠️ All research failed for "${topics[i].title.slice(0, 40)}" — using minimal fallback`);
      results.push({
        title: topics[i].title,
        headline: topics[i].title.slice(0, 80),
        summary: topics[i].summary,
        citations: [],
        videoPrompt: "Cinematic shot of a futuristic AI interface with glowing data streams, clean minimal design, 4K quality",
        verified: false,
      });
    }
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  if (runId) await updateProgress(runId, `Research complete: ${results.length} topics in ${elapsed}s`);
  console.log(`[ContentPipeline] Research complete: ${results.length} topics in ${elapsed}s (parallel)`);
  return results;
}

async function researchWithGPT4oWebSearch(
  topic: ScoredTopic,
  apiKey: string
): Promise<ResearchedTopic> {
  // Inject today's date and 15-day cutoff for strict recency bias
  const today = new Date();
  const todayStr = today.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const cutoffDate = new Date(today.getTime() - 15 * 24 * 60 * 60 * 1000);
  const cutoffStr = cutoffDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  // OpenAI Responses API with built-in web_search_preview tool
  // 60s timeout — GPT-4o web search is the slowest call in the pipeline
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: ENV.openaiModel,
      tools: [{ type: "web_search_preview" }],
      input: `Today is ${todayStr}. Research this AI news topic using web search.

CRITICAL RECENCY RULE: Only use sources and information published AFTER ${cutoffStr} (last 15 days). If you cannot find recent sources on this topic, say so clearly — do NOT use older articles or background information as if it were current news.

TONE GUIDANCE: This page has a dry, occasionally sarcastic voice. If the story has an obvious irony, a tech-world punchline everyone is already thinking, or something genuinely absurd, you can lean into that with a wry headline or insightLine. Keep it subtle — a smirk, not a joke. Not every slide needs to be funny. Serious stories stay serious.

Provide a JSON response with:
1. headline: Write an ALL-CAPS Instagram headline (max 12 words). VARIETY IS KEY — rotate between these styles: (a) Straight news: "OPENAI JUST RELEASED GPT-5 — HERE'S WHAT IT DOES" (b) Provocative/curiosity: "THIS 20-YEAR-OLD BUILT AN AI THAT EXPOSES CORRUPTION" (c) Stakes/consequence: "THIS AI UPDATE WILL ACTUALLY AFFECT YOUR JOB" (d) Question: "DID GOOGLE JUST KILL SEARCH?" — NOT every headline should be hyperbolic. Match the tone to the story. Use specific names/numbers/facts.
2. summary: 1-2 sentence plain-English explanation of what JUST happened and why it matters. This text will appear on the slide below the headline, so make it concise and informative — help the reader understand the story at a glance. Think newsletter bullet point, not essay.
3. insightLine: OPTIONAL. A single plain-English sentence (max 80 characters) that makes someone want to SCREENSHOT and SHARE this slide. It should connect the story to the READER'S life or something they personally care about. GOOD examples: "This means your job interview might be with an AI next year", "Google spent $30B on this and OpenAI did it for free", "Your phone is about to get a LOT smarter". BAD examples (generic, not share-worthy): "This is an interesting development in AI", "Many experts are watching this closely". ONLY include this if the headline alone is cryptic or incomplete. Return null if the headline is self-explanatory. Can be dry/wry if the story warrants it.
4. videoPrompt: Cinematic image/video prompt for AI image generation. CRITICAL: This prompt MUST be directly and specifically about THIS story. The viewer should immediately recognize what company/story it's about from the COLORS and CONTEXT alone. IMPORTANT LIMITATIONS — AI image generators CANNOT accurately render real people's faces or company logos. Your prompt MUST work around this: For PEOPLE → show silhouettes, from-behind shots, hands, or symbolic objects (NOT faces). For COMPANIES → use their BRAND COLORS as identifiers: OpenAI=green/white, Google=red/blue/yellow/green, Meta=blue, Anthropic=orange/brown, Apple=silver/white, Microsoft=4-color. For PRODUCTS → show a phone/laptop screen glowing in brand colors from a distance. Rules: photorealistic, cinematic, vertical 9:16 frame, ABSOLUTELY NO TEXT OR READABLE CHARACTERS, NO faces, NO accurate logos. Examples: ChatGPT story → "Close-up of a hand hovering over a phone glowing green (OpenAI brand), about to tap delete, dramatic lighting". Elon Musk AI story → "Silhouette of a man seen from behind at a futuristic control panel, screens glowing white and black (xAI colors), cinematic lighting". Factory robots → "Humanoid robots on a factory line, sparks flying, photorealistic wide shot".
5. sources: array of {title, url} for the top 2-3 sources you found (must be from after ${cutoffStr})

Topic: "${topic.title}"

Respond ONLY with valid JSON matching: { "headline": "...", "summary": "...", "insightLine": "..." or null, "videoPrompt": "...", "sources": [{"title": "...", "url": "..."}] }`,
    }),
    signal: AbortSignal.timeout(120_000), // 2 min timeout for GPT-4o deep research (web search + synthesis)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`GPT-4o web search error: ${response.status} — ${errText}`);
  }

  const data = await response.json() as any;

  // Extract text from Responses API output array
  const outputItems: any[] = data?.output ?? [];
  const textItem = outputItems.find((o: any) => o.type === "message");
  const rawText: string = textItem?.content?.[0]?.text ?? "{}";

  // Parse JSON
  let parsed: any = {};
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
  } catch {
    console.warn("[ContentPipeline] Could not parse GPT-4o JSON, using raw text");
  }

  // Extract URL citations from web search annotations
  const citations: { source: string; url: string }[] = [];
  for (const item of outputItems) {
    if (item.type === "message") {
      for (const block of (item.content ?? [])) {
        for (const ann of (block.annotations ?? [])) {
          if (ann.type === "url_citation" && ann.url) {
            try {
              citations.push({ source: new URL(ann.url).hostname.replace("www.", ""), url: ann.url });
            } catch { /* skip invalid URLs */ }
          }
        }
      }
    }
  }

  // Also include explicitly listed sources from the model
  for (const s of (parsed.sources ?? [])) {
    if (s.url && !citations.find((c) => c.url === s.url)) {
      citations.push({ source: s.title ?? s.url, url: s.url });
    }
  }

  const headline = parsed.headline ?? extractHeadline(rawText, topic.title);
  const summary = parsed.summary ?? extractSummary(rawText);

  // If the LLM already provided a specific videoPrompt, run it through the Marketing Brain
  // to ensure it meets quality standards. If it's missing, generate one from scratch.
  const rawVideoPrompt: string = parsed.videoPrompt ?? "";
  // Expanded generic prompt detection — catches all the common cliché patterns
  const lower = rawVideoPrompt.toLowerCase();
  const GENERIC_PATTERNS = [
    "futuristic ai interface", "glowing data streams", "server room",
    "neural network visualization", "holographic", "floating interface",
    "abstract neural", "glowing circuits", "digital brain",
    "person in a suit", "businessman at a desk", "generic robot",
    "random letter", "a man standing", "a woman standing",
    "tech professional", "data flowing", "binary code",
    // Face/portrait patterns — AI generators can't render real people
    "portrait of", "close-up of his face", "close-up of her face",
    "looking directly at camera", "facial expression",
  ];
  const isGenericPrompt = !rawVideoPrompt || GENERIC_PATTERNS.some(p => lower.includes(p));

  // ALWAYS run through Marketing Brain to ensure maximum specificity
  // Even non-generic prompts benefit from the Marketing Brain's quality pass
  let videoPrompt: string;
  if (isGenericPrompt) {
    console.log(`[MarketingBrain] Prompt was generic — generating hyper-specific prompt for: "${headline}"`);
  } else {
    console.log(`[MarketingBrain] Quality pass on prompt for: "${headline}"`);
  }
  videoPrompt = await marketingBrainPrompt({
    headline,
    summary,
    research: rawText,
    isVideo: false, // will be overridden per-slide based on isVideoSlide flag
  });

  const insightLine: string | undefined = typeof parsed.insightLine === "string" && parsed.insightLine.trim().length > 5
    ? parsed.insightLine.trim().slice(0, 200)
    : undefined;

  console.log(`[ContentPipeline] GPT-4o researched "${topic.title}" — ${citations.length} citations${insightLine ? " (has insight line)" : ""}`);

  return {
    title: topic.title,
    headline,
    summary,
    insightLine,
    citations: citations.slice(0, 4),
    videoPrompt,
    verified: citations.length >= 1 || rawText.length > 200,
  };
}

async function researchWithGPT(topic: ScoredTopic): Promise<ResearchedTopic> {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: "You are an AI news content writer for Instagram. Write accurate, engaging content about AI news for business owners and general consumers.",
      },
      {
        role: "user",
        content: `Write content for an Instagram carousel slide about this AI news topic.

Topic: "${topic.title}"
Context: ${topic.summary}

TONE GUIDANCE: The page has a dry, occasionally sarcastic voice. If the story is genuinely surprising, ironic, or has an obvious punchline that the tech world is already laughing about, you can lean into that with a wry headline or insightLine. Keep it subtle — a smirk, not a punchline. Not every slide needs to be funny. If the story is serious or straightforward, keep it straight.

Provide:
1. headline: An ALL-CAPS headline (max 12 words). VARY the tone — sometimes straight news ("OPENAI JUST RELEASED GPT-5"), sometimes provocative ("THIS AI UPDATE WILL ACTUALLY AFFECT YOUR JOB"), sometimes a question ("DID GOOGLE JUST KILL SEARCH?"). Match tone to story. Use specific names/numbers.
2. summary: 1-2 sentence plain-English explanation of what happened and why it matters. This appears on the slide below the headline — keep it concise and informative, like a newsletter bullet point.
3. insightLine: OPTIONAL. A single plain-English sentence (max 12 words) giving the viewer the key "aha" context they need. ONLY include if the headline is cryptic or incomplete — return null if self-explanatory. Can be dry/wry if the story warrants it.
4. videoPrompt: A cinematic image/video prompt for AI image generation. CRITICAL: Must be directly about THIS story. IMPORTANT: AI generators CANNOT render real faces or accurate logos. Use BRAND COLORS as identifiers (OpenAI=green/white, Google=red/blue/yellow/green, Meta=blue, Anthropic=orange/brown). For people: show silhouettes, from-behind shots, hands — NEVER faces. For companies: use brand-colored glowing objects/scenes. Photorealistic, cinematic, vertical 9:16 frame, NO TEXT, NO faces, NO logos. Example: ChatGPT story → "Hand hovering over a phone glowing green (OpenAI brand), about to tap delete, dramatic lighting".

Format as JSON: { "headline": "...", "summary": "...", "insightLine": "..." or null, "videoPrompt": "..." }`,
      },
    ],
    // Use json_object instead of strict json_schema — strict mode causes hangs with gpt-4.1
    response_format: { type: "json_object" },
  });

  const rawContent = response?.choices?.[0]?.message?.content;
  const content = typeof rawContent === "string" ? rawContent : "{}";
  const parsed = JSON.parse(content);

  const insightLine: string | undefined = typeof parsed.insightLine === "string" && parsed.insightLine.trim().length > 5
    ? parsed.insightLine.trim().slice(0, 200)
    : undefined;

  const headline = parsed.headline ?? topic.title;
  const summary = parsed.summary ?? topic.summary;

  // ALWAYS run through Marketing Brain on the fallback path — no web search context means
  // the LLM-generated videoPrompt is likely generic. Marketing Brain adds specificity.
  console.log(`[MarketingBrain] GPT fallback path — generating hyper-specific prompt for: "${headline}"`);
  const videoPrompt = await marketingBrainPrompt({
    headline,
    summary,
    research: topic.summary,
    isVideo: false,
  });

  return {
    title: topic.title,
    headline,
    summary,
    insightLine,
    citations: [],
    videoPrompt,
    verified: false, // GPT fallback — not externally verified
  };
}

function extractHeadline(content: string, fallback: string): string {
  const lines = content.split("\n").filter((l) => l.trim());
  // Look for a short line that looks like a headline
  for (const line of lines) {
    const clean = line.replace(/^[#*\d.\s]+/, "").trim();
    if (clean.length > 5 && clean.length < 80 && !clean.includes("http")) {
      return clean;
    }
  }
  return fallback.slice(0, 80);
}

function extractSummary(content: string): string {
  const sentences = content.split(/[.!?]/).filter((s) => s.trim().length > 20);
  return sentences.slice(0, 2).join(". ").trim() + ".";
}

/**
 * Marketing Brain — the "Head of Viral Marketing" agent.
 *
 * Receives the full story context (headline, summary, research text) and generates
 * a hyper-specific, visually compelling image/video prompt. The agent is instructed
 * to reason explicitly about WHO and WHAT is in the story before writing the prompt.
 *
 * Rules:
 * - MUST name the actual company, person, product, or event
 * - MUST be immediately recognizable as THIS story from the visual alone
 * - MUST be cinematic, photorealistic, vertical 9:16 frame, no text overlays
 * - SHOULD be somewhat comedic, viral, or emotionally engaging where appropriate
 * - MUST NOT use generic AI/robot/server room scenes unless the story is literally about that
 */
async function marketingBrainPrompt({
  headline,
  summary,
  research,
  isVideo,
}: {
  headline: string;
  summary: string;
  research: string;
  isVideo: boolean;
}): Promise<string> {
  const mediaType = isVideo
    ? "5-second cinematic video clip (Kling AI text-to-video)"
    : "single photorealistic still image (DALL-E 3 / Google Imagen)";

  // Import enhanced specificity rules from virality framework
  let marketingEnhancement = "";
  try {
    const { MARKETING_BRAIN_ENHANCEMENT } = await import("./viralityFramework");
    marketingEnhancement = "\n\n" + MARKETING_BRAIN_ENHANCEMENT;
  } catch { /* framework not available — use base prompt */ }

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are the Head of Viral Marketing at a top-tier AI news Instagram page with 4 million followers (@evolving.ai / @airesearches style). Your ONE job is to write the perfect visual prompt for a ${mediaType} that will make people stop scrolling.

Your creative philosophy:
- Every visual must be IMMEDIATELY recognizable as THIS specific story — not a generic AI scene
- You think in terms of: what is the MOST OBVIOUS, VISCERAL, FUNNY, or DRAMATIC visual that represents this story?
- You identify stories by BRAND COLORS, PRODUCTS, and CONTEXT — not by trying to draw faces or logos
- You think like a meme creator and a cinematographer at the same time
- You are somewhat comedic and irreverent when the story warrants it (not forced)
- You always ask yourself: "If I saw this image/video, would I IMMEDIATELY know what company/story it's about?"

IMAGE GENERATION CAPABILITIES (2026):
- Nano Banana (Gemini) CAN generate recognizable named public figures (tested & confirmed: Elon Musk, Tim Cook, Sam Altman, Sundar Pichai, Jensen Huang)
- DALL-E 3 is for environments ONLY (zero people)
- No model can render accurate company logos — we composite real PNGs separately
- No model can render readable text — we overlay text in post-production

For person_composite slides: describe the ACTUAL PERSON by name with full detail (expression, pose, lighting, clothing, environment).
For cinematic_scene slides: NO PEOPLE in the prompt — pure environment.
For PRODUCTS: show a phone/laptop screen from a distance with the right color scheme glowing.

MANDATORY PROMPT STRUCTURE (10-Part Framework) — every prompt MUST include ALL of these:
1. SUBJECT: Main focus, specific and named (e.g., "Sam Altman, CEO of OpenAI, in his signature grey crewneck")
2. ACTION & CONTEXT: What is happening — the narrative moment (e.g., "leaning forward mid-argument")
3. ENVIRONMENT: Specific location (e.g., "a glass-walled boardroom overlooking a neon-lit Tokyo skyline at night")
4. MOOD & STORY: Emotional tone tied to the story (e.g., "corporate thriller tension, billion-dollar gamble")
5. VISUAL STYLE: Artistic reference (e.g., "Christopher Nolan cinematography", "Blade Runner 2049 aesthetic")
6. LIGHTING & COLOR: 2+ light sources with colors (e.g., "warm Rembrandt lighting from left, soft cyan rim light on shoulders, deep shadows on right")
7. CAMERA & COMPOSITION: Shot type + lens + angle (e.g., "three-quarter shot, 85mm f/1.8, low angle looking up")
8. DETAIL & TEXTURE: Materials, surfaces, fabrics (e.g., "rain-slicked concrete, brushed steel desk, crisp wool suit")
9. QUALITY & REALISM: "ultra-photorealistic, editorial quality, 8K detail, RAW photograph look"
10. NEGATIVE CONSTRAINTS: What to exclude ("no text, no logos, no blurry elements")

Technical requirements:
- Ultra-photorealistic, editorial, high-fashion magazine quality
- Vertical 9:16 portrait frame (1024×1792, cropped to 4:5 for Instagram) — place ALL important subjects in the CENTER 60% of the frame so nothing is lost when top/bottom are cropped
- ABSOLUTELY NO TEXT in the image — no letters, no words, no numbers, no readable characters of any kind. Any text must be completely blurred, out-of-focus, or abstracted into illegible marks.
- NEVER describe a scene that shows a document, resume, paper, or screen with readable text content — show the EMOTION or CONSEQUENCE instead
- Use specific lens/aperture directives (85mm f/1.8 for portraits, 35mm f/2.8 for environments, 24mm for epic wide shots)
- Use named lighting recipes (Rembrandt, volumetric god rays, golden hour, neon rim light, teal-and-orange grade)
- Avoid keyword soup ("8k, masterpiece, ultra-detailed") — instead describe HOW elements interact with light and space
- For videos: describe camera movement, action, and duration (5 seconds). Include DYNAMIC camera movements: slow push-in, dolly zoom, parallax shifts, rotating orbit shots, or dramatic reveal movements. The video must have VISIBLE MOTION — never a static image.
- For images: describe the exact scene with all 6 structure elements above

NEGATIVE PROMPT AWARENESS — your prompt must NOT produce:
- Blurry or out-of-focus results
- Over-smoothed poreless skin (uncanny valley)
- Generic stock photo compositions
- CGI or illustration aesthetic
- Beauty filter look${marketingEnhancement}`,
      },
      {
        role: "user",
        content: `Write the visual prompt for this AI news story.

Headline: ${headline}
Summary: ${summary}
Research context: ${research.slice(0, 800)}

Step 1 — Identify the key subject:
Who or what is this story ACTUALLY about? Name the specific company, person, product, or event. Be EXTREMELY specific — if it's about a CEO, name them and describe their appearance. If it's about a product, name it and describe its logo/interface.

Step 2 — What is the MOST OBVIOUS visual?
What would a meme creator, a movie director, or a viral content creator immediately think of when they hear this story? Think of the image that would make someone say "oh I know exactly what this is about" without reading any headline.

Step 3 — Write the prompt:
Write a single paragraph describing the ${mediaType}. Be hyper-specific. Name the actual subject. Make it cinematic and emotionally resonant.

THE RECOGNITION TEST: Could someone see ONLY this image (no headline) and guess which AI story it's about? If not, your prompt is too generic. Rewrite it.

Examples of GOOD prompts (notice: specific settings, camera specs, lighting recipes):
- "Glass-walled startup office overlooking rain-streaked city lights. Close-up shot, 85mm f/1.8, eye level. A hand hovering over a phone screen glowing vivid green (OpenAI brand), finger about to tap a pulsing delete button, shallow depth of field blurring the city behind. Warm Rembrandt lighting from the left, soft green spill from the screen onto the fingers, deep shadows on the desk. Teal-and-orange cinematic grade, tension, corporate thriller mood. Ultra-photorealistic, editorial quality, 8K detail"
- "Dark industrial amphitheater, dramatic fog and blue volumetric light shafts. Cinematic wide shot, 24mm f/2.8, low angle. Silhouette of a suited figure at a podium seen from behind, massive screen behind glowing deep blue-and-white (Palantir brand colors), packed audience illuminated only by screen glow. Hard directional backlight creating rim highlights on the figure's shoulders. Cold blue-steel palette, power and gravitas, Blade Runner 2049 aesthetic. Ultra-photorealistic, editorial, 8K"
- "A 3D-rendered green-and-white luminous orb (OpenAI brand) mid-shatter, fragments suspended in slow motion over a dark cliff edge into pure void. Extreme close-up, 100mm macro, shallow DOF. Volumetric god rays piercing through the cracks from above, jade green light bleeding outward. Cinematic dark palette with electric green accents, catastrophic beauty, Christopher Nolan scale. Ultra-photorealistic, 8K detail"
- "Two massive glowing spheres — vivid green (OpenAI) and a quad-color (red, blue, yellow, green — Google) — face each other across a polished obsidian chess board in a dark cathedral-like space. Medium shot, 50mm f/2.0, eye level. Opposing neon rim lights (green left, multicolor right) with volumetric haze between. Electric tension, competitive drama, teal-and-orange cinematic grade. Ultra-photorealistic, editorial, 8K"

Examples of BAD prompts (auto-reject these):
- "Sam Altman with brown curly hair and glasses" — AI generators CANNOT render real faces
- "The OpenAI logo on a screen" — AI generators CANNOT render accurate logos
- "A futuristic AI interface with glowing data streams" — GENERIC, no story
- "A person in a suit looking at a screen" — No identifying context
- "An abstract neural network with blue nodes" — CLICHÉ
- "8k, masterpiece, ultra-detailed, best quality" — keyword soup, no real description

CRITICAL REMINDER: The final prompt must contain ZERO readable text. If your story involves a document, resume, paper, or screen — describe the emotional scene around it, not the document itself.

Return ONLY the prompt, no explanation, no preamble, no step labels.`,
      },
    ],
  });

  const raw = response?.choices?.[0]?.message?.content;
  const text = typeof raw === "string" ? raw.trim() : "";
  return text || `Dramatic cinematic scene directly depicting: ${headline}, ultra-photorealistic, editorial quality, 85mm f/1.8, warm Rembrandt lighting, teal-and-orange cinematic grade, vertical 9:16 portrait frame with subjects centered in middle 60 percent, 8K detail, no text overlays`;
}

/**
 * Generate a single DALL-E 3 image prompt that visually synthesizes all 5 topic headlines
 * into one cinematic cover scene. Used for the cover slide (index 0).
 */
async function generateCoverImagePrompt(headlines: string[]): Promise<string> {
  // NOTE: This is a FALLBACK — only called when the Creative Director's scenePrompt is empty.
  // With the 2.0 pipeline, the CD should always provide scenePrompt via the creative brief.
  // This generates a DALL-E 3 background prompt (no people — people are handled by Nano Banana).
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: "You create stunning, cinematic BACKGROUND image prompts for DALL-E 3. Each prompt describes a dramatic environment or scene that will be used as a BACKGROUND for a multi-layer composition where people and logos are composited ON TOP. The scene should be visually striking but leave room for foreground elements.",
      },
      {
        role: "user",
        content: `Create a SCROLL-STOPPING background scene for the cover slide of an Instagram AI news carousel. This will be the BACKGROUND LAYER — people and logos will be composited on top.

This week's AI topics:
${headlines.map((h, i) => `${i + 1}. ${h}`).join("\n")}

BACKGROUND COMPOSITION — this is NOT the final image, it's the backdrop:
The background should set the MOOD and ATMOSPHERE for the stories. Think movie poster backgrounds.

GOOD BACKGROUNDS:
- Dramatic storm clouds over a neon-lit city skyline at dusk (tension, disruption)
- A massive stage with spotlights piercing fog, empty podium (competition, announcements)
- Cracked earth splitting open with light bursting from below (upheaval, change)
- A sleek glass corridor with reflections of multiple screens showing data (tech power)
- An arena with dramatic overhead lighting and fog (battle, rivalry)

BAD BACKGROUNDS (banned):
- Server rooms, data centers, server racks
- Generic glowing circuits or motherboards
- Abstract floating data/code streams
- Plain office/boardroom interiors

STYLE:
- Hyper-cinematic: dramatic lighting, volumetric rays, depth of field
- Color palette: deep blacks, neon electric blue, warm gold, high contrast
- Composition: leave CENTER and LOWER areas open for people/text overlay
- 9:16 vertical portrait orientation
- NO text, NO logos, NO people in the background — those are added separately
- Photorealistic, 8K quality

Return ONLY the image prompt, no explanation.`,
      },
    ],
  });

  const raw = response?.choices?.[0]?.message?.content;
  const text = typeof raw === "string" ? raw : "";
  return text.trim() ||
    "Hyper-cinematic 8K vertical portrait background: a massive open-air arena at night, dramatic overhead spotlights piercing through fog and rain, neon blue and gold light rays cutting through storm clouds, a distant city skyline glowing on the horizon, wet reflective ground in the foreground catching the light, volumetric god rays, depth of field, anamorphic lens flare, center area left open for subject compositing, rule of thirds, photorealistic hyperdetailed";
}

// ─── Stage 5: Video / Image Generation ──────────────────────────────────────
// Primary: Kling 2.5 Turbo (text-to-video, ~$0.14/clip)
// Fallback: DALL-E 3 / Imagen (free, built-in, still image)

/** Generate a JWT token for Kling API authentication (ESM-native jose) */
async function generateKlingJWT(accessKey: string, secretKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: accessKey, nbf: now - 5 })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(now + 1800)
    .sign(new TextEncoder().encode(secretKey));
}

/**
 * Generate a 5-second video clip using Kling 2.5 Turbo API.
 * Returns the video URL on success, null on failure.
 */
export async function generateKlingVideo(
  prompt: string,
  accessKey: string,
  secretKey: string
): Promise<string | null> {
  try {
    const token = await generateKlingJWT(accessKey, secretKey);
    const baseUrl = "https://api-singapore.klingai.com";

    // Submit task (30s timeout)
    const submitRes = await fetch(`${baseUrl}/v1/videos/text2video`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        model_name: "kling-v2-5-turbo",
        prompt,
        negative_prompt: "text, watermark, blurry, low quality, distorted, looping, repetitive motion",
        cfg_scale: 0.5,
        mode: "pro",  // "pro" produces more coherent, non-repetitive motion vs "std"
        duration: "5",  // kling-v2-5-turbo only supports 5s; 8s returns error 1201
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!submitRes.ok) {
      const err = await submitRes.text();
      throw new Error(`Kling submit error ${submitRes.status}: ${err}`);
    }

    const submitData = await submitRes.json() as any;
    if (submitData.code !== 0) throw new Error(`Kling error: ${submitData.message}`);
    const taskId = submitData.data?.task_id;
    if (!taskId) throw new Error("No task_id returned from Kling");

    console.log(`[ContentPipeline] Kling task submitted: ${taskId}`);

    // Poll for completion (max 4 minutes, every 8 seconds)
    const maxAttempts = 30;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 8000));

      // Refresh JWT for each poll (avoid expiry)
      const pollToken = await generateKlingJWT(accessKey, secretKey);
      const pollRes = await fetch(`${baseUrl}/v1/videos/text2video/${taskId}`, {
        headers: { "Authorization": `Bearer ${pollToken}` },
        signal: AbortSignal.timeout(15_000), // 15s per poll attempt
      });

      if (!pollRes.ok) continue;
      const pollData = await pollRes.json() as any;
      const status = pollData.data?.task_status;

      if (status === "succeed") {
        const videoUrl = pollData.data?.task_result?.videos?.[0]?.url;
        if (videoUrl) {
          console.log(`[ContentPipeline] Kling video ready: ${videoUrl}`);
          return videoUrl;
        }
      }
      if (status === "failed") {
        throw new Error(`Kling task failed: ${pollData.data?.task_status_msg ?? "unknown"}`);
      }

      console.log(`[ContentPipeline] Kling polling... attempt ${i + 1}/${maxAttempts} (status: ${status})`);
    }

    throw new Error("Kling task timed out after 4 minutes");
  } catch (err) {
    console.error("[ContentPipeline] Kling video generation failed:", err);
    return null;
  }
}

/**
 * Generate a 5-second video from a starting image using Kling 2.5 Turbo (image-to-video).
 * The image provides the first frame; Kling adds cinematic motion.
 * Returns the video URL on success, null on failure.
 */
export async function generateKlingImageToVideo(
  prompt: string,
  imageUrl: string,
  accessKey: string,
  secretKey: string
): Promise<string | null> {
  try {
    const token = await generateKlingJWT(accessKey, secretKey);
    const baseUrl = "https://api-singapore.klingai.com";

    const submitRes = await fetch(`${baseUrl}/v1/videos/image2video`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        model_name: "kling-v2-5-turbo",
        prompt,
        negative_prompt: "text, watermark, blurry, low quality, distorted",
        image: imageUrl,
        cfg_scale: 0.5,
        mode: "pro",
        duration: "5",
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!submitRes.ok) {
      const err = await submitRes.text();
      throw new Error(`Kling img2vid submit error ${submitRes.status}: ${err}`);
    }

    const submitData = await submitRes.json() as any;
    if (submitData.code !== 0) throw new Error(`Kling img2vid error: ${submitData.message}`);
    const taskId = submitData.data?.task_id;
    if (!taskId) throw new Error("No task_id returned from Kling img2vid");

    console.log(`[ContentPipeline] Kling img2vid task submitted: ${taskId}`);

    // Poll for completion (max 4 minutes, every 8 seconds)
    const maxAttempts = 30;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 8000));
      const pollToken = await generateKlingJWT(accessKey, secretKey);
      const pollRes = await fetch(`${baseUrl}/v1/videos/image2video/${taskId}`, {
        headers: { "Authorization": `Bearer ${pollToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!pollRes.ok) continue;
      const pollData = await pollRes.json() as any;
      const status = pollData.data?.task_status;
      if (status === "succeed") {
        const videoUrl = pollData.data?.task_result?.videos?.[0]?.url;
        if (videoUrl) {
          console.log(`[ContentPipeline] Kling img2vid ready: ${videoUrl}`);
          return videoUrl;
        }
      }
      if (status === "failed") {
        throw new Error(`Kling img2vid failed: ${pollData.data?.task_status_msg ?? "unknown"}`);
      }
      console.log(`[ContentPipeline] Kling img2vid polling... ${i + 1}/${maxAttempts} (${status})`);
    }
    throw new Error("Kling img2vid timed out after 4 minutes");
  } catch (err) {
    console.error("[ContentPipeline] Kling image-to-video failed:", err);
    return null;
  }
}

/**
 * Generate a cinematic still image using DALL-E 3.
 * Used as fallback when Kling is unavailable.
 */
export async function generateSlideImage(
  prompt: string
): Promise<string | null> {
  try {
    console.log(`[ContentPipeline] Generating Gemini image for prompt: "${prompt.slice(0, 80)}..."`);
    const { geminiGenerateImage } = await import("./geminiEngine");
    const log = (msg: string) => console.log(`[ContentPipeline] ${msg}`);
    const base64Uri = await geminiGenerateImage(prompt, log);
    // Convert base64 data URI to stored URL
    const base64Data = base64Uri.split(",")[1];
    const buf = Buffer.from(base64Data, "base64");
    const { url } = await storagePut(`slides/regen/img_${Date.now()}.png`, buf, "image/png");
    console.log(`[ContentPipeline] Gemini image generated → ${url}`);
    return url;
  } catch (err) {
    console.error("[ContentPipeline] Gemini image generation failed:", err);
    return null;
  }
}



// ─── Stage 7: Make.com Instagram Webhook ──────────────────────────────────────

/**
 * Trigger Make.com scenario to post the carousel to Instagram
 */
export async function triggerInstagramPost(
  runId: number,
  slides: Array<{ assembledUrl: string; headline: string; isVideo?: boolean }>,
  caption: string,
  makeWebhookUrl?: string
): Promise<boolean> {
  // Resolve webhook URL: env var takes priority, then DB-stored value
  let url = makeWebhookUrl;
  if (!url) {
    try {
      const db = await getDb();
      if (db) {
        const { appSettings } = await import("../drizzle/schema");
        const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "make_webhook_url"));
        if (row?.value) url = row.value;
      }
    } catch { /* ignore */ }
  }
  if (!url) {
    console.log("[ContentPipeline] Make.com webhook not configured — skipping Instagram post");
    return false;
  }

  /**
   * Make.com mixed-media carousel payload.
   * Each slide must have image_url, video_url, AND media_type so Make.com’s
   * Instagram Business module can handle both images and videos in a single carousel.
   * Reference: https://community.make.com/t/dynamic-mapping-video-or-image-on-instagram-carousel/43280
   *
   * IMPORTANT: Instagram carousel videos must be 4:5 aspect ratio (1080×1350).
   * Our slides are 1080×1920 (9:16). The Make.com scenario must crop/pad
   * video slides to 4:5 before calling the Instagram API.
   */
  // Convert relative /uploads/ URLs to absolute public URLs for Make.com
  // Make.com needs to download these files — relative paths won't work
  const RAILWAY_PUBLIC_URL = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : (process.env.PUBLIC_URL || `http://localhost:${ENV.port}`);

  const slidePayload = slides.map((s, i) => {
    const absoluteUrl = s.assembledUrl.startsWith("/uploads/")
      ? `${RAILWAY_PUBLIC_URL}${s.assembledUrl}`
      : s.assembledUrl;
    return {
      slide_index: i,
      media_type: s.isVideo ? "VIDEO" : "IMAGE",
      image_url: absoluteUrl,   // always set — Make.com uses this for IMAGE slides
      video_url: absoluteUrl,   // always set — Make.com uses this for VIDEO slides
      headline: s.headline,
    };
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        type: "carousel_post",
        instagram_page: "suggestedbygpt",
        run_id: runId,
        caption,
        slides: slidePayload,
        // Flat array of image URLs for Make.com — avoids map() function issues
        image_urls: slidePayload.map((s) => s.image_url),
        slide_count: slides.length,
        has_video: slides.some((s) => s.isVideo),
        posted_at: new Date().toISOString(),
      }),
    });
    if (!response.ok) {
      console.error(`[ContentPipeline] Make.com webhook returned ${response.status}: ${await response.text()}`);
    }
    return response.ok;
  } catch (err) {
    console.error("[ContentPipeline] Make.com webhook failed:", err);
    return false;
  }
}

/**
 * Generate the Instagram caption — algorithm-optimized for 2026.
 *
 * Instagram 2026 algorithm priorities:
 * 1. DM shares/sends (strongest signal for Explore distribution)
 * 2. Saves (long-term value signal)
 * 3. Caption dwell time (now tracked — longer captions = more value)
 * 4. Comment depth (replies >5 words = "high social relevance")
 * 5. Keyword-rich captions > hashtags for discoverability (30% more reach)
 *
 * Hashtag limit: 3-5 (Instagram Dec 2025 change — exceeding may reduce reach)
 */
export async function generateCaption(topics: ResearchedTopic[]): Promise<string> {
  const { CAPTION_SYSTEM_PROMPT, CAPTION_USER_PROMPT_TEMPLATE } = await import("./viralityFramework");

  const topicsList = topics.map((t, i) => `${i + 1}. ${t.headline}: ${t.summary || ""}`).join("\n");
  const userPrompt = CAPTION_USER_PROMPT_TEMPLATE.replace("{TOPICS}", topicsList);

  const response = await invokeLLM({
    messages: [
      { role: "system", content: CAPTION_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = response?.choices?.[0]?.message?.content;
  const text = typeof raw === "string" ? raw : "";
  return text.trim() ||
    "🚨 The AI world just shifted — and most people have no idea.\n\nThis week's updates aren't just incremental. They're the kind of changes that reshape entire industries overnight.\n\nFrom surprise product launches to breakthroughs that have researchers scrambling — this carousel covers the stories you can't afford to miss.\n\nSend this to someone who needs to stay ahead of AI 📩\nSave this for reference 🔖\n\nWhich story shocked you the most? Drop it in the comments 👇\n\nSwipe to see all the stories →\n\n#AINews #ArtificialIntelligence #MachineLearning #TechNews #FutureOfAI";
}

// ─── Main Pipeline Orchestrator ───────────────────────────────────────────────

export interface PipelineOptions {
  runSlot: "monday" | "friday";
  perplexityApiKey?: string;
  klingAccessKey?: string;
  klingSecretKey?: string;
  makeWebhookUrl?: string;
  requireAdminApproval?: boolean;
}

export async function runContentPipeline(options: PipelineOptions): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Create run record
  const runResult = await db.insert(contentRuns).values({
    runSlot: options.runSlot,
    status: "discovering",
  }).returning({ id: contentRuns.id });
  const runId = runResult[0].id;

  console.log(`[ContentPipeline] Started run #${runId} (${options.runSlot})`);

  try {
    // Stage 1: Discover topics
    await db.update(contentRuns).set({ status: "discovering", statusDetail: "Scanning NewsAPI + Reddit for AI topics..." }).where(eq(contentRuns.id, runId));
    const rawTopics = await discoverTopics(options.runSlot);

    await db.update(contentRuns).set({
      topicsRaw: JSON.stringify(rawTopics),
    }).where(eq(contentRuns.id, runId));

    // Stage 2: No-repeat filter
    const filtered = await filterNoRepeat(rawTopics);

    // Get recent published topics for exclusion list
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const recentPublished = await db
      .select()
      .from(publishedTopics)
      .where(gte(publishedTopics.publishedAt, cutoff));
    const exclusionList = recentPublished.map((t) => t.title);

    // Stage 3: GPT Scoring
    await db.update(contentRuns).set({ status: "scoring", statusDetail: "GPT scoring topics on virality criteria..." }).where(eq(contentRuns.id, runId));
    const scored = await scoreAndSelectTopics(filtered, exclusionList);

    await db.update(contentRuns).set({
      topicsShortlisted: JSON.stringify(scored),
      topicsSelected: JSON.stringify(scored),
    }).where(eq(contentRuns.id, runId));

    // If admin approval required, pause here
    if (options.requireAdminApproval) {
      await db.update(contentRuns).set({ status: "review" }).where(eq(contentRuns.id, runId));
      await notifyOwner({
        title: "Content Studio: Topics Ready for Review",
        content: `Your ${options.runSlot} carousel has 4 topics selected and is waiting for your approval. Open the Content Studio to review and approve.`,
      });
      console.log(`[ContentPipeline] Run #${runId} paused for admin approval`);
      return runId;
    }

    // Continue to research
    await continueAfterApproval(runId, scored, options);
    return runId;
  } catch (err: any) {
    await db.update(contentRuns).set({
      status: "failed",
      errorMessage: err?.message ?? "Unknown error",
    }).where(eq(contentRuns.id, runId));
    console.error(`[ContentPipeline] Run #${runId} failed:`, err);
    throw err;
  }
}

/** Maximum time a pipeline run is allowed before auto-failing (15 minutes) */
const PIPELINE_TIMEOUT_MS = 15 * 60 * 1000;

/** Per-slide maximum generation time (5 minutes) — must exceed Kling poll cycle (4 min) */
const SLIDE_TIMEOUT_MS = 5 * 60 * 1000;

export async function continueAfterApproval(
  runId: number,
  topics: ScoredTopic[],
  options: Omit<PipelineOptions, "runSlot" | "requireAdminApproval">
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // ── CREDIT SAFEGUARD: AbortController kills ALL pending work when timeout fires ──
  // The old Promise.race approach marked the DB as "failed" but left _runPipelineStages
  // still running in the background, making API calls and burning credits all night.
  // The AbortController propagates to all fetch() calls via the signal.
  const pipelineAbort = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  timeoutHandle = setTimeout(() => {
    console.error(`[ContentPipeline] ⛔ PIPELINE TIMEOUT — killing all pending work for run #${runId}`);
    pipelineAbort.abort(new Error(`Pipeline timed out after ${PIPELINE_TIMEOUT_MS / 60000} minutes — run #${runId} auto-failed`));
  }, PIPELINE_TIMEOUT_MS);

  try {
    await _runPipelineStages(runId, topics, options, db, pipelineAbort.signal);
  } catch (err: any) {
    // Abort any remaining work if we haven't already
    if (!pipelineAbort.signal.aborted) pipelineAbort.abort();
    await db.update(contentRuns).set({
      status: "failed",
      errorMessage: err?.message ?? "Unknown error",
    }).where(eq(contentRuns.id, runId));
    console.error(`[ContentPipeline] Run #${runId} failed:`, err?.message);
    throw err;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (!pipelineAbort.signal.aborted) pipelineAbort.abort(); // cleanup any stragglers
  }
}

/**
 * Generate a provocative, ALL-CAPS cover headline for the carousel.
 * Modelled after @airesearches and @evolving.ai — designed to stop scrolling.
 */
/**
 * Generate cover headline using curiosity-gap / FOMO hook formulas.
 * The cover slide carries ~80% of the carousel's weight — it must stop scrolling.
 *
 * Hook psychology exploited:
 * 1. Curiosity gap — hint without revealing (brain NEEDS closure)
 * 2. FOMO — "everyone else knows and you don't"
 * 3. Disbelief — "wait, that can't be real"
 * 4. Specificity — specific claims beat vague ones
 */
async function generateCoverHeadline(headlines: string[], slot: "monday" | "friday"): Promise<string> {
  const {
    COVER_HEADLINE_SYSTEM_PROMPT,
    COVER_HEADLINE_USER_PROMPT_TEMPLATE,
    COVER_HOOK_TEMPLATES,
  } = await import("./viralityFramework");

  try {
    // Pick 4 random templates to inspire the LLM (avoid repetition across runs)
    const shuffled = [...COVER_HOOK_TEMPLATES].sort(() => Math.random() - 0.5);
    const templateExamples = shuffled.slice(0, 4).join("\n- ");

    const userPrompt = COVER_HEADLINE_USER_PROMPT_TEMPLATE
      .replace("{HEADLINES}", headlines.map((h, i) => `${i + 1}. ${h}`).join("\n"))
      .replace("{TEMPLATES}", templateExamples);

    const response = await invokeLLM({
      messages: [
        { role: "system", content: COVER_HEADLINE_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });
    const raw = (response as any)?.choices?.[0]?.message?.content?.trim() ?? "";
    const headline = raw.replace(/^"|"$/g, "").replace(/^- /, "").trim().toUpperCase();
    if (headline && headline.length > 5) return headline;
  } catch (err) {
    console.warn("[ContentPipeline] Cover headline generation failed:", err);
  }
  // Fallback
  return slot === "friday" ? "AI JUST CHANGED EVERYTHING — HERE'S WHAT YOU MISSED THIS WEEK" : "THE BIGGEST AI STORIES OF THE WEEK — SWIPE TO SEE THEM ALL";
}

async function _runPipelineStages(
  runId: number,
  topics: ScoredTopic[],
  options: Omit<PipelineOptions, "runSlot" | "requireAdminApproval">,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  abortSignal?: AbortSignal,
): Promise<void> {
  try {
    // If topics array is empty, load from DB (handles case where UI sent empty array)
    let resolvedTopics = topics;
    if (!resolvedTopics || resolvedTopics.length === 0) {
      const [run] = await db.select().from(contentRuns).where(eq(contentRuns.id, runId));
      if (run?.topicsSelected) {
        resolvedTopics = JSON.parse(run.topicsSelected) as ScoredTopic[];
        console.log(`[ContentPipeline] Loaded ${resolvedTopics.length} topics from DB for run #${runId}`);
      }
    }
    if (!resolvedTopics || resolvedTopics.length === 0) {
      throw new Error("No topics available for research — run topic discovery first");
    }

    // ── Helper: bail if pipeline was aborted ──
    const checkAbort = () => {
      if (abortSignal?.aborted) {
        throw new Error(`Pipeline aborted: ${(abortSignal.reason as Error)?.message ?? "timeout"}`);
      }
    };

    // Stage 4: Deep Research
    checkAbort();
    await db.update(contentRuns).set({ status: "researching", statusDetail: "Starting deep research..." }).where(eq(contentRuns.id, runId));

    const researched = await researchTopics(resolvedTopics, options.perplexityApiKey, runId);

    // Ensure we have at least 3 topics after verification
    if (researched.length < 3) {
      throw new Error(`Only ${researched.length} topics passed verification (need at least 3)`);
    }


    // ═══════════════════════════════════════════════════════════════════════════
    // Stage 4.5 + 5 + 6: Gemini Creative Director → Media Generation → Assembly
    // Uses Google Gemini API for all media generation (replaces OpenAI CD + Kling + DALL-E)
    // ═══════════════════════════════════════════════════════════════════════════
    checkAbort();
    await updateProgress(runId, "Gemini Creative Director analyzing stories...");

    // Import Gemini engine and compositor
    const {
      geminiCreativeDirector: runGeminiCD,
      geminiGenerateImage,
      geminiGenerateVideo,
    } = await import("./geminiEngine");
    const {
      getCoverHtml,
      getContentHtml,
      getVideoOverlayHtml,
      compositeGeminiSlide,
      compositeGeminiVideo,
    } = await import("./geminiCompositor");

    // ── Stage 4.5: Gemini Creative Director ──
    const logWithProgress = (msg: string, data?: any) => {
      console.log(`[ContentPipeline] ${msg}`);
      updateProgress(runId, msg).catch(() => {});
    };

    let creativeBrief: Awaited<ReturnType<typeof runGeminiCD>>;
    try {
      creativeBrief = await runGeminiCD(researched, logWithProgress, checkAbort);
    } catch (cdErr: any) {
      console.error(`[ContentPipeline] Gemini CD failed: ${cdErr?.message}`);
      throw cdErr; // No fallback — Gemini CD is the only path now
    }

    // Persist the creative brief to DB for diagnosis
    try {
      await db.update(contentRuns)
        .set({ creativeBrief: JSON.stringify(creativeBrief) })
        .where(eq(contentRuns.id, runId));
      console.log(`[ContentPipeline] Creative brief persisted to DB (run #${runId})`);
    } catch (briefErr: any) {
      console.warn(`[ContentPipeline] Failed to persist brief: ${briefErr?.message}`);
    }

    // Create slide records from Gemini brief
    const validCoverHeadline = (creativeBrief.coverHeadline && creativeBrief.coverHeadline.trim().length > 0)
      ? creativeBrief.coverHeadline
      : "THE BIGGEST AI STORIES THIS WEEK";

    // Cover slide (index 0)
    await db.insert(generatedSlides).values({
      runId,
      slideIndex: 0,
      headline: validCoverHeadline,
      summary: creativeBrief.slides.map(s => s.headline).join(" • "),
      videoPrompt: creativeBrief.coverImagePrompt,
      isVideoSlide: 0,
      status: "pending",
    });

    // Pick one random content slide to be a video
    const videoSlideIndex = Math.floor(Math.random() * creativeBrief.slides.length);

    // Content slides (index 1-N)
    for (let i = 0; i < creativeBrief.slides.length; i++) {
      const slide = creativeBrief.slides[i];
      const slideIndex = i + 1;
      const validHeadline = (slide.headline && slide.headline.trim().length > 0)
        ? slide.headline
        : `AI NEWS STORY ${slideIndex}`;

      await db.insert(generatedSlides).values({
        runId,
        slideIndex,
        headline: validHeadline,
        summary: slide.summary,
        videoPrompt: slide.imagePrompt,
        isVideoSlide: i === videoSlideIndex ? 1 : 0,
        status: "pending",
      });
    }

    // ── Stage 5: Gemini Media Generation ──
    checkAbort();
    await db.update(contentRuns).set({ status: "generating", statusDetail: "Starting Gemini media generation..." }).where(eq(contentRuns.id, runId));
    const stageStart = Date.now();

    console.log(`[ContentPipeline] ═══ Stage 5: Gemini Media Generation ═══`);
    console.log(`[ContentPipeline] Cover image + ${creativeBrief.slides.length} content slides (1 video at index ${videoSlideIndex})`);

    // Generate cover image
    logWithProgress("Stage 5: Generating cover image...");
    const coverBase64 = await geminiGenerateImage(creativeBrief.coverImagePrompt, logWithProgress);

    // Generate content media (images + 1 video)
    const generatedMedia: Array<{ type: "image" | "video"; data: string | Buffer }> = [];
    generatedMedia.push({ type: "image", data: coverBase64 });

    for (let i = 0; i < creativeBrief.slides.length; i++) {
      checkAbort();
      const slide = creativeBrief.slides[i];

      if (i === videoSlideIndex) {
        logWithProgress(`Stage 5: Generating video for slide ${i + 1} (this takes a moment)...`);
        const videoResult = await geminiGenerateVideo(slide.imagePrompt, logWithProgress, checkAbort);
        if (videoResult.type === "video") {
          generatedMedia.push({ type: "video", data: videoResult.buffer });
        } else {
          // Fallback returned an image buffer
          const base64Data = `data:image/png;base64,${videoResult.buffer.toString("base64")}`;
          generatedMedia.push({ type: "image", data: base64Data });
          // Update DB — this slide is no longer video
          const slides = await db.select().from(generatedSlides).where(eq(generatedSlides.runId, runId));
          const matchSlide = slides.find(s => s.slideIndex === i + 1);
          if (matchSlide) {
            await db.update(generatedSlides).set({ isVideoSlide: 0 }).where(eq(generatedSlides.id, matchSlide.id));
          }
        }
      } else {
        logWithProgress(`Stage 5: Generating image for slide ${i + 1}...`);
        const slideBase64 = await geminiGenerateImage(slide.imagePrompt, logWithProgress);
        generatedMedia.push({ type: "image", data: slideBase64 });
      }
    }

    const stageElapsed = ((Date.now() - stageStart) / 1000).toFixed(1);
    console.log(`[ContentPipeline] ═══ Stage 5 Complete (${stageElapsed}s) ═══`);
    console.log(`[ContentPipeline] Generated: ${generatedMedia.filter(m => m.type === "image").length} images, ${generatedMedia.filter(m => m.type === "video").length} videos`);

    // ── Stage 6: HTML/CSS Compositing (Puppeteer + FFmpeg) ──
    checkAbort();
    await db.update(contentRuns).set({ status: "assembling", statusDetail: "Starting slide assembly..." }).where(eq(contentRuns.id, runId));
    console.log(`[ContentPipeline] ═══ Stage 6: Slide Assembly ═══`);

    const slidesForAssembly = await db.select().from(generatedSlides)
      .where(eq(generatedSlides.runId, runId))
      .orderBy(generatedSlides.slideIndex as any);

    let assemblySuccessCount = 0;

    for (let i = 0; i < slidesForAssembly.length; i++) {
      checkAbort();
      const slideRecord = slidesForAssembly[i];
      const media = generatedMedia[i];

      if (!media) {
        console.warn(`[ContentPipeline] No media for slide ${slideRecord.slideIndex} — skipping assembly`);
        await db.update(generatedSlides).set({ status: "ready" }).where(eq(generatedSlides.id, slideRecord.id));
        continue;
      }

      try {
        let finalBase64: string;

        if (slideRecord.slideIndex === 0) {
          // Cover slide
          logWithProgress(`Stage 6: Compositing cover slide...`);
          const coverHtml = getCoverHtml(media.data as string, slideRecord.headline ?? validCoverHeadline);
          finalBase64 = await compositeGeminiSlide(coverHtml);
        } else if (media.type === "video") {
          // Video content slide
          logWithProgress(`Stage 6: Compositing video overlay for slide ${slideRecord.slideIndex}...`);
          const overlayHtml = getVideoOverlayHtml(
            slideRecord.headline ?? "",
            slideRecord.summary ?? "",
          );
          finalBase64 = await compositeGeminiVideo(media.data as Buffer, overlayHtml);
        } else {
          // Image content slide
          logWithProgress(`Stage 6: Compositing image slide ${slideRecord.slideIndex}...`);
          const slideHtml = getContentHtml(
            media.data as string,
            slideRecord.headline ?? "",
            slideRecord.summary ?? "",
          );
          finalBase64 = await compositeGeminiSlide(slideHtml);
        }

        // Upload to storage (S3 bridge: base64 → public URL)
        const mimeType = media.type === "video" ? "video/mp4" : "image/png";
        const ext = media.type === "video" ? "mp4" : "png";
        const base64Data = finalBase64.split(",")[1];
        const buf = Buffer.from(base64Data, "base64");
        const { url } = await storagePut(`slides/${runId}/slide_${slideRecord.slideIndex}.${ext}`, buf, mimeType);

        // Update DB record
        if (media.type === "video") {
          await db.update(generatedSlides)
            .set({ videoUrl: url, assembledUrl: url, status: "ready" })
            .where(eq(generatedSlides.id, slideRecord.id));
        } else {
          await db.update(generatedSlides)
            .set({ assembledUrl: url, status: "ready" })
            .where(eq(generatedSlides.id, slideRecord.id));
        }
        assemblySuccessCount++;
        console.log(`[ContentPipeline] Slide ${slideRecord.slideIndex}: assembled → ${url.slice(0, 80)}...`);
      } catch (err: any) {
        console.error(`[ContentPipeline] Assembly failed for slide ${slideRecord.slideIndex}: ${err?.message}`);
        await db.update(generatedSlides).set({ status: "ready" }).where(eq(generatedSlides.id, slideRecord.id));
      }
    }

    await updateProgress(runId, `Assembly complete: ${assemblySuccessCount}/${slidesForAssembly.length} slides composed`);
    console.log(`[ContentPipeline] ═══ Stage 6 Complete: ${assemblySuccessCount}/${slidesForAssembly.length} slides ═══`);


    // Stage 7: Generate caption and wait for admin approval before posting
    checkAbort();
    console.log(`[ContentPipeline] Stage 7: Generating Instagram caption for run #${runId}`);
    const finalSlides = await db.select().from(generatedSlides)
      .where(eq(generatedSlides.runId, runId))
      .orderBy(generatedSlides.slideIndex as any);
    const caption = await generateCaption(researched);

    // Save caption and set status to pending_post — admin must approve before posting
    await db.update(contentRuns).set({
      instagramCaption: caption,
      status: "pending_post",
    }).where(eq(contentRuns.id, runId));

    // Notify owner that slides are ready for review
    await notifyOwner({
      title: `Content Studio: Carousel Ready for Review!`,
      content: `Run #${runId} slides are assembled and the caption is ready. Open Content Studio to preview and approve the post before it goes to Instagram.`,
    });

    console.log(`[ContentPipeline] Run #${runId} is pending_post — awaiting admin approval`);
  } catch (err: any) {
    await db.update(contentRuns).set({
      status: "failed",
      errorMessage: err?.message ?? "Unknown error",
    }).where(eq(contentRuns.id, runId));
    throw err;
  }
}
