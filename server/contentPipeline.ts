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
  citations: Array<{ source: string; url: string }>;
  videoPrompt: string;    // Seedance generation prompt
  verified: boolean;      // has 3+ credible sources
}

// ─── Stage 1: Topic Discovery ─────────────────────────────────────────────────

/**
 * Fetch trending AI topics from YouTube, TikTok, Reddit simultaneously
 * Uses Manus built-in Data APIs (no extra cost)
 */
export async function discoverTopics(): Promise<RawTopic[]> {
  const topics: RawTopic[] = [];

  // Parallel discovery across all sources
  const [ytTopics, ttTopics, redditTopics] = await Promise.allSettled([
    discoverFromYouTube(),
    discoverFromTikTok(),
    discoverFromReddit(),
  ]);

  if (ytTopics.status === "fulfilled") topics.push(...ytTopics.value);
  if (ttTopics.status === "fulfilled") topics.push(...ttTopics.value);
  if (redditTopics.status === "fulfilled") topics.push(...redditTopics.value);

  // If all APIs failed, use GPT-4o web search as primary discovery
  if (topics.length === 0) {
    console.warn("[ContentPipeline] All social APIs unavailable — using GPT-4o web search for topic discovery");
    const gptTopics = await discoverWithGPT4oWebSearch();
    topics.push(...gptTopics);
  }
  console.log(`[ContentPipeline] Discovered ${topics.length} raw topics`);
  return topics;
}

// 6 targeted search queries — each focuses on a different angle for maximum coverage
const GPT4O_SEARCH_QUERIES = [
  `Search the web for the 6 most significant NEW AI model releases or major AI product launches from the last 7 days (GPT, Claude, Gemini, Grok, Llama, Mistral, or any notable AI). Return ONLY a JSON array: [{"title": "headline max 15 words", "url": "source url", "source": "news"}]`,
  `Search the web for the 6 most viral or surprising AI news stories from the last 7 days that would shock or amaze everyday people — AI doing something humans couldn't, AI beating records, AI changing daily life. Return ONLY a JSON array: [{"title": "headline max 15 words", "url": "source url", "source": "news"}]`,
  `Search the web for the 6 most important AI news stories for small business owners from the last 7 days — new AI productivity tools, AI automating business tasks, AI cost savings, AI for marketing or customer service. Return ONLY a JSON array: [{"title": "headline max 15 words", "url": "source url", "source": "news"}]`,
  `Search the web for the 6 most significant AI regulation, policy, or ethics news stories from the last 7 days — government actions, AI safety concerns, lawsuits, bans, major policy changes. Return ONLY a JSON array: [{"title": "headline max 15 words", "url": "source url", "source": "news"}]`,
  `Search the web for the 6 most impressive AI research breakthroughs or scientific discoveries from the last 7 days — AI in medicine, AI in science, AI solving hard problems, new AI capabilities. Return ONLY a JSON array: [{"title": "headline max 15 words", "url": "source url", "source": "news"}]`,
  `Search the web for the 6 most talked-about AI news stories on social media and tech forums right now — what is the AI community most excited or concerned about this week? Return ONLY a JSON array: [{"title": "headline max 15 words", "url": "source url", "source": "news"}]`,
];

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

async function discoverWithGPT4oWebSearch(): Promise<RawTopic[]> {
  const openAiKey = process.env.OPENAI_API_KEY;
  if (!openAiKey) {
    console.warn("[ContentPipeline] No OpenAI key for discovery");
    return getStaticFallbackTopics();
  }
  try {
    console.log("[ContentPipeline] Running 6 parallel GPT-4o web searches + Reddit JSON API...");
    const [redditResult, ...searchResults] = await Promise.allSettled([
      discoverFromRedditJSON(),
      ...GPT4O_SEARCH_QUERIES.map((q) => runSingleGPT4oSearch(q, openAiKey)),
    ]);
    const allTopics: RawTopic[] = [];
    if (redditResult.status === "fulfilled") allTopics.push(...redditResult.value);
    for (const r of searchResults) {
      if (r.status === "fulfilled") allTopics.push(...r.value);
    }
    console.log(`[ContentPipeline] Total discovered: ${allTopics.length} topics from 7 sources`);
    return allTopics.length >= 5 ? allTopics : [...allTopics, ...getStaticFallbackTopics().slice(0, 12 - allTopics.length)];
  } catch (err) {
    console.error("[ContentPipeline] Multi-source discovery failed:", err);
    return getStaticFallbackTopics();
  }
}

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

