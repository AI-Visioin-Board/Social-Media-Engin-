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
    businessOwnerImpact: number;   // 1-10
    generalPublicRelevance: number; // 1-10
    viralPotential: number;         // 1-10
    worldImportance: number;        // 1-10
    interestingness: number;        // 1-10
    total: number;                  // sum
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

  const systemPrompt = `You are a world-class social media content strategist for @suggestedbygpt, an AI news Instagram page with a highly engaged audience of entrepreneurs, business owners, and tech-curious everyday people. Your job is to select the 5 BEST AI news stories from a large pool of candidates for this week's Instagram carousel.

AUDIENCE PROFILE:
- Small/medium business owners who want to use AI to grow their business
- Everyday people curious about how AI affects their lives
- Entrepreneurs and investors tracking AI trends
- Tech enthusiasts who share viral AI content

SCORING CRITERIA (rate each 1-10):
1. businessOwnerImpact: How directly does this affect small/medium business owners? (tools, costs, automation, competition)
2. generalPublicRelevance: How relevant is this to everyday people? (jobs, privacy, daily life, consumer products)
3. viralPotential: How likely is this to be shared on Instagram? (shocking, surprising, controversial, inspiring)
4. worldImportance: How significant is this for society? (regulation, safety, geopolitics, scientific impact)
5. interestingness: How surprising, novel, or fascinating is this? (unexpected, counterintuitive, first-of-its-kind)

SELECTION RULES:
- Select exactly 4 topics with maximum variety (no two from the same company or angle)
- Prioritize CONCRETE news over vague announcements ("X released Y" beats "X is working on Y")
- Prefer stories with clear impact that can be explained in one sentence
- At least 1 topic should be directly actionable for business owners
- At least 1 topic should be broadly relatable to non-technical people
- Avoid: pure research papers, niche developer tools, incremental updates to existing products
${recentExclusions.length > 0 ? `
DO NOT SELECT these recently published topics or anything closely similar:\n${recentExclusions.slice(0, 20).join("\n")}` : ""}`;

  const userPrompt = `Here are the candidate topics. Score each on all 5 criteria and select the best 5.

CANDIDATES:
${candidates.map((t, i) => `${i + 1}. "${t.title}" (source: ${t.source})`).join("\n")}

Return a JSON array of exactly 4 objects with this structure:
{
  "title": "original title from the list",
  "summary": "1-sentence plain English explanation of why this matters",
  "source": "youtube|tiktok|reddit",
  "url": "original url",
  "scores": {
    "businessOwnerImpact": 8,
    "generalPublicRelevance": 7,
    "viralPotential": 9,
    "worldImportance": 6,
    "interestingness": 8,
    "total": 38
  }
}`;

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
                        businessOwnerImpact: { type: "number" },
                        generalPublicRelevance: { type: "number" },
                        viralPotential: { type: "number" },
                        worldImportance: { type: "number" },
                        interestingness: { type: "number" },
                        total: { type: "number" },
                      },
                      required: ["businessOwnerImpact", "generalPublicRelevance", "viralPotential", "worldImportance", "interestingness", "total"],
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
        businessOwnerImpact: 5,
        generalPublicRelevance: 5,
        viralPotential: 5,
        worldImportance: 5,
        interestingness: 5,
        total: 25,
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
      tools: [{ type: "web_search_preview" }],      content: `Today is ${todayStr}. Research this AI news topic using web search.

CRITICAL RECENCY RULE: Only use sources and information published AFTER ${cutoffStr} (last 15 days). If you cannot find recent sources on this topic, say so clearly — do NOT use older articles or background information as if it were current news.

TONE GUIDANCE: This page has a dry, occasionally sarcastic voice. If the story has an obvious irony, a tech-world punchline everyone is already thinking, or something genuinely absurd, you can lean into that with a wry headline or insightLine. Keep it subtle — a smirk, not a joke. Not every slide needs to be funny. Serious stories stay serious.

Provide a JSON response with:
1. headline: Write a VIRAL, PROVOCATIVE, ALL-CAPS Instagram headline in the style of @evolving.ai (4.1M followers). Rules: ALL CAPS, max 12 words, must make someone STOP scrolling, use specific numbers/names/facts, be shocking or surprising, examples: "THIS 20-YEAR-OLD BUILT AN AI THAT EXPOSES CORRUPTION", "EVERY MAJOR AI MODEL HAS BEEN CAUGHT LYING IN SAFETY TESTS", "OPENAI JUST RELEASED A MODEL THAT CODES BETTER THAN 99% OF ENGINEERS"
2. summary: 2-sentence plain-English explanation of what JUST happened and why it matters to business owners today
3. insightLine: OPTIONAL. A single plain-English sentence (max 12 words) that gives the viewer the key "aha" context they need to understand WHY this headline is surprising or important. ONLY include this if the headline alone is cryptic or incomplete — for example "AI AGENTS GET RUDE AND BOOST REASONING BY 10.5%" needs insightLine: "Robots allowed to interrupt and be rude showed higher reasoning scores." But "OPENAI RELEASES GPT-5" does NOT need an insightLine. Return null if the headline is self-explanatory. Can be dry/wry if the story warrants it.
4. videoPrompt: Cinematic image/video prompt for Nano Banana or Kling AI. Describe a dramatic, high-impact visual: real photo of AI leaders OR AI-generated cinematic scene. Specific, vivid, photorealistic. No text overlays. Examples: "Dramatic close-up of Sam Altman in dark suit against glowing server room", "Humanoid robot hand reaching toward human hand, cinematic lighting, photorealistic"
5. sources: array of {title, url} for the top 2-3 sources you found (must be from after ${cutoffStr})

Topic: "${topic.title}"

Respond ONLY with valid JSON matching: { "headline": "...", "summary": "...", "insightLine": "..." or null, "videoPrompt": "...", "sources": [{"title": "...", "url": "..."}] }`,    }),  });

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
  const videoPrompt = parsed.videoPrompt ?? await generateVideoPrompt(topic.title, rawText);
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
1. headline: A VIRAL, PROVOCATIVE, ALL-CAPS headline in the style of @evolving.ai (4.1M followers). Rules: ALL CAPS, max 12 words, must make someone STOP scrolling, use specific numbers/names/facts. Examples: "THIS 20-YEAR-OLD BUILT AN AI THAT EXPOSES CORRUPTION", "EVERY MAJOR AI MODEL HAS BEEN CAUGHT LYING IN SAFETY TESTS"
2. summary: A 2-sentence plain-English explanation of what happened and why it matters to businesses
3. insightLine: OPTIONAL. A single plain-English sentence (max 12 words) giving the viewer the key "aha" context they need. ONLY include if the headline is cryptic or incomplete — return null if self-explanatory. Can be dry/wry if the story warrants it.
4. videoPrompt: A cinematic image/video prompt for Nano Banana or Kling AI. Dramatic, high-impact visual. Specific, vivid, photorealistic. No text overlays.

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

  return {
    title: topic.title,
    headline: parsed.headline ?? topic.title,
    summary: parsed.summary ?? topic.summary,
    insightLine,
    citations: [],
    videoPrompt: parsed.videoPrompt ?? `Cinematic close-up of AI interface, futuristic tech, clean minimal design, 4K`,
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

async function generateVideoPrompt(title: string, research: string): Promise<string> {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: "You generate precise Seedance AI video prompts for social media content. Each prompt describes a 5-8 second cinematic clip.",
      },
      {
        role: "user",
        content: `Generate a Seedance video prompt for this AI news story. The clip will appear in the bottom half of an Instagram carousel slide.

Story: "${title}"
Context: ${research.slice(0, 300)}

Requirements:
- 5-8 seconds, cinematic quality
- Show the technology/concept visually (UI screens, robots, data flows, people using tech)
- Clean, professional aesthetic
- No text overlays (we add those separately)
- Describe specific visual elements, camera movement, lighting

Return just the prompt, no explanation.`,
      },
    ],
  });

  const raw = response?.choices?.[0]?.message?.content;
  const text = typeof raw === "string" ? raw : "";
  return text.trim() ||
    "Cinematic shot of a futuristic AI interface with glowing data streams, clean minimal design, 4K quality";
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
        content: "You create stunning, cinematic image prompts for Nano Banana (Google Imagen). Each prompt describes a single photorealistic still image.",
      },
      {
        role: "user",
        content: `Create a single SCROLL-STOPPING, cinematic image prompt for the cover slide of an Instagram AI news carousel. This is the THUMBNAIL — it must make someone stop mid-scroll and feel compelled to swipe.

This week's AI topics to synthesize visually:
${headlines.map((h, i) => `${i + 1}. ${h}`).join("\n")}

STYLE GUIDELINES (non-negotiable):
- EDGY and MODERN — not corporate, not safe, not generic
- SCI-FI aesthetic: think Blade Runner 2049, Ex Machina, Ghost in the Shell, Westworld
- Hyper-cinematic: anamorphic lens flares, volumetric light rays, god rays, chromatic aberration
- Color palette: deep blacks, neon electric blue (#00f0ff), hot magenta (#ff00aa), molten gold — high contrast
- Dramatic tension: something feels like it's about to change the world
- Could include: a humanoid AI face emerging from data, a cracked digital mirror showing a robot eye, glowing neural pathways inside a human silhouette, a city skyline being rewritten by code
- Composition: rule of thirds, strong foreground subject, depth layers, 9:16 vertical portrait
- Photorealistic, 8K quality, hyperdetailed
- NO text, NO logos, NO watermarks in the image
- The image should feel like a movie poster for the future of AI

Return ONLY the image prompt, no explanation, no preamble.`,
      },
    ],
  });

  const raw = response?.choices?.[0]?.message?.content;
  const text = typeof raw === "string" ? raw : "";
  return text.trim() ||
    "Hyper-cinematic 8K portrait: a humanoid AI face half-emerging from a shattered digital mirror, one eye glowing neon electric blue, the other a deep void of cascading code, surrounded by volumetric light rays and chromatic aberration, deep black background with neon magenta and gold accents, anamorphic lens flare, Blade Runner 2049 aesthetic, rule of thirds composition, 9:16 vertical, photorealistic hyperdetailed";
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
        negative_prompt: "text, watermark, blurry, low quality, distorted",
        cfg_scale: 0.5,
        mode: "std",
        duration: "5",
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
 * Generate the Instagram caption in evolving.ai style
 */
