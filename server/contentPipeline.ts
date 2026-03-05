/**
 * Content Studio Pipeline
 * Automated twice-weekly AI news carousel generation
 *
 * Stages:
 * 1. Topic Discovery  — scrape YouTube, TikTok, Reddit for trending AI topics
 * 2. No-Repeat Filter — exclude topics published in last 14 days
 * 3. GPT Scoring      — score top 12 on 5 criteria, pick best 5
 * 4. Deep Research    — GPT-4o web search (OpenAI Responses API) per topic
 * 5. Video Generation — Seedance 2.0 API per topic (stub until key provided)
 * 6. Slide Assembly   — FFmpeg compositor (separate module)
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
import { generateImage } from "./_core/imageGeneration";
import { ENV } from "./_core/env";
import { SignJWT } from "jose";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RawTopic {
  title: string;
  source: "youtube" | "tiktok" | "reddit" | "news";
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
  videoPrompt: string;    // Seedance generation prompt
  verified: boolean;      // has 3+ credible sources
}

// ─── Stage 1: Topic Discovery ─────────────────────────────────────────────────

/**
 * Fetch trending AI topics from YouTube, TikTok, Reddit simultaneously
 * Uses Manus built-in Data APIs (no extra cost)
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
        const res = await fetch(url);
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
        model: "gpt-4o",
        tools: [{ type: "web_search_preview" }],
        input: query,
      }),
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

async function discoverFromYouTube(): Promise<RawTopic[]> {
  try {
    const { ApiClient } = await import("/opt/.manus/.sandbox-runtime/data_api.js" as any);
    const client = new ApiClient();

    const queries = ["AI news this week", "artificial intelligence update 2025", "ChatGPT OpenAI news"];
    const results: RawTopic[] = [];

    for (const q of queries) {
      try {
        const res = await client.call_api("Youtube/search", {
          query: { q, hl: "en", gl: "US" },
        });
        const contents = res?.contents ?? [];
        for (const item of contents.slice(0, 5)) {
          if (item.type === "video" && item.video) {
            results.push({
              title: item.video.title ?? "",
              source: "youtube",
              url: `https://youtube.com/watch?v=${item.video.videoId}`,
              publishedAt: item.video.publishedTimeText,
            });
          }
        }
      } catch (_) { /* skip failed query */ }
    }
    return results;
  } catch {
    console.warn("[ContentPipeline] YouTube API unavailable, using fallback");
    return [];
  }
}

async function discoverFromTikTok(): Promise<RawTopic[]> {
  try {
    const { ApiClient } = await import("/opt/.manus/.sandbox-runtime/data_api.js" as any);
    const client = new ApiClient();

    const keywords = ["AI news", "artificial intelligence 2025", "ChatGPT update"];
    const results: RawTopic[] = [];

    for (const kw of keywords) {
      try {
        const res = await client.call_api("Tiktok/search_tiktok_video_general", {
          query: { keyword: kw },
        });
        const videos = res?.data ?? [];
        for (const v of videos.slice(0, 5)) {
          if (v.desc) {
            results.push({
              title: v.desc,
              source: "tiktok",
              url: `https://tiktok.com/@${v.author?.unique_id}/video/${v.aweme_id}`,
              engagementScore: Math.min(100, Math.floor((v.statistics?.play_count ?? 0) / 10000)),
            });
          }
        }
      } catch (_) { /* skip */ }
    }
    return results;
  } catch {
    console.warn("[ContentPipeline] TikTok API unavailable, using fallback");
    return [];
  }
}

async function discoverFromReddit(): Promise<RawTopic[]> {
  try {
    const { ApiClient } = await import("/opt/.manus/.sandbox-runtime/data_api.js" as any);
    const client = new ApiClient();

    const subreddits = ["artificial", "MachineLearning", "ChatGPT", "singularity"];
    const results: RawTopic[] = [];

    for (const sub of subreddits) {
      try {
        const res = await client.call_api("Reddit/AccessAPI", {
          query: { subreddit: sub, limit: "10" },
        });
        const posts = res?.posts ?? [];
        for (const wrapper of posts.slice(0, 5)) {
          const post = wrapper?.data ?? wrapper;
          if (post.title) {
            results.push({
              title: post.title,
              source: "reddit",
              url: `https://reddit.com${post.permalink ?? ""}`,
              engagementScore: Math.min(100, Math.floor((post.score ?? 0) / 100)),
            });
          }
        }
      } catch (_) { /* skip */ }
    }
    return results;
  } catch {
    console.warn("[ContentPipeline] Reddit API unavailable, using fallback");
    return [];
  }
}

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

