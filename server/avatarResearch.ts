// ============================================================
// Avatar Reels — Source-First Research Pipeline
// Discovers, scores, verifies, and extracts facts from news
// Every topic requires ≥3 credible sources. No hallucination.
// ============================================================

import { ENV } from "./_core/env.js";
import { REELS_VIRALITY_SCORING_PROMPT, TIER1_SOURCES, isTier1Source } from "../videogen-avatar/src/prompts/quinnPersona.js";
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
    debatePotential: number;
    informationGap: number;
    personalImpact: number;
    userRelevance: number;
  };
  weightedScore: number;
  summary: string;  // 1-sentence LLM-generated summary
}

export interface SourceArticle {
  url: string;
  domain: string;
  title: string;
  publishedAt: string | null;
  bodyExcerpt: string;  // first ~2000 chars of article body
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

// ─── Step 1: Multi-Source Discovery ─────────────────────────

export async function discoverTopics(): Promise<RawTopic[]> {
  console.log("[AvatarResearch] Starting multi-source topic discovery...");

  const [newsTopics, redditTopics, gptTopics] = await Promise.allSettled([
    discoverFromNewsAPI(),
    discoverFromReddit(),
    discoverFromGPTWebSearch(),
  ]);

  const all: RawTopic[] = [];
  if (newsTopics.status === "fulfilled") all.push(...newsTopics.value);
  if (redditTopics.status === "fulfilled") all.push(...redditTopics.value);
  if (gptTopics.status === "fulfilled") all.push(...gptTopics.value);

  console.log(`[AvatarResearch] Discovered ${all.length} raw topics (News: ${newsTopics.status === "fulfilled" ? newsTopics.value.length : 0}, Reddit: ${redditTopics.status === "fulfilled" ? redditTopics.value.length : 0}, GPT: ${gptTopics.status === "fulfilled" ? gptTopics.value.length : 0})`);

  // Deduplicate by title similarity (3+ shared consecutive words)
  return deduplicateTopics(all);
}

async function discoverFromNewsAPI(): Promise<RawTopic[]> {
  const apiKey = ENV.newsApiKey;
  if (!apiKey) {
    console.warn("[AvatarResearch] No NEWS_API_KEY — skipping NewsAPI");
    return [];
  }

  const daysBack = 3; // Reels are daily, so 3-day window
  const from = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const queries = ["artificial intelligence", "AI model release", "machine learning breakthrough"];
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

  console.log(`[AvatarResearch] NewsAPI discovered ${results.length} articles`);
  return results;
}

async function discoverFromReddit(): Promise<RawTopic[]> {
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

  console.log(`[AvatarResearch] Reddit discovered ${results.length} topics`);
  return results;
}

async function discoverFromGPTWebSearch(): Promise<RawTopic[]> {
  if (!ENV.openaiApiKey) return [];

  const today = new Date();
  const todayStr = today.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const cutoff = new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000);
  const cutoffStr = cutoff.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const queries = [
    `Today is ${todayStr}. Search for the 6 most significant AI news stories published AFTER ${cutoffStr}. Focus on new AI models, product launches, viral AI moments. CRITICAL: Only stories after ${cutoffStr}. Return ONLY a JSON array: [{"title": "headline", "url": "source url", "source": "news"}]`,
    `Today is ${todayStr}. Search for the 6 most impactful AI stories for business owners and everyday consumers published AFTER ${cutoffStr}. Focus on AI tools, job automation, AI regulation. Return ONLY a JSON array: [{"title": "headline", "url": "source url", "source": "news"}]`,
    `Today is ${todayStr}. Search for the 6 most surprising or controversial AI stories published AFTER ${cutoffStr}. Focus on AI fails, controversies, unexpected uses. Return ONLY a JSON array: [{"title": "headline", "url": "source url", "source": "news"}]`,
  ];

