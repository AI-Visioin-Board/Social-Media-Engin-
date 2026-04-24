// ============================================================
// AI News You Can Use — Educational Topic Research Pipeline
// Discovers actionable, usable AI tools/features from the last 30 days.
// Filters for recency, usability (non-technical), and wow factor.
// ============================================================

import { ENV } from "./_core/env.js";
import { TIER1_SOURCES, isTier1Source } from "../videogen-avatar/src/prompts/quinnPersona.js";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

// ─── Types ──────────────────────────────────────────────────

export interface RawTopic {
  title: string;
  source: "news" | "reddit" | "gpt_search";
  url: string;
  publishedAt?: string;
}

export interface ScoredTopic {
  title: string;
  url: string;
  scores: {
    shareability: number;
    saveWorthiness: number;
    usability: number;
    wowFactor: number;
    personalImpact: number;
    userRelevance: number;
    newsHook: number;
  };
  weightedScore: number;
  summary: string;
  angle: string; // the "here's what you can do" angle
}

export interface SourceArticle {
  url: string;
  domain: string;
  title: string;
  publishedAt: string | null;
  bodyExcerpt: string;
  credibilityTier: "tier1" | "other";
}

export interface VerifiedFact {
  fact: string;
  sourceUrl: string;
  sourceIndex: number;
}

export interface VerifiedTopic extends ScoredTopic {
  sources: SourceArticle[];
  facts: VerifiedFact[];
  verificationStatus: "verified_3plus" | "insufficient_sources" | "unverified";
}