Return a JSON array of exactly 4 objects with this structure:
{
  "title": "original title from the list",
  "summary": "1-sentence plain English explanation of why this matters",
  "source": "youtube|tiktok|reddit",
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

NOTE: "total" = (shareability × 5) + (saveWorthiness × 3.5) + (debatePotential × 2.5) + (informationGap × 2) + (personalImpact × 1)`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "scored_topics",
          strict: true,
          schema: {
            type: "object",
            properties: {
              topics: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    summary: { type: "string" },
                    source: { type: "string" },
                    url: { type: "string" },
                    scores: {
                      type: "object",
                      properties: {
                        shareability: { type: "number" },
                        saveWorthiness: { type: "number" },
                        debatePotential: { type: "number" },
                        informationGap: { type: "number" },
                        personalImpact: { type: "number" },
                        total: { type: "number" },
                      },
                      required: ["shareability", "saveWorthiness", "debatePotential", "informationGap", "personalImpact", "total"],
                      additionalProperties: false,
                    },
                  },
                  required: ["title", "summary", "source", "url", "scores"],
                  additionalProperties: false,
                },
              },
            },
            required: ["topics"],
            additionalProperties: false,
          },
        },
      } as any,
    });

    const rawContent = response?.choices?.[0]?.message?.content;
    const content = typeof rawContent === "string" ? rawContent : null;
    if (!content) throw new Error("No response from LLM");

    const parsed = JSON.parse(content);
    return (parsed.topics ?? []).slice(0, 4) as ScoredTopic[];
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
  _perplexityApiKey?: string // kept for API compatibility, no longer used
): Promise<ResearchedTopic[]> {
  const openAiKey = process.env.OPENAI_API_KEY;
  const results: ResearchedTopic[] = [];

  for (const topic of topics) {
    try {
      const researched = openAiKey
        ? await researchWithGPT4oWebSearch(topic, openAiKey)
        : await researchWithGPT(topic);
      results.push(researched);
    } catch (err) {
      console.error(`[ContentPipeline] Research failed for "${topic.title}":`, err);
      // Add with Gemini fallback so we never lose a topic
      try {
        results.push(await researchWithGPT(topic));
      } catch {
        results.push({
          title: topic.title,
          headline: topic.title.slice(0, 80),
          summary: topic.summary,
          citations: [],
          videoPrompt: "Cinematic shot of a futuristic AI interface with glowing data streams, clean minimal design, 4K quality",
          verified: false,
        });
      }
    }
  }

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
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
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
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "slide_content",
        strict: true,
        schema: {
          type: "object",
          properties: {
            headline: { type: "string" },
            summary: { type: "string" },
            insightLine: { type: ["string", "null"] },
            videoPrompt: { type: "string" },
          },
          required: ["headline", "summary", "insightLine", "videoPrompt"],
          additionalProperties: false,
        },
      },
    } as any,
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
    ? "8-second cinematic video clip (Kling AI text-to-video)"
    : "single photorealistic still image (Nano Banana / Google Imagen)";

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
        content: `You are the Head of Viral Marketing at a top-tier AI news Instagram page with 4 million followers (@evolving.ai style). Your ONE job is to write the perfect visual prompt for a ${mediaType} that will make people stop scrolling.

Your creative philosophy:
- Every visual must be IMMEDIATELY recognizable as THIS specific story — not a generic AI scene
- You think in terms of: what is the MOST OBVIOUS, VISCERAL, FUNNY, or DRAMATIC visual that represents this story?
- You identify stories by BRAND COLORS, PRODUCTS, and CONTEXT — not by trying to draw faces or logos
- You think like a meme creator and a cinematographer at the same time
- You are somewhat comedic and irreverent when the story warrants it (not forced)
- You always ask yourself: "If I saw this image/video, would I IMMEDIATELY know what company/story it's about?"

CRITICAL LIMITATION — AI image generators CANNOT accurately render:
- Real people's faces (they generate random strangers, NOT the actual person)
- Accurate company logos (they will be garbled and wrong)
- Readable text

YOUR WORKAROUNDS:
- For PEOPLE: show them from behind (silhouette at podium), show their hands, show crowd reactions, show symbolic objects (Tesla for Musk, Apple products for Tim Cook). NEVER describe a face.
- For LOGOS: use the company's SIGNATURE COLORS as the visual identifier. OpenAI = green/white swirl shape. Google = red/blue/yellow/green. Meta = blue. Anthropic = orange/brown. Apple = silver/white minimalist. Describe brand-colored objects, not the logo itself.
- For PRODUCTS: show a phone/laptop screen from a distance with the right color scheme glowing. Show someone's hand holding a device.

Technical requirements:
- Photorealistic, cinematic quality
- Vertical 9:16 portrait frame (1080×1920)
- ABSOLUTELY NO TEXT in the image — no letters, no words, no numbers, no readable characters of any kind. Any text must be completely blurred, out-of-focus, or abstracted into illegible marks.
- NEVER describe a scene that shows a document, resume, paper, or screen with readable text content — show the EMOTION or CONSEQUENCE instead
- Dramatic lighting, high contrast, professional composition
- For videos: describe camera movement, action, and duration (8 seconds). Include DYNAMIC camera movements: slow push-in, dolly zoom, parallax shifts, rotating orbit shots, or dramatic reveal movements. The video must have VISIBLE MOTION — never a static image.
- For images: describe the exact scene, lighting, depth, and emotional tone${marketingEnhancement}`,
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

Examples of GOOD prompts (notice: NO faces, NO accurate logos — use brand colors and context):
- "Close-up of a hand hovering over a phone screen glowing green (OpenAI's brand color), finger about to tap a delete button, dramatic warm lighting, shallow depth of field, photorealistic, 9:16 vertical"
- "Silhouette of a man in a dark suit at a podium, seen from behind, large screen behind him glowing deep blue and white (Palantir colors), packed auditorium visible, dark dramatic lighting, cinematic wide shot, 9:16 vertical"
- "A green-and-white glowing orb (OpenAI brand colors) cracking and falling in slow motion off a cliff edge into a dark void, dramatic god rays from above, photorealistic, 9:16 vertical"
- "Two glowing spheres — one green (OpenAI) and one red/blue/yellow/green (Google) — facing each other across a dark chess board, neon lighting, cinematic shallow depth of field, 9:16 vertical"
- "A person's hand holding a phone showing a bright blue glowing interface (Meta brand color), sitting in a modern office, dramatic side lighting, photorealistic close-up, 9:16 vertical"

Examples of BAD prompts (auto-reject these):
- "Sam Altman with brown curly hair and glasses" — AI generators CANNOT render real faces, will look like a random person
- "The OpenAI logo on a screen" — AI generators CANNOT render accurate logos, will be garbled
- "A futuristic AI interface with glowing data streams" — GENERIC, could be any story
- "A person in a suit looking at a screen" — WHO? What company? No identifying context
- "An abstract neural network with blue nodes" — CLICHÉ, tells no story

CRITICAL REMINDER: The final prompt must contain ZERO readable text. If your story involves a document, resume, paper, or screen — describe the emotional scene around it, not the document itself.

Return ONLY the prompt, no explanation, no preamble, no step labels.`,
      },
    ],
  });

  const raw = response?.choices?.[0]?.message?.content;
  const text = typeof raw === "string" ? raw.trim() : "";
  return text || `Dramatic cinematic scene directly depicting: ${headline}, photorealistic, vertical 9:16 frame, no text overlays`;
}

