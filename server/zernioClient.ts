/**
 * Zernio (formerly Late) REST client — replaces Make.com as the publishing layer.
 *
 * Zernio is a unified social-media-posting API
 * (https://zernio.com / https://docs.zernio.com) that natively supports
 * Instagram mixed-media carousels (image + video in the same post), which is
 * the exact thing Make.com's Instagram Business module mangled on its way to
 * Meta's Graph API.
 *
 * Why Zernio over Postiz Cloud:
 *   - API-first product; we already have a UI (the SBGPT calendar)
 *   - Cheaper at our scale (Free for 2 accounts / 20 posts/mo, then $13+)
 *   - 280-tool MCP server if/when we want agent-driven posting
 *   - Pass-through pricing on X (no markup)
 *   - Pre-approved on LinkedIn / TikTok / etc. (Partner Program status included)
 *
 * Reference: https://docs.zernio.com/llms-full.txt
 */

import { ENV } from "./_core/env";

// ============================================================
// Public types
// ============================================================

/** Platforms Zernio publishes to. These strings MUST match what Zernio's
 *  GET /accounts returns and what POST /posts expects in platforms[].platform.
 *  Note: Zernio uses "twitter" (NOT "x"). */
export type ZernioPlatform =
  | "instagram"
  | "facebook"
  | "twitter"
  | "linkedin"
  | "youtube"
  | "tiktok"
  | "threads"
  | "pinterest"
  | "bluesky"
  | "reddit"
  | "telegram"
  | "snapchat"
  | "discord";

export interface ZernioMediaItem {
  type: "image" | "video";
  /** Publicly reachable HTTPS URL. Zernio downloads server-side. */
  url: string;
  altText?: string;
}

export interface ZernioPostInput {
  /** Caption / body. Optional when media is attached. */
  content: string;
  /** 1–10 items; mixed image + video supported natively on IG carousel. */
  mediaItems: ZernioMediaItem[];
  /** Which platform-accounts to publish to. */
  platforms: Array<{
    platform: ZernioPlatform;
    /** Zernio account `_id` returned by GET /accounts. */
    accountId: string;
  }>;
  /** ISO datetime to schedule; omit + set publishNow=true for immediate. */
  scheduledFor?: string;
  publishNow?: boolean;
  /** IANA timezone for scheduledFor. Defaults to UTC. */
  timezone?: string;
  /** Optional: not sent to platforms; useful internally. */
  title?: string;
}

export interface ZernioPostResult {
  ok: boolean;
  /** Zernio internal post _id — store in contentRuns.instagramPostId. */
  zernioPostId?: string;
  /** Per-platform results; for immediate posts Zernio returns the final URL. */
  platformResults?: Array<{
    platform: string;
    status: string;
    platformPostUrl?: string;
    error?: string;
  }>;
  status?: string;
  error?: string;
  httpStatus?: number;
}

// ============================================================
// Internal helpers
// ============================================================

function authHeaders(): Record<string, string> {
  if (!ENV.zernioApiKey) {
    throw new Error(
      "ZERNIO_API_KEY is not set. Add it to Railway service env vars."
    );
  }
  return {
    Authorization: `Bearer ${ENV.zernioApiKey}`,
    "Content-Type": "application/json",
  };
}

const BASE_URL = "https://zernio.com/api/v1";

/** Exponential-backoff retry for transient 5xx / 429. 4xx is our bug, no retry. */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempts = 3
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init);
      if (res.status < 500 && res.status !== 429) return res;
      lastErr = new Error(`Upstream ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

// ============================================================
// Public API
// ============================================================

/** Create a post in Zernio. For Instagram carousels, pass multiple
 *  mediaItems — mixed image+video supported natively. */
export async function createPost(
  input: ZernioPostInput
): Promise<ZernioPostResult> {
  const body = {
    title: input.title,
    content: input.content,
    mediaItems: input.mediaItems.map((m) => ({
      type: m.type,
      url: m.url,
      ...(m.altText ? { altText: m.altText } : {}),
    })),
    platforms: input.platforms,
    publishNow: input.publishNow ?? !input.scheduledFor,
    ...(input.scheduledFor ? { scheduledFor: input.scheduledFor } : {}),
    timezone: input.timezone ?? "UTC",
  };

  const res = await fetchWithRetry(`${BASE_URL}/posts`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const txt = await res.text();
    return {
      ok: false,
      httpStatus: res.status,
      error: `Zernio createPost ${res.status}: ${txt.slice(0, 400)}`,
    };
  }

  const json = (await res.json()) as {
    post?: { _id: string; status: string };
    platformResults?: ZernioPostResult["platformResults"];
  };
  return {
    ok: true,
    httpStatus: res.status,
    zernioPostId: json.post?._id,
    status: json.post?.status,
    platformResults: json.platformResults,
  };
}

/** Fetch current status / platform results for a Zernio post. */
export async function getPostStatus(
  zernioPostId: string
): Promise<ZernioPostResult> {
  const res = await fetchWithRetry(
    `${BASE_URL}/posts/${encodeURIComponent(zernioPostId)}`,
    {
      method: "GET",
      headers: authHeaders(),
      signal: AbortSignal.timeout(15_000),
    }
  );

  if (!res.ok) {
    return {
      ok: false,
      httpStatus: res.status,
      error: `Zernio getPostStatus ${res.status}`,
    };
  }

  const json = (await res.json()) as {
    post?: { _id: string; status: string };
    platformResults?: ZernioPostResult["platformResults"];
  };
  return {
    ok: true,
    httpStatus: res.status,
    zernioPostId: json.post?._id,
    status: json.post?.status,
    platformResults: json.platformResults,
  };
}

/** List connected social-media accounts (one per platform per profile). */
export async function listAccounts(): Promise<
  Array<{ _id: string; platform: string; displayName?: string; isActive: boolean }>
> {
  const res = await fetch(`${BASE_URL}/accounts`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Zernio listAccounts ${res.status}`);
  const json = (await res.json()) as {
    accounts?: Array<{ _id: string; platform: string; displayName?: string; isActive: boolean }>;
  };
  return json.accounts ?? [];
}

/**
 * Resolve a platform → its connected Zernio account `_id` dynamically.
 * Returns the first ACTIVE account for the platform. This means newly
 * connected platforms (e.g. LinkedIn) work with zero env/code changes —
 * connect in the Zernio dashboard and posting to that platform lights up.
 *
 * @param overrideId If set (e.g. from env), used directly without a lookup.
 * @returns the account _id, or null if no active account for that platform.
 */
export async function resolveAccountId(
  platform: ZernioPlatform,
  overrideId?: string
): Promise<string | null> {
  if (overrideId) return overrideId;
  const accounts = await listAccounts();
  const match = accounts.find((a) => a.platform === platform && a.isActive);
  return match?._id ?? null;
}

/** Health probe used by the SBGPT settings page. */
export async function checkConnection(): Promise<{
  ok: boolean;
  accountCount?: number;
  error?: string;
}> {
  if (!ENV.zernioApiKey) {
    return { ok: false, error: "ZERNIO_API_KEY not set" };
  }
  try {
    const accounts = await listAccounts();
    return { ok: true, accountCount: accounts.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