// ─── OpenAI Retry Helper ─────────────────────────────────────
// OpenAI's Responses + Chat endpoints occasionally return 502 / 503 / 504 via
// Cloudflare when upstream is overloaded. These are transient — retrying with
// small backoff clears them in the vast majority of cases. Without this, a
// single upstream blip kills an entire topic's research (which is a ~$0.20 +
// 60-second loss per failed topic).
//
// Only retries on 5xx responses and network/abort errors. 4xx (auth, rate
// limits with explicit 429 retry-after) are surfaced immediately.
async function fetchOpenAIWithRetry(
  url: string,
  init: RequestInit,
  { maxAttempts = 3, baseDelayMs = 800 }: { maxAttempts?: number; baseDelayMs?: number } = {},
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      // Retry only on 5xx (upstream/Cloudflare issues). 4xx is a real error.
      if (res.status >= 500 && attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1); // 800ms, 1600ms, 3200ms
        console.warn(`[AINYCU Research] OpenAI ${res.status} on ${url.split("/").pop()} — retry ${attempt}/${maxAttempts - 1} in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return res; // Non-5xx: return as-is, caller inspects .ok
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.warn(`[AINYCU Research] OpenAI fetch threw (${(err as Error).message?.slice(0, 80)}) — retry ${attempt}/${maxAttempts - 1} in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr ?? new Error("OpenAI fetch failed after retries");
}

// ─── Scoring Prompt (Educational / Usability Focus) ─────────

const AINYCU_SCORING_PROMPT = `SCORING FOR "AI NEWS YOU CAN USE" EDUCATIONAL REELS (score each factor 1-10):

This series is EDUCATIONAL but VIRAL — topics must (a) be things a non-technical person can actually DO or USE right now AND (b) carry a news hook that stops the scroll ("X just dropped", "Y just killed Z", "CEO says this is 10x better").

1. SHAREABILITY (weight: 5x) — Would someone share this with a friend, coworker, or repost it?
   - 10: "You NEED to see this" — carries a headline hook someone wants to pass on
   - 7-9: "This is cool, check it out"
   - 4-6: "Interesting"
   - 1-3: "Meh" — no reason to forward

2. SAVE-WORTHINESS (weight: 5x) — Would someone bookmark this to try later?
   - 10: Step-by-step tutorial they'll come back to. Actionable instructions.
   - 7-9: Useful tool they want to remember
   - 4-6: Interesting but they won't revisit
   - 1-3: No lasting value

3. USABILITY (weight: 6x) — Can a NON-TECHNICAL person actually do this?
   - 10: Open your phone, tap 3 buttons, done. Grandma could do it.
   - 8-9: Takes some setup (install extension, configure settings) but steps are clear
   - 6-7: Moderate learning curve but doable for someone motivated
   - 4-5: Requires some technical comfort (settings, configurations)
   - 2-3: Needs developer tools, terminal, or coding
   - 1: Only for engineers/researchers

4. WOW FACTOR (weight: 6x) — Does this make someone say "wait, I can do THAT?"
   - 10: Mind-blowing capability that feels like magic, makes Quinn's jaw drop on camera
   - 7-9: Genuinely surprising — not the same story everyone already covered
   - 4-6: Useful but not surprising
   - 1-3: Boring/expected, no jaw-drop moment

5. PERSONAL IMPACT (weight: 2x) — Does this affect the viewer's daily life or work?
   - 10: Saves hours per week, changes how they work
   - 7-9: Saves real time or money
   - 4-6: Nice to have
   - 1-3: Abstract/theoretical

6. USER RELEVANCE (weight: 3x) — How broadly applicable is this?
   - 10: Everyone with a phone/computer can use this
   - 8-9: Most office workers or students
   - 6-7: Specific but large group (small biz owners, freelancers)
   - 4-5: Niche audience
   - 1-3: Very niche/technical

7. NEWS HOOK / VIRALITY (weight: 5x) — Does this story carry its own headline hook?
   - 10: "X just killed Y", "just dropped today", "CEO nuked the competition", "first AI to do Z"
   - 7-9: Clear recency + novelty angle ("new update", "just announced", "launches public beta")
   - 4-6: Interesting feature but no news-hook framing available
   - 1-3: Generic evergreen tip with no timely angle — already been covered a dozen times
   - 1: Old news — story is more than ~30 days old or has been widely saturated

FORMULA: ((share×5) + (save×5) + (usability×6) + (wow×6) + (impact×2) + (relevance×3) + (viral×5)) / 32

Topics scoring below 5.5 should be REJECTED.
Topics scoring 7.0+ are EXCELLENT — these are the ones that will actually move follower counts.

CRITICAL FILTERS — REJECT topics that:
- Are research papers or academic findings
- Are enterprise/B2B-only features with no consumer access
- Are vague "AI is changing everything" stories with no actionable takeaway
- Require writing code or using a terminal
- Were sunset, recalled, or are in closed beta
- Are not available RIGHT NOW (no "coming soon")
`;

// ─── Step 1: Multi-Source Discovery (30-day window) ─────────

export async function discoverTopics(): Promise<RawTopic[]> {
  console.log("[AINYCU Research] Starting educational topic discovery...");

  const [newsTopics, redditTopics, gptTopics] = await Promise.allSettled([
    discoverFromNewsAPI(),
    discoverFromReddit(),
    discoverFromGPTWebSearch(),
  ]);

  const all: RawTopic[] = [];
  if (newsTopics.status === "fulfilled") all.push(...newsTopics.value);
  if (redditTopics.status === "fulfilled") all.push(...redditTopics.value);
  if (gptTopics.status === "fulfilled") all.push(...gptTopics.value);

  console.log(`[AINYCU Research] Discovered ${all.length} raw topics`);
  return deduplicateTopics(all);
}

async function discoverFromNewsAPI(): Promise<RawTopic[]> {
  const apiKey = ENV.newsApiKey;
  if (!apiKey) return [];

  const daysBack = 10; // Tighter window — "just dropped" virality decays fast
  const from = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  // News-hookable phrasing: we want stories that carry a built-in hook
  // (launch, announcement, beats competitor, kills category) — not generic
  // "AI productivity" features that have been covered a dozen times.
  const queries = [
    "AI agent just launched",
    "new AI tool released this week",
    "AI feature beats ChatGPT",
    "Anthropic Claude announcement",
    "OpenAI ChatGPT new capability",
    "Google Gemini drops",
    "AI startup raises viral",
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
              source: "news",
              url: article.url ?? "",
              publishedAt: article.publishedAt,
            });
          }
        }
      } catch { /* skip */ }
    })
  );

  return results;
}