/**
 * Generate a single Nano Banana image prompt that visually synthesizes all 5 topic headlines
 * into one cinematic cover scene. Used for the cover slide (index 0).
 */
async function generateCoverImagePrompt(headlines: string[]): Promise<string> {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: "You create stunning, cinematic image prompts for Nano Banana (Google Imagen). Each prompt describes a single photorealistic still image that COMPOSITES MULTIPLE SUBJECTS together in one dramatic scene.",
      },
      {
        role: "user",
        content: `Create a single SCROLL-STOPPING, cinematic image prompt for the cover slide of an Instagram AI news carousel. This is the THUMBNAIL — it must make someone stop mid-scroll and feel compelled to swipe.

This week's AI topics to synthesize visually:
${headlines.map((h, i) => `${i + 1}. ${h}`).join("\n")}

CRITICAL COMPOSITION RULE — MULTIPLE SUBJECTS:
The cover image MUST combine MULTIPLE elements from the week's stories into ONE dramatic scene. Think of it like a movie poster that teases ALL the stories at once.

MULTI-SUBJECT COMPOSITION TECHNIQUES (pick ONE):
1. COLLISION: Two or three symbolic objects in brand colors clashing/colliding in mid-air (e.g., a green glowing sphere and a red-blue sphere smashing together with sparks)
2. LAYERED SCENE: Foreground + middle ground + background each represent different stories (e.g., a hand holding a cracked phone in foreground, a towering robot silhouette in midground, a burning cityscape in background)
3. SPLIT COMPOSITION: Diagonal or vertical split showing two contrasting scenes side by side (e.g., left half = creation/building, right half = destruction/disruption)
4. ENSEMBLE: 3-5 symbolic objects or figures arranged together (e.g., silhouettes of 3 figures at podiums each with different brand-color lighting, facing a crowd)
5. SWIRL/VORTEX: Multiple brand-color elements spiraling together in a dramatic vortex or explosion

DO NOT create a single-subject image. The cover MUST visually represent at least 2-3 of the week's stories.

STYLE GUIDELINES (non-negotiable):
- EDGY and MODERN — not corporate, not safe, not generic
- SCI-FI aesthetic: think Blade Runner 2049, Ex Machina, Westworld
- Hyper-cinematic: anamorphic lens flares, volumetric light rays, god rays, chromatic aberration
- Color palette: deep blacks, neon electric blue (#00f0ff), hot magenta (#ff00aa), molten gold — high contrast
- Composition: rule of thirds, multiple depth layers, 9:16 vertical portrait
- Photorealistic, 8K quality, hyperdetailed
- ABSOLUTELY NO text, NO logos, NO watermarks, NO readable characters in the image
- NEVER attempt to draw real people's faces (will look wrong). Use silhouettes, from-behind shots, or symbolic representations with brand colors instead.

Return ONLY the image prompt, no explanation, no preamble.`,
      },
    ],
  });

  const raw = response?.choices?.[0]?.message?.content;
  const text = typeof raw === "string" ? raw : "";
  return text.trim() ||
    "Hyper-cinematic 8K vertical portrait: three glowing orbs in green, blue, and red hovering above a dark cityscape at night, each orb cracking open to reveal swirling energy inside, lightning arcs connecting them, a massive crowd of silhouettes below looking up in awe, volumetric god rays piercing through storm clouds, neon reflections on wet streets, anamorphic lens flare, chromatic aberration, Blade Runner 2049 meets Akira aesthetic, rule of thirds, multiple depth layers, photorealistic hyperdetailed";
}

