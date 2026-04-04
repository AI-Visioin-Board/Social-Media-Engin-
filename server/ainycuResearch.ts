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

// ─── Scoring Prompt (Educational / Usability Focus) ─────────

const AINYCU_SCORING_PROMPT = `SCORING FOR "AI NEWS YOU CAN USE" EDUCATIONAL REELS (score each factor 1-10):

This series is EDUCATIONAL — topics must be things a non-technical person can actually DO or USE right now.

1. SHAREABILITY (weight: 3x) — Would someone share this with a friend or coworker?
   - 10: "You NEED to try this" — immediately useful
   - 7-9: "This is cool, check it out"
   - 4-6: "Interesting"
   - 1-3: "Meh"

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

4. WOW FACTOR (weight: 4x) — Does this make someone say "wait, I can do THAT?"
   - 10: Mind-blowing capability that feels like magic
   - 7-9: Genuinely surprising and cool
   - 4-6: Useful but not surprising
   - 1-3: Boring/expected

5. PERSONAL IMPACT (weight: 2x) — Does this affect the viewer's daily life or work?
   - 10: Saves hours per week, changes how they work
   - 7-9: Saves real time or money
   - 4-6: Nice to have
   - 1-3: Abstract/theoretical

6. USER RELEVANCE (weight: 4x) — How broadly applicable is this?
   - 10: Everyone with a phone/computer can use this
   - 8-9: Most office workers or students
   - 6-7: Specific but large group (small biz owners, freelancers)
   - 4-5: Niche audience
   - 1-3: Very niche/technical

FORMULA: ((share×3) + (save×5) + (usability×6) + (wow×4) + (impact×2) + (relevance×4)) / 24

Topics scoring below 5.0 should be REJECTED.
Topics scoring 7.0+ are EXCELLENT.

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

  const daysBack = 14; // Wider window — usable features don't expire in 3 days
  const from = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const queries = [
    "AI tool launch",
    "AI feature update consumer",
    "ChatGPT new feature",
    "Google Gemini update",
    "AI productivity tool",
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
    `Today is ${todayStr}. Search for 6 AI tools, features, or capabilities released or updated AFTER ${cutoffStr} that a NON-TECHNICAL person would find immediately useful. Focus on: new features in ChatGPT, Claude, Gemini, Perplexity, Canva AI, Notion AI, Adobe AI, Apple Intelligence, Google AI products. The feature must be AVAILABLE NOW (not coming soon). Return ONLY a JSON array: [{"title": "headline describing what you can DO", "url": "source url", "source": "news", "angle": "one sentence: here's what you can do with it"}]`,
    `Today is ${todayStr}. Search for 6 AI productivity hacks, extensions, or automations released AFTER ${cutoffStr} that save time for office workers, students, or small business owners. Must be real tools a regular person can set up without coding. Return ONLY a JSON array: [{"title": "headline", "url": "source url", "source": "news", "angle": "one sentence: here's what you can do"}]`,
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
          content: `You are a content strategist for an AI education Instagram Reels series called "AI News You Can Use." The audience is non-technical: freelancers, small business owners, students, curious people. You score topics for USABILITY and educational value — can a regular person actually do this?\n\n${AINYCU_SCORING_PROMPT}`,
        },
        {
          role: "user",
          content: `Score these topics and select the best ${count} for educational Reels. For each selected topic, provide all 6 scores, a 1-sentence summary, AND a "here's what you can do" angle.\n\nTopics:\n${topicList}\n\nReturn JSON: {"selected": [{"index": number, "title": "string", "summary": "1 sentence", "angle": "the specific here's what you can do angle", "scores": {"shareability": N, "saveWorthiness": N, "usability": N, "wowFactor": N, "personalImpact": N, "userRelevance": N}}]}`,
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
    };
    const weightedScore = Math.round(
      ((scores.shareability * 3) + (scores.saveWorthiness * 5) +
       (scores.usability * 6) + (scores.wowFactor * 4) +
       (scores.personalImpact * 2) + (scores.userRelevance * 4)) / 24 * 10
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

  const serpResults = await searchSERP(topic.title);
  const sources = await fetchArticleBodies(serpResults);

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
  serpResults: Array<{ url: string; title: string; snippet: string; date?: string }>
): Promise<SourceArticle[]> {
  const sources: SourceArticle[] = [];
  const topResults = serpResults.slice(0, 7);

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
            content: `You are a fact extraction assistant for an educational AI series. Extract verified facts from articles, with a focus on ACTIONABLE information — what the tool/feature does, how to access it, specific steps to use it. You NEVER add information not in the sources.`,
          },
          {
            role: "user",
            content: `Topic: ${topic}\n\nExtract key facts, prioritizing the most IMPRESSIVE and USEFUL capabilities:\n\n1. FEATURES & CAPABILITIES (highest priority):\n   - What can this tool actually DO? List specific capabilities.\n   - What integrations, plugins, or connections does it have?\n   - What automations or workflows does it enable?\n   - What makes it different from just chatting with an AI?\n\n2. ACCESS & SETUP:\n   - How do you access it? (URL, app, extension, etc.)\n   - What account/plan is required?\n\n3. CONCRETE USE CASES:\n   - Real examples of what someone could accomplish with this\n   - Time saved, tasks automated, problems solved\n\nArticles:\n${articlesContext}\n\nReturn JSON: {"facts": [{"fact": "specific factual claim, feature, or capability", "sourceUrl": "article URL", "sourceIndex": 1}]}\n\nRULES:\n- Extract 8-15 facts\n- Lead with the WOW features — the capabilities that make someone say "wait, it can do THAT?"\n- Include specific integrations, plugins, tools, or services it connects to\n- Include specific automations or scheduled tasks it can handle\n- Each fact must be in at least one source\n- Do NOT add claims not in the articles\n- Do NOT waste facts on generic "AI is powerful" statements — be SPECIFIC`,
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
      scores: { shareability: 8, saveWorthiness: 9, usability: 9, wowFactor: 8, personalImpact: 8, userRelevance: 9 },
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