async function discoverFromReddit(): Promise<RawTopic[]> {
  // Subreddits focused on usable AI tools, not academic ML
  const subreddits = ["ChatGPT", "ClaudeAI", "perplexity_ai", "GoogleGeminiAI", "artificial", "singularity"];
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
        for (const { data: post } of (data?.data?.children ?? [])) {
          if (post?.title && post.score > 50) {
            results.push({
              title: post.title.slice(0, 120),
              source: "reddit",
              url: `https://reddit.com${post.permalink}`,
            });
          }
        }
      } catch { /* skip */ }
    })
  );

  return results;
}

async function discoverFromGPTWebSearch(): Promise<RawTopic[]> {
  if (!ENV.openaiApiKey) return [];

  const today = new Date();
  const todayStr = today.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const cutoff = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const cutoffStr = cutoff.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const queries = [
    `Today is ${todayStr}. Search for 6 AI tools or features that JUST DROPPED (released or announced AFTER ${cutoffStr}) and are going VIRAL right now on X/Twitter, Reddit, or Hacker News. Prefer stories with a built-in hook: new agent that outperforms competitors, a tool that just killed an entire category, a CEO making a bold claim, a surprise capability no one expected. Must be AVAILABLE NOW (not coming soon) and usable by a non-technical person. Return ONLY a JSON array: [{"title": "news-hookable headline — what just happened + why it matters", "url": "source url", "source": "news", "angle": "one sentence: here's what you can do with it"}]`,
    `Today is ${todayStr}. Search for 6 AI agents, copilots, or automations released AFTER ${cutoffStr} that DO something surprising (not just chat): book meetings, control your computer, send emails, run research, manage files, integrate with Slack/Gmail/Notion. Prioritize tools with multiple impressive named features — not one-trick apps. Return ONLY a JSON array: [{"title": "headline naming the tool + its strongest capability", "url": "source url", "source": "news", "angle": "one sentence: here's what you can do"}]`,
    `Today is ${todayStr}. Search for 4 AI news stories from the last 10 days where a NEW TOOL or FEATURE is being positioned as beating, killing, or replacing an incumbent (e.g., "X kills Y", "the new ChatGPT killer", "startup outperforms OpenAI", "CEO says our tool is 10x better"). The story must center on a real, usable product — not research papers. Return ONLY a JSON array: [{"title": "headline with the conflict/comparison framing", "url": "source url", "source": "news", "angle": "one sentence: here's what you can do"}]`,
  ];

  const results: RawTopic[] = [];
  await Promise.allSettled(
    queries.map(async (query) => {
      try {
        const response = await fetchOpenAIWithRetry("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ENV.openaiApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: ENV.openaiModel,
            tools: [{ type: "web_search_preview" }],
            input: query,
          }),
          signal: AbortSignal.timeout(90_000),
        });
        if (!response.ok) return;
        const data = await response.json() as any;
        const textItem = (data?.output ?? []).find((o: any) => o.type === "message");
        const rawText: string = textItem?.content?.[0]?.text ?? "[]";
        const jsonMatch = rawText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          for (const t of parsed) {
            if (t.title && t.url) {
              results.push({ title: t.title, source: "gpt_search", url: t.url });
            }
          }
        }
      } catch { /* skip */ }
    })
  );

  return results;
}

function deduplicateTopics(topics: RawTopic[]): RawTopic[] {
  const seen: string[][] = [];
  return topics.filter((topic) => {
    const words = topic.title.toLowerCase().split(/\s+/);
    for (const prev of seen) {
      if (hasConsecutiveOverlap(words, prev, 3)) return false;
    }
    seen.push(words);
    return true;
  });
}

function hasConsecutiveOverlap(a: string[], b: string[], minLen: number): boolean {
  for (let i = 0; i <= a.length - minLen; i++) {
    const segment = a.slice(i, i + minLen).join(" ");
    const bStr = b.join(" ");
    if (bStr.includes(segment)) return true;
  }
  return false;
}

// ─── Step 2: Educational / Usability Scoring ────────────────