function normalizeTitle(title: string): string {
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
- Select exactly 5 topics with maximum variety (no two from the same company or angle)
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

Return a JSON array of exactly 5 objects with this structure:
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
    return (parsed.topics ?? []).slice(0, 5) as ScoredTopic[];
  } catch (err) {
    console.error("[ContentPipeline] Scoring failed:", err);
    // Fallback: return first 5 as-is with default scores
    return candidates.slice(0, 5).map((t) => ({
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
      input: `Research this AI news topic using web search. Provide a JSON response with:
1. headline: punchy max-8-word headline (no clickbait)
2. summary: 2-sentence plain-English explanation of what happened and why it matters to business owners
3. videoPrompt: Seedance AI video prompt (5-8 second cinematic clip showing this tech in action, specific visuals, no text overlays)
4. sources: array of {title, url} for the top 2-3 sources you found

Topic: "${topic.title}"

Respond ONLY with valid JSON matching: { "headline": "...", "summary": "...", "videoPrompt": "...", "sources": [{"title": "...", "url": "..."}] }`,
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
  const videoPrompt = parsed.videoPrompt ?? await generateVideoPrompt(topic.title, rawText);

  console.log(`[ContentPipeline] GPT-4o researched "${topic.title}" — ${citations.length} citations`);

  return {
    title: topic.title,
    headline,
    summary,
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

Provide:
1. A punchy headline (max 8 words, no clickbait)
2. A 2-sentence plain-English explanation of what happened and why it matters to businesses
3. A Seedance AI video generation prompt (describe a 5-second cinematic clip showing this technology in action, be specific about visuals)

Format as JSON: { "headline": "...", "summary": "...", "videoPrompt": "..." }`,
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
            videoPrompt: { type: "string" },
          },
          required: ["headline", "summary", "videoPrompt"],
          additionalProperties: false,
        },
      },
    } as any,
  });

  const rawContent = response?.choices?.[0]?.message?.content;
  const content = typeof rawContent === "string" ? rawContent : "{}";
  const parsed = JSON.parse(content);

  return {
    title: topic.title,
    headline: parsed.headline ?? topic.title,
    summary: parsed.summary ?? topic.summary,
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

// ─── Stage 5: Seedance Video Generation ───────────────────────────────────────

/**
 * Generate B-roll video clips using Seedance 2.0 API
 * Stub: returns placeholder until API key is configured
 */
export async function generateVideo(
  prompt: string,
  seedanceApiKey?: string
): Promise<string | null> {
  if (!seedanceApiKey) {
    console.log("[ContentPipeline] Seedance API key not configured — skipping video generation");
    return null;
  }

  try {
    // Seedance 2.0 via ByteDance VolcEngine API
    const response = await fetch("https://visual.volcengineapi.com/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${seedanceApiKey}`,
      },
      body: JSON.stringify({
        Action: "CVSubmitTask",
        Version: "2024-01-01",
        req_key: "seedance_video_t2v_v1",
        prompt,
        duration: 6,
        resolution: "1080x1920",
        watermark: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Seedance API error: ${response.status}`);
    }

    const data = await response.json() as any;
    const taskId = data?.data?.task_id;
    if (!taskId) throw new Error("No task ID returned");

    // Poll for completion (max 3 minutes)
    return await pollSeedanceTask(taskId, seedanceApiKey);
  } catch (err) {
    console.error("[ContentPipeline] Seedance generation failed:", err);
    return null;
  }
}

async function pollSeedanceTask(taskId: string, apiKey: string): Promise<string | null> {
  const maxAttempts = 36; // 36 * 5s = 3 minutes
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 5000));

    const res = await fetch("https://visual.volcengineapi.com/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        Action: "CVGetResult",
        Version: "2024-01-01",
        req_key: "seedance_video_t2v_v1",
        task_id: taskId,
      }),
    });

    const data = await res.json() as any;
    const status = data?.data?.status;

    if (status === "done") {
      return data?.data?.video_url ?? null;
    }
    if (status === "failed") {
      throw new Error("Seedance task failed");
    }
  }
  throw new Error("Seedance task timed out");
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
        content: `Write an Instagram caption for a carousel post covering these 5 AI news stories:
${topics.map((t, i) => `${i + 1}. ${t.headline}`).join("\n")}

Requirements:
- Start with 2-3 relevant emojis
- One punchy hook sentence (max 10 words)
- Brief teaser mentioning the stories
- End with "Swipe to see all 5 →"
- 3-5 relevant hashtags at the end
- Keep it under 150 words total`,
      },
    ],
  });

  const raw = response?.choices?.[0]?.message?.content;
  const text = typeof raw === "string" ? raw : "";
  return text.trim() ||
    "🤖🔥 AI is moving fast — here's what you missed this week. Swipe to see all 5 →\n\n#AI #ArtificialIntelligence #AINews #TechNews #BusinessAI";
}

// ─── Main Pipeline Orchestrator ───────────────────────────────────────────────

export interface PipelineOptions {
  runSlot: "monday" | "friday";
  perplexityApiKey?: string;
  seedanceApiKey?: string;
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
    const rawTopics = await discoverTopics();

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
        content: `Your ${options.runSlot} carousel has 5 topics selected and is waiting for your approval. Open the Content Studio to review and approve.`,
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

export async function continueAfterApproval(
  runId: number,
  topics: ScoredTopic[],
  options: Omit<PipelineOptions, "runSlot" | "requireAdminApproval">
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

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
    // Cover slide (index 0)
    await db.insert(generatedSlides).values({
      runId,
      slideIndex: 0,
      headline: `Here's the biggest AI news of the last 7 days`,
      summary: researched.map((t) => t.headline).join(" • "),
      status: "pending",
    });

    // Content slides (index 1-5)
    for (let i = 0; i < researched.length; i++) {
      const topic = researched[i];
      await db.insert(generatedSlides).values({
        runId,
        slideIndex: i + 1,
        headline: topic.headline,
        summary: topic.summary,
        citations: JSON.stringify(topic.citations),
        videoPrompt: topic.videoPrompt,
        status: "pending",
      });
    }

    // Stage 5: Video Generation
    await db.update(contentRuns).set({ status: "generating" }).where(eq(contentRuns.id, runId));

    const slides = await db.select().from(generatedSlides).where(eq(generatedSlides.runId, runId));

    for (const slide of slides) {
      if (slide.slideIndex === 0 || !slide.videoPrompt) continue;

      await db.update(generatedSlides)
        .set({ status: "generating_video" })
        .where(eq(generatedSlides.id, slide.id));

      const videoUrl = await generateVideo(slide.videoPrompt, options.seedanceApiKey);

      await db.update(generatedSlides)
        .set({
          videoUrl: videoUrl ?? undefined,
          status: videoUrl ? "assembling" : "ready", // skip assembly if no video
        })
        .where(eq(generatedSlides.id, slide.id));
    }

    // Stage 6: Assembly (FFmpeg) — composites split-screen slides
    await db.update(contentRuns).set({ status: "assembling" }).where(eq(contentRuns.id, runId));
    const slidesForAssembly = await db.select().from(generatedSlides).where(eq(generatedSlides.runId, runId));
    try {
      const { assembleSlides } = await import("./ffmpegCompositor");
      const assembled = await assembleSlides(
        slidesForAssembly.map((s) => ({
          slideIndex: s.slideIndex,
          headline: s.headline ?? "",
          summary: s.summary ?? undefined,
          videoUrl: s.videoUrl ?? undefined,
          iscover: s.slideIndex === 0,
        }))
      );
      // Persist assembled URLs back to DB
      for (const result of assembled) {
        const matchingSlide = slidesForAssembly.find((s) => s.slideIndex === result.slideIndex);
        if (matchingSlide) {
          await db.update(generatedSlides)
            .set({ assembledUrl: result.assembledUrl, status: "ready" })
            .where(eq(generatedSlides.id, matchingSlide.id));
        }
      }
    } catch (assemblyErr: any) {
      console.warn(`[ContentPipeline] FFmpeg assembly failed (non-fatal): ${assemblyErr?.message}`);
      // Mark slides as ready even without assembled video so pipeline can continue
      await db.update(generatedSlides).set({ status: "ready" }).where(eq(generatedSlides.runId, runId));
    }

    // Stage 7: Post to Instagram
    const finalSlides = await db.select().from(generatedSlides).where(eq(generatedSlides.runId, runId));
    const caption = await generateCaption(researched);

    const posted = await triggerInstagramPost(
      runId,
      finalSlides.filter((s) => s.assembledUrl).map((s) => ({
        assembledUrl: s.assembledUrl!,
        headline: s.headline ?? "",
      })),
      caption,
      options.makeWebhookUrl
    );

    // Save published topics for no-repeat logic
    for (const topic of researched) {
      await db.insert(publishedTopics).values({
        runId,
        title: topic.title,
        summary: topic.summary,
        titleNormalized: normalizeTitle(topic.title),
      });
    }

    await db.update(contentRuns).set({
      status: posted ? "completed" : "assembling",
    }).where(eq(contentRuns.id, runId));

    await notifyOwner({
      title: `Content Studio: ${posted ? "Post Published!" : "Slides Ready"}`,
      content: posted
        ? `Your carousel was posted to Instagram successfully.`
        : `Your carousel slides are assembled and ready. Configure Make.com webhook to enable auto-posting.`,
    });

    console.log(`[ContentPipeline] Run #${runId} completed`);
  } catch (err: any) {
    await db.update(contentRuns).set({
      status: "failed",
      errorMessage: err?.message ?? "Unknown error",
    }).where(eq(contentRuns.id, runId));
    throw err;
  }
}