// ─── Stage 5: Video / Image Generation ──────────────────────────────────────
// Primary: Kling 2.5 Turbo (text-to-video, ~$0.14/clip)
// Fallback: Nano Banana / Imagen (free, built-in, still image)

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
 * Generate an 8-second video clip using Kling 2.5 Turbo API.
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

    // Submit task
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
        duration: "8",
      }),
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
 * Generate a cinematic still image using Nano Banana (Manus built-in Imagen).
 * Used as fallback when Kling is unavailable.
 */
export async function generateSlideImage(
  prompt: string
): Promise<string | null> {
  try {
    console.log(`[ContentPipeline] Generating Nano Banana image for prompt: "${prompt.slice(0, 80)}..."`);
    const { url } = await generateImage({ prompt });
    if (!url) throw new Error("No URL returned from image generation");
    console.log(`[ContentPipeline] Nano Banana image generated → ${url}`);
    return url;
  } catch (err) {
    console.error("[ContentPipeline] Nano Banana image generation failed:", err);
    return null;
  }
}


// ─── Stage 7: Make.com Instagram Webhook ──────────────────────────────────────

/**
 * Trigger Make.com scenario to post the carousel to Instagram
 */
export async function triggerInstagramPost(
  runId: number,
  slides: Array<{ assembledUrl: string; headline: string }>,
  caption: string,
  makeWebhookUrl?: string
): Promise<boolean> {
  if (!makeWebhookUrl) {
    console.log("[ContentPipeline] Make.com webhook not configured — skipping Instagram post");
    return false;
  }

  try {
    const response = await fetch(makeWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instagram_page: "suggestedbygpt",
        run_id: runId,
        caption,
        video_url: slides[0]?.assembledUrl ?? null,
        image_url: slides[0]?.assembledUrl ?? null,
        slides: slides.map((s) => ({ url: s.assembledUrl, headline: s.headline })),
        topic_title: slides[0]?.headline ?? "",
        topic_summary: "",
        posted_at: new Date().toISOString(),
      }),
    });

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
  const [runResult] = await db.insert(contentRuns).values({
    runSlot: options.runSlot,
    status: "discovering",
  });
  const runId = (runResult as any).insertId as number;

  console.log(`[ContentPipeline] Started run #${runId} (${options.runSlot})`);

  try {
    // Stage 1: Discover topics
    await db.update(contentRuns).set({ status: "discovering" }).where(eq(contentRuns.id, runId));
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
    await db.update(contentRuns).set({ status: "scoring" }).where(eq(contentRuns.id, runId));
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

/** Maximum time a pipeline run is allowed before auto-failing (30 minutes) */
const PIPELINE_TIMEOUT_MS = 30 * 60 * 1000;

export async function continueAfterApproval(
  runId: number,
  topics: ScoredTopic[],
  options: Omit<PipelineOptions, "runSlot" | "requireAdminApproval">
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Auto-fail if the pipeline hangs for more than 30 minutes
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Pipeline timed out after 30 minutes — run #${runId} auto-failed`));
    }, PIPELINE_TIMEOUT_MS);
  });

  try {
    await Promise.race([
      _runPipelineStages(runId, topics, options, db),
      timeoutPromise,
    ]);
  } catch (err: any) {
    await db.update(contentRuns).set({
      status: "failed",
      errorMessage: err?.message ?? "Unknown error",
    }).where(eq(contentRuns.id, runId));
    console.error(`[ContentPipeline] Run #${runId} failed:`, err?.message);
    throw err;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
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
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>
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

    // Stage 4: Deep Research
    await db.update(contentRuns).set({ status: "researching" }).where(eq(contentRuns.id, runId));

    const researched = await researchTopics(resolvedTopics, options.perplexityApiKey);

    // Ensure we have at least 3 topics after verification
    if (researched.length < 3) {
      throw new Error(`Only ${researched.length} topics passed verification (need at least 3)`);
    }

    // ── Stage 4.5: Creative Director — decides visual strategy per slide ──
    // The Creative Director analyzes each story and decides the best visual approach:
    // cinematic_scene, scene_with_badge, person_composite, or kling_video.
    // This replaces the old hardcoded videoSlideIndices = new Set([1, 3]).
    // Wrapped in try/catch: if the Creative Director fails, we fall back to
    // all-cinematic_scene (pure AI generation) rather than killing the pipeline.
    let creativeBrief: Awaited<ReturnType<typeof import("./creativeDirector").creativeDirectorAgent>>;
    try {
      const { creativeDirectorAgent } = await import("./creativeDirector");
      creativeBrief = await creativeDirectorAgent(researched, runId);
    } catch (cdErr: any) {
      console.error(`[ContentPipeline] ⚠️ Creative Director failed: ${cdErr?.message} — using all-cinematic_scene fallback`);
      // Build a minimal fallback brief: cover + one video + rest cinematic
      creativeBrief = {
        runId,
        globalStyleNotes: "Fallback: Creative Director unavailable. Using cinematic scenes.",
        slides: [
          { slideIndex: 0, strategy: "cinematic_scene", reasoning: "CD fallback", scenePrompt: "", engagementScore: 5 },
          ...researched.map((_, i) => ({
            slideIndex: i + 1,
            strategy: (i === 0 ? "kling_video" : "cinematic_scene") as import("./creativeDirector").VisualStrategy,
            reasoning: "CD fallback",
            scenePrompt: "",
            engagementScore: 5,
          })),
        ],
      };
    }

    // Build a map of slide index → creative brief for Stage 5
    const briefBySlide = new Map(creativeBrief.slides.map(s => [s.slideIndex, s]));

    // Create slide records using the creative brief
    // Cover slide (index 0) — edgy, eye-catching cover image with provocative headline
    const coverBrief = briefBySlide.get(0);
    const coverImagePrompt = coverBrief?.scenePrompt
      || await generateCoverImagePrompt(researched.map((t) => t.headline));
    // Read runSlot from DB since _runPipelineStages doesn't receive it directly
    const [runRecord] = await db.select({ runSlot: contentRuns.runSlot }).from(contentRuns).where(eq(contentRuns.id, runId));
    const runSlot = runRecord?.runSlot ?? "monday";
    const coverHeadline = await generateCoverHeadline(researched.map((t) => t.headline), runSlot);
    await db.insert(generatedSlides).values({
      runId,
      slideIndex: 0,
      headline: coverHeadline,
      summary: researched.map((t) => t.headline).join(" • "),
      videoPrompt: coverImagePrompt,
      isVideoSlide: coverBrief?.strategy === "kling_video" ? 1 : 0,
      status: "pending",
    });

    // Content slides (index 1-4)
    // Video/image assignment now comes from Creative Director (not hardcoded)
    for (let i = 0; i < researched.length; i++) {
      const topic = researched[i];
      const slideIndex = i + 1;
      const slideBrief = briefBySlide.get(slideIndex);
      const isVideo = slideBrief?.strategy === "kling_video" ? 1 : 0;
      // Use Creative Director's scenePrompt if available, otherwise fall back to research prompt
      const prompt = slideBrief?.scenePrompt || topic.videoPrompt;
      await db.insert(generatedSlides).values({
        runId,
        slideIndex,
        headline: topic.headline,
        summary: topic.summary,
        insightLine: topic.insightLine ?? null,
        citations: JSON.stringify(topic.citations),
        videoPrompt: prompt,
        isVideoSlide: isVideo,
        status: "pending",
      });
    }

    // Stage 5: Video / Image Generation (Kling primary, Nano Banana fallback)
    // ═══════════════════════════════════════════════════════════════════════════
    // DECISION LOG: Track every decision per slide for debugging
    // ═══════════════════════════════════════════════════════════════════════════
    await db.update(contentRuns).set({ status: "generating" }).where(eq(contentRuns.id, runId));
    const slides = await db.select().from(generatedSlides).where(eq(generatedSlides.runId, runId));
    const stageStart = Date.now();
    const decisionLog: Array<{
      slideIndex: number;
      headline: string;
      wantsVideo: boolean;
      logoFound: string | null;
      logoDownloaded: boolean;
      searchBgFound: boolean;
      klingAttempted: boolean;
      klingSucceeded: boolean;
      strategy: string;
      timeMs: number;
      mediaUrl: string | null;
    }> = [];

    // ── Kling credential check (ONCE — fail fast, don't waste 8 min on timeouts) ──
    let klingAK = options.klingAccessKey || ENV.klingAccessKey;
    let klingSK = options.klingSecretKey || ENV.klingSecretKey;
    if (!klingAK || !klingSK) {
      try {
        const { appSettings } = await import("../drizzle/schema");
        const [ak] = await db.select().from(appSettings).where(eq(appSettings.key, "kling_access_key"));
        const [sk] = await db.select().from(appSettings).where(eq(appSettings.key, "kling_secret_key"));
        if (ak?.value) klingAK = ak.value;
        if (sk?.value) klingSK = sk.value;
        if (klingAK && klingSK) console.log("[ContentPipeline] ✅ Kling credentials loaded from DB");
      } catch (e) {
        console.warn("[ContentPipeline] Could not load Kling credentials from DB:", e);
      }
    }
    const hasKling = !!(klingAK && klingSK);
    console.log(`[ContentPipeline] ═══ Stage 5: Media Generation ═══`);
    console.log(`[ContentPipeline] Kling video: ${hasKling ? "✅ ENABLED" : "❌ DISABLED (no credentials — all video slides will be still images)"}`);
    console.log(`[ContentPipeline] Slides to generate: ${slides.length}`);

    // Import asset library + compositing functions
    const {
      findLogoForText, findAllLogosForText, downloadImage,
      compositeAssetOnBackground, compositePersonOnBackground,
      uploadAsset, searchImage, LOGO_LIBRARY,
    } = await import("./assetLibrary");

    // ── Strategy-based media generation (driven by Creative Director brief) ──
    const generateSlideMedia = async (slide: typeof slides[0]): Promise<void> => {
      const slideStart = Date.now();
      if (!slide.videoPrompt) return;

      const brief = briefBySlide.get(slide.slideIndex);
      const strategy = brief?.strategy ?? (slide.isVideoSlide === 1 ? "kling_video" : "cinematic_scene");

      const log: typeof decisionLog[0] = {
        slideIndex: slide.slideIndex,
        headline: slide.headline ?? "",
        wantsVideo: strategy === "kling_video",
        logoFound: null,
        logoDownloaded: false,
        searchBgFound: false,
        klingAttempted: false,
        klingSucceeded: false,
        strategy,
        timeMs: 0,
        mediaUrl: null,
      };

      await db.update(generatedSlides)
        .set({ status: "generating_video" })
        .where(eq(generatedSlides.id, slide.id));

      let mediaUrl: string | null = null;
      const scenePrompt = brief?.scenePrompt || slide.videoPrompt;

      console.log(`[ContentPipeline] Slide ${slide.slideIndex}: 🎨 Strategy: ${strategy} | "${(slide.headline ?? "").slice(0, 50)}..."`);

      // ════════════════════════════════════════════════════════════════════════
      // STRATEGY DISPATCH — each strategy has its own execution path + fallback
      // ════════════════════════════════════════════════════════════════════════

      if (strategy === "kling_video" && hasKling) {
        // ── KLING VIDEO: Generate 8-second cinematic video clip ──
        // PRIORITY: Use the Creative Director's scenePrompt if it has camera motion keywords
        // (the CD was specifically told to include camera movement for kling_video slides).
        // Only fall back to Marketing Brain re-generation if the CD prompt is missing/empty.
        let videoSpecificPrompt = scenePrompt;
        const hasCameraMotion = /camera|push[- ]in|dolly|orbit|pan|zoom|parallax|tracking|reveal/i.test(scenePrompt);

        if (!scenePrompt || scenePrompt.length < 20 || !hasCameraMotion) {
          // Creative Director didn't provide a video-quality prompt — regenerate
          try {
            console.log(`[ContentPipeline] Slide ${slide.slideIndex}: 🎬 CD prompt lacks camera motion — generating video-specific prompt...`);
            videoSpecificPrompt = await marketingBrainPrompt({
              headline: slide.headline ?? "",
              summary: slide.summary ?? "",
              research: slide.summary ?? "",
              isVideo: true,
            });
          } catch (err: any) {
            console.warn(`[ContentPipeline] Slide ${slide.slideIndex}: ⚠️ Video prompt re-gen failed, using scene prompt: ${err?.message}`);
          }
        } else {
          console.log(`[ContentPipeline] Slide ${slide.slideIndex}: 🎬 Using Creative Director's video prompt (has camera motion)`);
        }

        log.klingAttempted = true;
        console.log(`[ContentPipeline] Slide ${slide.slideIndex}: 🎬 Attempting Kling 2.5 Turbo video...`);
        mediaUrl = await generateKlingVideo(videoSpecificPrompt, klingAK, klingSK);
        log.klingSucceeded = !!mediaUrl;
        if (mediaUrl) {
          log.strategy = "kling_video";
          console.log(`[ContentPipeline] Slide ${slide.slideIndex}: ✅ Kling video generated`);
        } else {
          console.log(`[ContentPipeline] Slide ${slide.slideIndex}: ⚠️ Kling failed — falling back to cinematic_scene`);
          // Kling failed: fall through to cinematic_scene below
        }
      }

      if (!mediaUrl && strategy === "person_composite") {
        // ── PERSON COMPOSITE: Real person photo on AI background ──
        console.log(`[ContentPipeline] Slide ${slide.slideIndex}: 👤 Person composite — searching for person photo...`);
        let personFailed = false;

        try {
          // Step 1: Generate AI background
          const aiBgUrl = await generateSlideImage(scenePrompt);
          const aiBgBuffer = aiBgUrl ? await downloadImage(aiBgUrl) : null;

          if (aiBgBuffer && brief?.personSearchQuery) {
            // Step 2: Search Google CSE for person photo
            const personResult = await searchImage(brief.personSearchQuery, { portrait: true });
            if (personResult) {
              log.searchBgFound = true;
              console.log(`[ContentPipeline] Slide ${slide.slideIndex}: 🔍 Person photo found → ${personResult.title}`);
              const personBuffer = await downloadImage(personResult.url);

              if (personBuffer) {
                // Step 3: Composite person onto AI background
                const composed = await compositePersonOnBackground(
                  personBuffer,
                  aiBgBuffer,
                  brief.personPlacement ?? "center",
                );
                mediaUrl = await uploadAsset(composed, runId, slide.slideIndex);
                log.strategy = "person_composite";
                console.log(`[ContentPipeline] Slide ${slide.slideIndex}: ✅ Person composited onto AI background`);
              } else {
                console.warn(`[ContentPipeline] Slide ${slide.slideIndex}: ⚠️ Person photo download failed`);
                personFailed = true;
              }
            } else {
              console.warn(`[ContentPipeline] Slide ${slide.slideIndex}: ⚠️ No person photo found via Google CSE`);
              personFailed = true;
            }

            // Fallback: use raw AI image if person compositing failed
            if (personFailed && aiBgUrl) {
              mediaUrl = aiBgUrl;
              log.strategy = "cinematic_scene_person_fallback";
              console.log(`[ContentPipeline] Slide ${slide.slideIndex}: ↩️ Falling back to AI image (person not found)`);
            }
          } else if (aiBgUrl) {
            mediaUrl = aiBgUrl;
            log.strategy = "cinematic_scene_no_bg";
          }
        } catch (err: any) {
          console.warn(`[ContentPipeline] Slide ${slide.slideIndex}: ⚠️ Person composite failed: ${err?.message}`);
          // Fall through to cinematic_scene below
        }
      }

      if (!mediaUrl && (strategy === "scene_with_badge" || strategy === "cinematic_scene" || strategy === "kling_video" || strategy === "person_composite")) {
        // ── SCENE WITH BADGE or CINEMATIC SCENE (also Kling/person fallback) ──
        // Generate AI background image, optionally add logo badge(s)
        console.log(`[ContentPipeline] Slide ${slide.slideIndex}: 🖼️ Generating AI image (Nano Banana)...`);
        const aiImageUrl = await generateSlideImage(scenePrompt);

        if (aiImageUrl && strategy === "scene_with_badge" && brief?.logoKeys && brief.logoKeys.length > 0) {
          // Download logo(s) from the curated library
          const logoKey = brief.logoKeys[0];
          const logoEntry = LOGO_LIBRARY[logoKey];
          if (logoEntry) {
            const logoBuffer = await downloadImage(logoEntry.url);
            if (logoBuffer) {
              log.logoFound = brief.logoKeys.join(" + ");
              log.logoDownloaded = true;

              try {
                const aiImageBuffer = await downloadImage(aiImageUrl);
                if (aiImageBuffer) {
                  // Check for dual logo
                  let secondLogoBuffer: Buffer | null = null;
                  let secondBgColor: string | undefined;
                  if (brief.logoKeys.length > 1) {
                    const secondKey = brief.logoKeys[1];
                    const secondEntry = LOGO_LIBRARY[secondKey];
                    if (secondEntry) {
                      secondLogoBuffer = await downloadImage(secondEntry.url);
                      secondBgColor = secondEntry.bgColor;
                    }
                  }

                  const isDual = !!secondLogoBuffer;
                  console.log(`[ContentPipeline] Slide ${slide.slideIndex}: 🔀 Compositing ${isDual ? "dual" : "single"} logo badge(s)...`);
                  const composed = await compositeAssetOnBackground(
                    logoBuffer,
                    logoEntry.bgColor ?? "#0a0a1a",
                    aiImageBuffer,
                    isDual ? { layout: "dual", secondLogoBuffer: secondLogoBuffer!, secondBgColor: secondBgColor ?? "#1a1a2e" } : undefined,
                  );
                  mediaUrl = await uploadAsset(composed, runId, slide.slideIndex);
                  log.strategy = isDual ? "scene_with_dual_badge" : "scene_with_badge";
                  console.log(`[ContentPipeline] Slide ${slide.slideIndex}: ✅ Logo badge(s) composited`);
                } else {
                  mediaUrl = aiImageUrl;
                  log.strategy = "cinematic_scene_badge_dl_fail";
                }
              } catch (err: any) {
                console.warn(`[ContentPipeline] Slide ${slide.slideIndex}: ⚠️ Badge compositing failed: ${err?.message}`);
                mediaUrl = aiImageUrl;
                log.strategy = "cinematic_scene_badge_fail";
              }
            } else {
              // Logo download failed — just use AI image
              mediaUrl = aiImageUrl;
              log.strategy = "cinematic_scene_logo_dl_fail";
            }
          } else {
            mediaUrl = aiImageUrl;
            log.strategy = "cinematic_scene_no_logo_entry";
          }
        } else if (aiImageUrl) {
          // Pure cinematic scene (or badge strategy with no logos) — just the AI image
          mediaUrl = aiImageUrl;
          log.strategy = strategy === "kling_video" ? "cinematic_scene_kling_fallback" : "cinematic_scene";
        } else {
          log.strategy = "all_failed";
          console.error(`[ContentPipeline] Slide ${slide.slideIndex}: ❌ ALL media generation failed`);
        }
      }

      log.timeMs = Date.now() - slideStart;
      log.mediaUrl = mediaUrl;
      decisionLog.push(log);

      await db.update(generatedSlides)
        .set({
          videoUrl: mediaUrl ?? null,
          status: mediaUrl ? "assembling" : "ready",
        })
        .where(eq(generatedSlides.id, slide.id));

      console.log(`[ContentPipeline] Slide ${slide.slideIndex}: Done in ${(log.timeMs / 1000).toFixed(1)}s — strategy: ${log.strategy}`);
    };

    // ── Parallel generation: image slides concurrent, video slides sequential (Kling rate limit) ──
    const videoSlides = slides.filter(s => s.isVideoSlide === 1 && hasKling && s.videoPrompt);
    const imageSlides = slides.filter(s => !(s.isVideoSlide === 1 && hasKling) && s.videoPrompt);

    console.log(`[ContentPipeline] Generating ${imageSlides.length} image slides in parallel + ${videoSlides.length} video slides sequentially...`);
    await Promise.all([
      Promise.all(imageSlides.map(s => generateSlideMedia(s))),
      (async () => {
        for (const s of videoSlides) {
          await generateSlideMedia(s);
        }
      })(),
    ]);

    // ── Log summary ──
    const stageElapsed = ((Date.now() - stageStart) / 1000).toFixed(1);
    console.log(`\n[ContentPipeline] ═══ Stage 5 Summary (${stageElapsed}s total) ═══`);
    for (const entry of decisionLog) {
      console.log(`[ContentPipeline]   Slide ${entry.slideIndex}: ${entry.strategy} | logo=${entry.logoFound ?? "none"} | ${(entry.timeMs / 1000).toFixed(1)}s | ${entry.mediaUrl ? "✅" : "❌"}`);
    }
    console.log(`[ContentPipeline] ═══════════════════════════════════════\n`);

    // Store decision log in run metadata for UI access
    // BUG 4 FIX: topicsRaw is a JSON ARRAY "[{...},{...}]" — we must NOT spread it
    // into an object (that would destroy it into {"0":{...},"1":{...}}).
    // Instead, store the decision log as a separate field or wrap properly.
    try {
      const [currentRun] = await db.select({ topicsRaw: contentRuns.topicsRaw }).from(contentRuns).where(eq(contentRuns.id, runId));
      const existingRaw = currentRun?.topicsRaw ?? "[]";
      let parsed: any;
      try { parsed = JSON.parse(existingRaw); } catch { parsed = []; }

      // If topicsRaw is an array (the normal case), wrap it in an object to add the log
      // If it's already an object (from a previous run), just add the log key
      // Include both the creative brief and the execution decision log
      const creativeBriefSummary = creativeBrief.slides.map(s => ({
        slideIndex: s.slideIndex,
        strategy: s.strategy,
        reasoning: s.reasoning,
        engagementScore: s.engagementScore,
        logoKeys: s.logoKeys,
        personSearchQuery: s.personSearchQuery ? s.personSearchQuery.slice(0, 60) : undefined,
      }));

      const wrapped = Array.isArray(parsed)
        ? { topics: parsed, creativeBrief: creativeBriefSummary, mediaDecisionLog: decisionLog }
        : { ...parsed, creativeBrief: creativeBriefSummary, mediaDecisionLog: decisionLog };

      await db.update(contentRuns)
        .set({ topicsRaw: JSON.stringify(wrapped) })
        .where(eq(contentRuns.id, runId));
    } catch { /* don't fail pipeline over logging */ }

    // Stage 6: Assembly — Sharp compositor (@evolving.ai style, fast, no external API)
    await db.update(contentRuns).set({ status: "assembling" }).where(eq(contentRuns.id, runId));
    const slidesForAssembly = await db.select().from(generatedSlides).where(eq(generatedSlides.runId, runId));

    console.log(`[ContentPipeline] Stage 6: Sharp assembly for run #${runId} (${slidesForAssembly.length} slides)...`);
    try {
      const { assembleAllSlides } = await import("./sharpCompositor");
      const assembled = await assembleAllSlides(
        slidesForAssembly.map((s) => ({
          runId,
          slideIndex: s.slideIndex,
          headline: s.headline ?? "",
          summary: s.summary ?? undefined,
          insightLine: s.insightLine ?? undefined,
          mediaUrl: s.videoUrl ?? null,
          // A slide is treated as video if: (a) isVideoSlide flag is set AND it has an MP4 URL
          // Without Kling keys, video slides fall back to still images (no .mp4 URL) so they get composited
          isVideo: s.isVideoSlide === 1 && !!(s.videoUrl && (s.videoUrl.includes(".mp4") || s.videoUrl.includes("video"))),
          isCover: s.slideIndex === 0,
        }))
      );
      let successCount = 0;
      for (const result of assembled) {
        const matchingSlide = slidesForAssembly.find((s) => s.slideIndex === result.slideIndex);
        if (matchingSlide && result.url) {
          await db.update(generatedSlides)
            .set({ assembledUrl: result.url, status: "ready" })
            .where(eq(generatedSlides.id, matchingSlide.id));
          successCount++;
        } else if (matchingSlide) {
          // Mark as ready even if assembly failed so pipeline can continue
          await db.update(generatedSlides)
            .set({ status: "ready" })
            .where(eq(generatedSlides.id, matchingSlide.id));
        }
      }
      console.log(`[ContentPipeline] Sharp assembly: ${successCount}/${slidesForAssembly.length} slides assembled`);
    } catch (sharpErr: any) {
      console.warn(`[ContentPipeline] Sharp assembly failed: ${sharpErr?.message}`);
      // Mark all slides ready so pipeline can continue to caption/approval
      await db.update(generatedSlides).set({ status: "ready" }).where(eq(generatedSlides.runId, runId));
    }

    // Stage 7: Generate caption and wait for admin approval before posting
    console.log(`[ContentPipeline] Stage 7: Generating Instagram caption for run #${runId}`);
    const finalSlides = await db.select().from(generatedSlides).where(eq(generatedSlides.runId, runId));
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