export async function scoreAndSelectTopics(topics: RawTopic[], count: number = 3): Promise<ScoredTopic[]> {
  if (topics.length === 0) throw new Error("No topics to score");

  console.log(`[AINYCU Research] Scoring ${topics.length} topics for usability...`);

  const topicList = topics.map((t, i) => `${i + 1}. ${t.title}`).join("\n");

  const response = await fetchOpenAIWithRetry("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ENV.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: ENV.openaiModel,
      messages: [
        {
          role: "system",
          content: `You are a content strategist for an AI education Instagram Reels series called "AI News You Can Use." The audience is non-technical: freelancers, small business owners, students, curious people. You score topics for USABILITY and educational value — can a regular person actually do this?\n\n${AINYCU_SCORING_PROMPT}`,
        },
        {
          role: "user",
          content: `Score these topics and select the best ${count} for educational Reels. For each selected topic, provide all 7 scores, a 1-sentence summary, AND a "here's what you can do" angle.\n\nTopics:\n${topicList}\n\nReturn JSON: {"selected": [{"index": number, "title": "string", "summary": "1 sentence", "angle": "the specific here's what you can do angle", "scores": {"shareability": N, "saveWorthiness": N, "usability": N, "wowFactor": N, "personalImpact": N, "userRelevance": N, "newsHook": N}}]}`,
        },
      ],
      temperature: 0.5,
      max_completion_tokens: 2000,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(`OpenAI scoring error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty scoring response");

  const parsed = JSON.parse(content);
  const selected: ScoredTopic[] = (parsed.selected ?? []).map((s: any) => {
    const idx = (s.index ?? 1) - 1;
    const originalTopic = topics[idx] ?? topics[0];
    const scores = {
      shareability: clamp(s.scores?.shareability ?? 5, 1, 10),
      saveWorthiness: clamp(s.scores?.saveWorthiness ?? 5, 1, 10),
      usability: clamp(s.scores?.usability ?? 5, 1, 10),
      wowFactor: clamp(s.scores?.wowFactor ?? 5, 1, 10),
      personalImpact: clamp(s.scores?.personalImpact ?? 5, 1, 10),
      userRelevance: clamp(s.scores?.userRelevance ?? 5, 1, 10),
      newsHook: clamp(s.scores?.newsHook ?? 5, 1, 10),
    };
    const weightedScore = Math.round(
      ((scores.shareability * 5) + (scores.saveWorthiness * 5) +
       (scores.usability * 6) + (scores.wowFactor * 6) +
       (scores.personalImpact * 2) + (scores.userRelevance * 3) +
       (scores.newsHook * 5)) / 32 * 10
    ) / 10;

    return {
      title: s.title ?? originalTopic.title,
      url: originalTopic.url,
      scores,
      weightedScore,
      summary: s.summary ?? "",
      angle: s.angle ?? "",
    };
  });

  selected.sort((a, b) => b.weightedScore - a.weightedScore);
  return selected.slice(0, count);
}

// ─── Step 3: Deep Verification ──────────────────────────────

export async function verifyTopic(topic: ScoredTopic): Promise<VerifiedTopic> {
  console.log(`[AINYCU Research] Verifying: "${topic.title.slice(0, 60)}..."`);

  // Deep search: fan out across 4 complementary SERP queries + 2 doc searches
  // so we capture the FULL breadth of a tool (features, integrations, automations,
  // use cases) instead of whatever single angle the base query happens to surface.
  const sources = await deepSearch(topic.title);

  const tier1Count = sources.filter(s => s.credibilityTier === "tier1").length;
  const verificationStatus = tier1Count >= 3 ? "verified_3plus" as const
    : tier1Count >= 1 ? "insufficient_sources" as const
    : "unverified" as const;

  let facts: VerifiedFact[] = [];
  if (sources.length > 0) {
    facts = await extractFacts(topic.title, sources);
  }

  return {
    ...topic,
    sources,
    facts,
    verificationStatus,
  };
}

// ─── Official Docs Deep Dive ───────────────────────────────
// Uses GPT web search to find the tool's official product/feature page,
// changelog, or docs — where specific feature names live.

async function fetchOfficialDocs(topic: string): Promise<SourceArticle[]> {
  if (!ENV.openaiApiKey) return [];

  try {
    const response = await fetchOpenAIWithRetry("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ENV.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ENV.openaiModel,
        tools: [{ type: "web_search_preview" }],
        input: `Find the OFFICIAL product page, feature list, or documentation for this AI tool/feature: "${topic}". I need the page that lists SPECIFIC named features, capabilities, integrations, and pricing tiers. Look for: the tool's official website feature page, changelog, release blog post from the company itself, or developer docs. Return ONLY a JSON array of up to 4 URLs with titles: [{"url": "https://...", "title": "page title"}]`,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) return [];
    const data = await response.json() as any;
    const textItem = (data?.output ?? []).find((o: any) => o.type === "message");
    const rawText: string = textItem?.content?.[0]?.text ?? "[]";
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    const sources: SourceArticle[] = [];

    await Promise.allSettled(
      parsed.slice(0, 4).map(async (item: any) => {
        if (!item?.url) return;
        try {
          const res = await fetch(item.url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; SuggestedByGPT/1.0; +https://suggestedbygpt.com)",
              Accept: "text/html",
            },
            signal: AbortSignal.timeout(10_000),
            redirect: "follow",
          });
          if (!res.ok) return;
          const html = await res.text();
          const dom = new JSDOM(html, { url: item.url });
          const reader = new Readability(dom.window.document);
          const article = reader.parse();
          if (article?.textContent && article.textContent.length > 100) {
            sources.push({
              url: item.url,
              domain: extractDomain(item.url),
              title: article.title || item.title || "",
              publishedAt: null,
              bodyExcerpt: article.textContent.slice(0, 3000), // longer excerpt for docs
              credibilityTier: isTier1Source(item.url) ? "tier1" : "other",
            });
          }
        } catch { /* skip */ }
      })
    );

    console.log(`[AINYCU Research] Found ${sources.length} official doc pages for "${topic.slice(0, 40)}..."`);
    return sources;
  } catch {
    return [];
  }
}