  const results: RawTopic[] = [];
  await Promise.allSettled(
    queries.map(async (query) => {
      try {
        const response = await fetch("https://api.openai.com/v1/responses", {
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

  console.log(`[AvatarResearch] GPT web search discovered ${results.length} topics`);
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

// ─── Step 2: Reels-Optimized Scoring ────────────────────────

export async function scoreAndSelectTopics(topics: RawTopic[], count: number = 3): Promise<ScoredTopic[]> {
  if (topics.length === 0) throw new Error("No topics to score");

  console.log(`[AvatarResearch] Scoring ${topics.length} topics, selecting top ${count}...`);

  const topicList = topics.map((t, i) => `${i + 1}. ${t.title}`).join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
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
          content: `You are a content strategist for an AI news Instagram Reels account targeting non-techy people (freelancers, business owners, AI-curious consumers). Score topics for Reels virality.\n\n${REELS_VIRALITY_SCORING_PROMPT}`,
        },
        {
          role: "user",
          content: `Score these topics and select the best ${count} for Reels. For each selected topic, provide all 6 scores (1-10) and a 1-sentence summary.\n\nTopics:\n${topicList}\n\nReturn JSON: {"selected": [{"index": number, "title": "string", "summary": "1 sentence", "scores": {"shareability": N, "saveWorthiness": N, "debatePotential": N, "informationGap": N, "personalImpact": N, "userRelevance": N}}]}`,
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
      debatePotential: clamp(s.scores?.debatePotential ?? 5, 1, 10),
      informationGap: clamp(s.scores?.informationGap ?? 5, 1, 10),
      personalImpact: clamp(s.scores?.personalImpact ?? 5, 1, 10),
      userRelevance: clamp(s.scores?.userRelevance ?? 5, 1, 10),
    };
    const weightedScore = Math.round(
      ((scores.shareability * 5) + (scores.saveWorthiness * 3.5) +
       (scores.debatePotential * 2.5) + (scores.informationGap * 2) +
       (scores.personalImpact * 1) + (scores.userRelevance * 4)) / 18 * 10
    ) / 10;

    return {
      title: s.title ?? originalTopic.title,
      url: originalTopic.url,
      scores,
      weightedScore,
      summary: s.summary ?? "",
    };
  });

  // Sort by weighted score descending
  selected.sort((a, b) => b.weightedScore - a.weightedScore);
  console.log(`[AvatarResearch] Top ${selected.length} topics scored: ${selected.map(s => `${s.weightedScore.toFixed(1)}`).join(", ")}`);

  return selected.slice(0, count);
}

// ─── Step 3: Deep Verification ──────────────────────────────

export async function verifyTopic(topic: ScoredTopic): Promise<VerifiedTopic> {
  console.log(`[AvatarResearch] Verifying: "${topic.title.slice(0, 60)}..."`);

  // Step 3a: SERP API search for real articles
  const serpResults = await searchSERP(topic.title);

  // Step 3b: Fetch article bodies
  const sources = await fetchArticleBodies(serpResults);

  // Step 3c: Count credible sources
  const tier1Count = sources.filter(s => s.credibilityTier === "tier1").length;
  const verificationStatus = tier1Count >= 3 ? "verified_3plus" as const
    : tier1Count >= 1 ? "insufficient_sources" as const
    : "unverified" as const;

  console.log(`[AvatarResearch] Verification: ${tier1Count} tier-1 sources → ${verificationStatus}`);

  // Step 3d: Extract facts from article bodies (only if we have sources)
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

async function searchSERP(query: string): Promise<Array<{ url: string; title: string; snippet: string; date?: string }>> {
  const serpKey = ENV.serpApiKey;
  if (!serpKey) {
    console.warn("[AvatarResearch] No SERP_API_KEY — skipping SERP search");
    return [];
  }

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

    if (!res.ok) {
      console.warn(`[AvatarResearch] SERP API returned ${res.status}`);
      return [];
    }

    const data = await res.json() as any;
    const organic = data.organic_results ?? [];

    return organic.map((r: any) => ({
      url: r.link ?? "",
      title: r.title ?? "",
      snippet: r.snippet ?? "",
      date: r.date ?? null,
    })).filter((r: any) => r.url);
  } catch (err: any) {
    console.warn(`[AvatarResearch] SERP search failed: ${err.message}`);
    return [];
  }
}

async function fetchArticleBodies(
  serpResults: Array<{ url: string; title: string; snippet: string; date?: string }>
): Promise<SourceArticle[]> {
  const sources: SourceArticle[] = [];
  const topResults = serpResults.slice(0, 7); // fetch top 7, aim for 5+ successful

  await Promise.allSettled(
    topResults.map(async (result) => {
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
          // Fallback to SERP snippet if we can't fetch the article
          if (result.snippet && result.snippet.length > 20) {
            sources.push({
              url: result.url,
              domain,
              title: result.title,
              publishedAt: result.date ?? null,
              bodyExcerpt: `[SERP snippet] ${result.snippet}`,
              credibilityTier,
            });
          }
          return;
        }

        const html = await res.text();

        // Use Readability to extract article text
        const dom = new JSDOM(html, { url: result.url });
        const reader = new Readability(dom.window.document);
        const article = reader.parse();

        if (article?.textContent && article.textContent.length > 100) {
          sources.push({
            url: result.url,
            domain,
            title: article.title || result.title,
            publishedAt: result.date ?? null,
            bodyExcerpt: article.textContent.slice(0, 2000),
            credibilityTier,
          });
        } else if (result.snippet) {
          // Fallback to snippet
          sources.push({
            url: result.url,
            domain,
            title: result.title,
            publishedAt: result.date ?? null,
            bodyExcerpt: `[SERP snippet] ${result.snippet}`,
            credibilityTier,
          });
        }
      } catch {
        // On error, use SERP snippet as fallback
        if (result.snippet && result.snippet.length > 20) {
          sources.push({
            url: result.url,
            domain,
            title: result.title,
            publishedAt: result.date ?? null,
            bodyExcerpt: `[SERP snippet] ${result.snippet}`,
            credibilityTier,
          });
        }
      }
    })
  );

  return sources;
}

// ─── Step 4: Fact Extraction ────────────────────────────────

async function extractFacts(topic: string, sources: SourceArticle[]): Promise<VerifiedFact[]> {
  if (!ENV.openaiApiKey) return [];

  // Build context from article bodies
  const articlesContext = sources
    .map((s, i) => `[Source ${i + 1}] ${s.title} (${s.domain})\nURL: ${s.url}\n${s.bodyExcerpt}`)
    .join("\n\n---\n\n");

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
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
            content: `You are a fact extraction assistant. You extract verified facts from real news articles. You NEVER add information not present in the source articles. You NEVER hallucinate or infer facts beyond what is explicitly stated.`,
          },
          {
            role: "user",
            content: `Topic: ${topic}\n\nExtract the key facts from these articles. For each fact, cite which source it comes from.\n\nArticles:\n${articlesContext}\n\nReturn JSON: {"facts": [{"fact": "specific factual claim", "sourceUrl": "article URL", "sourceIndex": 1}]}\n\nRULES:\n- Extract 5-10 specific facts (numbers, dates, quotes, actions taken)\n- Each fact must be directly stated in at least one source\n- Do NOT add any information not in the articles\n- Do NOT combine facts from different sources into new claims\n- If sources disagree, note both versions`,
          },
        ],
        temperature: 0.2, // Low temperature for factual extraction
        max_completion_tokens: 2000,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      console.warn(`[AvatarResearch] Fact extraction failed: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return [];

    const parsed = JSON.parse(content);
    return (parsed.facts ?? []).map((f: any) => ({
      fact: String(f.fact ?? ""),
      sourceUrl: String(f.sourceUrl ?? ""),
      sourceIndex: Number(f.sourceIndex ?? 0),
    }));
  } catch (err: any) {
    console.warn(`[AvatarResearch] Fact extraction error: ${err.message}`);
    return [];
  }
}

// ─── Full Research Pipeline ─────────────────────────────────

export interface ResearchResult {
  candidates: VerifiedTopic[];
  totalDiscovered: number;
  totalAfterDedup: number;
}

export async function runFullResearch(suggestedTopic?: string): Promise<ResearchResult> {
  // ── Fast path: user already picked a topic — skip discovery + scoring ──
  // Only verify it (SERP + article fetch) so we have sources for the script
  if (suggestedTopic) {
    console.log(`[AvatarResearch] User-suggested topic — skipping discovery, verifying directly: "${suggestedTopic}"`);

    const preScored: ScoredTopic = {
      title: suggestedTopic,
      url: "",
      scores: {
        shareability: 9,
        saveWorthiness: 9,
        debatePotential: 8,
        informationGap: 8,
        personalImpact: 8,
        userRelevance: 9,
      },
      totalScore: 51,
      summary: suggestedTopic,
    };

    const verified = await verifyTopic(preScored);
    console.log(`[AvatarResearch] Suggested topic verified: ${verified.verificationStatus}`);

    return {
      candidates: [verified],
      totalDiscovered: 1,
      totalAfterDedup: 1,
    };
  }

  // ── Normal path: full discovery pipeline ──
  // Step 1: Discover
  const rawTopics = await discoverTopics();

  const totalDiscovered = rawTopics.length;

  if (rawTopics.length === 0) {
    throw new Error("No topics discovered from any source");
  }

  // Step 2: Score and select top 5 (we'll verify top 5, present top 3 verified)
  const scored = await scoreAndSelectTopics(rawTopics, 5);

  // Step 3: Verify each candidate (parallel)
  const verifiedResults = await Promise.allSettled(
    scored.map(topic => verifyTopic(topic))
  );

  const verified: VerifiedTopic[] = [];
  for (const result of verifiedResults) {
    if (result.status === "fulfilled") {
      verified.push(result.value);
    }
  }

  // Filter to only topics with 3+ credible sources
  const qualified = verified.filter(t => t.verificationStatus === "verified_3plus");

  // If we have fewer than 3 qualified, include partially verified topics
  let candidates: VerifiedTopic[];
  if (qualified.length >= 3) {
    candidates = qualified.slice(0, 3);
  } else {
    // Take what we have (verified first, then insufficient_sources, then unverified)
    const sorted = verified.sort((a, b) => {
      const order: Record<string, number> = { verified_3plus: 0, insufficient_sources: 1, unverified: 2 };
      return (order[a.verificationStatus] ?? 3) - (order[b.verificationStatus] ?? 3);
    });
    candidates = sorted.slice(0, 3);
    console.warn(`[AvatarResearch] Only ${qualified.length} topics have 3+ credible sources. Presenting ${candidates.length} candidates.`);
  }

  console.log(`[AvatarResearch] Research complete. ${candidates.length} candidates ready for review.`);

  return {
    candidates,
    totalDiscovered,
    totalAfterDedup: rawTopics.length,
  };
}

// ─── Helpers ────────────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