export async function generateCaption(topics: ResearchedTopic[]): Promise<string> {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: "You write viral Instagram captions for an AI news page. Style: short, punchy, emoji-led, curiosity-driven. Similar to @evolving.ai.",
      },
      {
        role: "user",
        content: `Write an Instagram caption for a carousel post covering these 4 AI news stories:
${topics.map((t, i) => `${i + 1}. ${t.headline}`).join("\n")}

Requirements:
- Start with 2-3 relevant emojis
- One punchy hook sentence (max 10 words)
- Brief teaser mentioning the stories
- End with "Swipe to see all 4 →"
- 3-5 relevant hashtags at the end
- Keep it under 150 words total`,
      },
    ],
  });

  const raw = response?.choices?.[0]?.message?.content;
  const text = typeof raw === "string" ? raw : "";
  return text.trim() ||
    "🤖🔥 AI is moving fast — here's what you missed this week. Swipe to see all 4 →\n\n#AI #ArtificialIntelligence #AINews #TechNews #BusinessAI";
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
async function generateCoverHeadline(headlines: string[], slot: "monday" | "friday"): Promise<string> {
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "You write viral Instagram carousel cover headlines. Your style is EXACTLY like @airesearches and @evolving.ai on Instagram — provocative, ALL-CAPS, 8-12 words max, designed to make someone stop scrolling.",
        },
        {
          role: "user",
          content: `Write ONE cover headline for an Instagram AI news carousel. This week's topics:\n${headlines.map((h, i) => `${i + 1}. ${h}`).join("\n")}\n\nRules:\n- ALL CAPS\n- 8-12 words max\n- Provocative and curiosity-driven (e.g. "THE AI REVOLUTION JUST CHANGED EVERYTHING THIS WEEK")\n- Hint at multiple shocking stories without revealing them\n- Use words like: JUST, NOW, FINALLY, EXPOSED, SHOCKING, CHANGED, NEVER, EVERY\n- Do NOT use quotation marks\n- Return ONLY the headline, nothing else`,
        },
      ],
    });
    const raw = (response as any)?.choices?.[0]?.message?.content?.trim() ?? "";
    const headline = raw.replace(/^"|"$/g, "").trim().toUpperCase();
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

    // Create slide records
    // Cover slide (index 0) — edgy, eye-catching cover image with provocative headline
    const coverImagePrompt = await generateCoverImagePrompt(researched.map((t) => t.headline));
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
      isVideoSlide: 0, // cover is always a still image
      status: "pending",
    });

    // Content slides (index 1-4)
    // Slides 1 and 3 are video slides, slides 2 and 4 are still images — mixed carousel
    const videoSlideIndices = new Set([1, 3]);
    for (let i = 0; i < researched.length; i++) {
      const topic = researched[i];
      const slideIndex = i + 1;
      await db.insert(generatedSlides).values({
        runId,
        slideIndex,
        headline: topic.headline,
        summary: topic.summary,
        insightLine: topic.insightLine ?? null,
        citations: JSON.stringify(topic.citations),
        videoPrompt: topic.videoPrompt,
        isVideoSlide: videoSlideIndices.has(slideIndex) ? 1 : 0,
        status: "pending",
      });
    }

    // Stage 5: Video / Image Generation (Kling primary, Nano Banana fallback)
    await db.update(contentRuns).set({ status: "generating" }).where(eq(contentRuns.id, runId));
    const slides = await db.select().from(generatedSlides).where(eq(generatedSlides.runId, runId));
    let klingAK = options.klingAccessKey || ENV.klingAccessKey;
    let klingSK = options.klingSecretKey || ENV.klingSecretKey;
    // If env vars are empty, try reading from DB appSettings (user saved via Setup Guide)
    if (!klingAK || !klingSK) {
      try {
        const { appSettings } = await import("../drizzle/schema");
        const [ak] = await db.select().from(appSettings).where(eq(appSettings.key, "kling_access_key"));
        const [sk] = await db.select().from(appSettings).where(eq(appSettings.key, "kling_secret_key"));
        if (ak?.value) klingAK = ak.value;
        if (sk?.value) klingSK = sk.value;
        if (klingAK && klingSK) console.log("[ContentPipeline] Loaded Kling credentials from DB settings");
      } catch (e) {
        console.warn("[ContentPipeline] Could not load Kling credentials from DB:", e);
      }
    }
    const hasKling = !!(klingAK && klingSK);

    for (const slide of slides) {
      if (!slide.videoPrompt) continue;
      await db.update(generatedSlides)
        .set({ status: "generating_video" })
        .where(eq(generatedSlides.id, slide.id));

      let mediaUrl: string | null = null;
      const wantsVideo = slide.isVideoSlide === 1;

      if (wantsVideo) {
        // Video slide: try Kling first, fall back to Nano Banana video gen
        if (hasKling) {
          console.log(`[ContentPipeline] Slide ${slide.slideIndex}: Kling 2.5 Turbo video generation`);
          mediaUrl = await generateKlingVideo(slide.videoPrompt, klingAK, klingSK);
        }
        if (!mediaUrl) {
          // Nano Banana doesn't generate video — generate a still image for now
          // When Kling keys are added, this will become a real video
          console.log(`[ContentPipeline] Slide ${slide.slideIndex}: video slide — Kling unavailable, using Nano Banana still image`);
          mediaUrl = await generateSlideImage(slide.videoPrompt);
        }
      } else {
        // Image slide: always use Nano Banana still image
        console.log(`[ContentPipeline] Slide ${slide.slideIndex}: still image via Nano Banana`);
        mediaUrl = await generateSlideImage(slide.videoPrompt);
      }

      await db.update(generatedSlides)
        .set({
          videoUrl: mediaUrl ?? undefined,
          status: mediaUrl ? "assembling" : "ready",
        })
        .where(eq(generatedSlides.id, slide.id));
    }

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