// ─── Deep Multi-Angle Search ───────────────────────────────
// Runs 4 SERP queries + 2 official-docs searches in parallel, deduped by URL.
// Ensures we capture integrations, capabilities, automations, and use cases —
// not just whatever angle the base-title query happens to surface.
// This is what stops the "Manus helps with Slack" single-fact narrowness.
async function deepSearch(topic: string): Promise<SourceArticle[]> {
  const base = topic.trim();
  const serpQueries = [
    base,
    `${base} features capabilities`,
    `${base} integrations connections apps`,
    `${base} use cases examples 2026`,
  ];

  // Use allSettled: isolate failures per query so one timeout doesn't kill the
  // whole deep search. searchSERP/fetchOfficialDocs already return [] on error
  // internally, but allSettled is the belt-and-suspenders contract.
  const [serpSettled, officialSettled, changelogSettled] = await Promise.all([
    Promise.allSettled(serpQueries.map(q => searchSERP(q))),
    Promise.allSettled([fetchOfficialDocs(topic)]),
    Promise.allSettled([fetchOfficialDocs(`${topic} changelog release notes what's new`)]),
  ]);

  const serpBuckets = serpSettled.map(r => r.status === "fulfilled" ? r.value : []);
  const officialDocs = officialSettled[0]?.status === "fulfilled" ? officialSettled[0].value : [];
  const changelogDocs = changelogSettled[0]?.status === "fulfilled" ? changelogSettled[0].value : [];

  // Merge + dedupe SERP results by URL (preserves within-bucket order)
  const seen = new Set<string>();
  const mergedSerp: Array<{ url: string; title: string; snippet: string; date?: string }> = [];
  for (const bucket of serpBuckets) {
    for (const r of bucket) {
      if (!r.url || seen.has(r.url)) continue;
      seen.add(r.url);
      mergedSerp.push(r);
    }
  }

  // Prioritize tier-1 sources; within each tier, preserve the merged order
  // (which already reflects the query bucket priority: base title first).
  // stable sort is guaranteed in modern Node/V8.
  mergedSerp.sort((a, b) => {
    const aTier = isTier1Source(a.url) ? 0 : 1;
    const bTier = isTier1Source(b.url) ? 0 : 1;
    return aTier - bTier;
  });

  const articleSources = await fetchArticleBodies(mergedSerp.slice(0, 12));

  // Merge docs, dedupe against article URLs
  const allDocs = [...officialDocs, ...changelogDocs];
  const docSeen = new Set(articleSources.map(s => s.url));
  const uniqueDocs = allDocs.filter(d => {
    if (docSeen.has(d.url)) return false;
    docSeen.add(d.url);
    return true;
  });

  const combined = [...articleSources, ...uniqueDocs];
  console.log(`[AINYCU Research] Deep search: ${serpBuckets.reduce((s, b) => s + b.length, 0)} SERP hits → ${mergedSerp.length} unique → ${articleSources.length} articles + ${uniqueDocs.length} docs = ${combined.length} sources`);
  return combined;
}

async function searchSERP(query: string): Promise<Array<{ url: string; title: string; snippet: string; date?: string }>> {
  const serpKey = ENV.serpApiKey;
  if (!serpKey) return [];

  try {
    const params = new URLSearchParams({
      engine: "google",
      q: query,
      api_key: serpKey,
      num: "10",
    });

    const res = await fetch(`https://serpapi.com/search.json?${params}`, {
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) return [];

    const data = await res.json() as any;
    const organic = data.organic_results ?? [];

    return organic.map((r: any) => ({
      url: r.link ?? "",
      title: r.title ?? "",
      snippet: r.snippet ?? "",
      date: r.date ?? null,
    })).filter((r: any) => r.url);
  } catch {
    return [];
  }
}

async function fetchArticleBodies(
  serpResults: Array<{ url: string; title: string; snippet: string; date?: string }>,
): Promise<SourceArticle[]> {
  // Caller controls how many results to fetch. deepSearch() passes a pre-trimmed
  // list (~12 URLs); any legacy caller passing raw SERP results can still cap
  // itself with .slice() before calling.
  const sources: SourceArticle[] = [];

  await Promise.allSettled(
    serpResults.map(async (result) => {
      const domain = extractDomain(result.url);
      const credibilityTier = isTier1Source(result.url) ? "tier1" as const : "other" as const;

      try {
        const res = await fetch(result.url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; SuggestedByGPT/1.0; +https://suggestedbygpt.com)",
            Accept: "text/html",
          },
          signal: AbortSignal.timeout(10_000),
          redirect: "follow",
        });

        if (!res.ok) {
          if (result.snippet && result.snippet.length > 20) {
            sources.push({ url: result.url, domain, title: result.title, publishedAt: result.date ?? null, bodyExcerpt: `[SERP snippet] ${result.snippet}`, credibilityTier });
          }
          return;
        }

        const html = await res.text();
        const dom = new JSDOM(html, { url: result.url });
        const reader = new Readability(dom.window.document);
        const article = reader.parse();

        if (article?.textContent && article.textContent.length > 100) {
          sources.push({ url: result.url, domain, title: article.title || result.title, publishedAt: result.date ?? null, bodyExcerpt: article.textContent.slice(0, 2000), credibilityTier });
        } else if (result.snippet) {
          sources.push({ url: result.url, domain, title: result.title, publishedAt: result.date ?? null, bodyExcerpt: `[SERP snippet] ${result.snippet}`, credibilityTier });
        }
      } catch {
        if (result.snippet && result.snippet.length > 20) {
          sources.push({ url: result.url, domain, title: result.title, publishedAt: result.date ?? null, bodyExcerpt: `[SERP snippet] ${result.snippet}`, credibilityTier });
        }
      }
    })
  );

  return sources;
}

// ─── Step 4: Fact Extraction (with usability focus) ─────────

async function extractFacts(topic: string, sources: SourceArticle[]): Promise<VerifiedFact[]> {
  if (!ENV.openaiApiKey) return [];

  const articlesContext = sources
    .map((s, i) => `[Source ${i + 1}] ${s.title} (${s.domain})\nURL: ${s.url}\n${s.bodyExcerpt}`)
    .join("\n\n---\n\n");

  try {
    const response = await fetchOpenAIWithRetry("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ENV.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: ENV.openaiModel,
        messages: [
          {
            role: "system",
            content: `You are a fact extraction assistant for an educational AI series. Extract verified facts from articles, with a focus on ACTIONABLE information — what the tool/feature does, how to access it, specific steps to use it. You NEVER add information not in the sources.`,
          },
          {
            role: "user",
            content: `Topic: ${topic}\n\nExtract key facts, prioritizing the most IMPRESSIVE and USEFUL capabilities:\n\n1. FEATURES & CAPABILITIES (highest priority):\n   - What can this tool actually DO? List specific NAMED features (proper nouns, menu items, branded feature names).\n   - What integrations, plugins, or connections does it have? Name each one.\n   - What automations or workflows does it enable?\n   - What makes it different from just chatting with an AI?\n\n2. ACCESS & SETUP:\n   - How do you access it? (URL, app, extension, etc.)\n   - What account/plan is required?\n\n3. CONCRETE USE CASES:\n   - Real examples of what someone could accomplish with this\n   - Time saved, tasks automated, problems solved\n\nArticles:\n${articlesContext}\n\nReturn JSON: {"facts": [{"fact": "specific factual claim, feature, or capability", "sourceUrl": "article URL", "sourceIndex": 1}]}\n\nRULES:\n- Extract 8-15 facts\n- CRITICAL: Each fact MUST describe a DIFFERENT capability or feature. No two facts should describe the same thing in different words. If "organize files" is fact #1, you cannot have "manage documents" as fact #5 — that's the same thing.\n- Use the tool's OFFICIAL feature names when available (e.g., "Tasks", "Scheduled Tasks", "Dispatch", "MCP connectors" — not vague descriptions like "it can do things automatically")\n- Lead with the WOW features — the capabilities that make someone say "wait, it can do THAT?"\n- Include specific integrations, plugins, tools, or services it connects to\n- Include specific automations or scheduled tasks it can handle\n- Each fact must be in at least one source\n- Do NOT add claims not in the articles\n- Do NOT waste facts on generic "AI is powerful" statements — be SPECIFIC\n- VARIETY CHECK: Before returning, verify that your 8-15 facts cover at least 5 DISTINCT feature categories. If you have 3 facts about the same category, cut 2 and find facts about other capabilities.`,
          },
        ],
        temperature: 0.2,
        max_completion_tokens: 2000,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) return [];
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return [];

    const parsed = JSON.parse(content);
    return (parsed.facts ?? []).map((f: any) => ({
      fact: String(f.fact ?? ""),
      sourceUrl: String(f.sourceUrl ?? ""),
      sourceIndex: Number(f.sourceIndex ?? 0),
    }));
  } catch {
    return [];
  }
}

// ─── Full Research Pipeline ─────────────────────────────────

export interface AinycuResearchResult {
  candidates: VerifiedTopic[];
  totalDiscovered: number;
  totalAfterDedup: number;
}

export async function runFullResearch(suggestedTopic?: string): Promise<AinycuResearchResult> {
  // Fast path: user suggested a topic — skip discovery, verify directly
  if (suggestedTopic) {
    console.log(`[AINYCU Research] User-suggested topic: "${suggestedTopic}"`);

    const preScored: ScoredTopic = {
      title: suggestedTopic,
      url: "",
      scores: { shareability: 8, saveWorthiness: 9, usability: 9, wowFactor: 8, personalImpact: 8, userRelevance: 9, newsHook: 8 },
      weightedScore: 8.5,
      summary: suggestedTopic,
      angle: "",
    };

    const verified = await verifyTopic(preScored);
    return { candidates: [verified], totalDiscovered: 1, totalAfterDedup: 1 };
  }

  // Normal path: full discovery
  const rawTopics = await discoverTopics();
  if (rawTopics.length === 0) throw new Error("No topics discovered from any source");

  const scored = await scoreAndSelectTopics(rawTopics, 5);

  const verifiedResults = await Promise.allSettled(scored.map(topic => verifyTopic(topic)));
  const verified: VerifiedTopic[] = [];
  for (const result of verifiedResults) {
    if (result.status === "fulfilled") verified.push(result.value);
  }

  const qualified = verified.filter(t => t.verificationStatus === "verified_3plus");
  let candidates: VerifiedTopic[];
  if (qualified.length >= 3) {
    candidates = qualified.slice(0, 3);
  } else {
    const sorted = verified.sort((a, b) => {
      const order: Record<string, number> = { verified_3plus: 0, insufficient_sources: 1, unverified: 2 };
      return (order[a.verificationStatus] ?? 3) - (order[b.verificationStatus] ?? 3);
    });
    candidates = sorted.slice(0, 3);
  }

  return { candidates, totalDiscovered: rawTopics.length, totalAfterDedup: rawTopics.length };
}

// ─── Helpers ────────────────────────────────────────────────

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return "unknown"; }
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
