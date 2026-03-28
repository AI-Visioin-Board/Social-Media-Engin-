/**
 * MCP (Model Context Protocol) Server for the SuggestedByGPT Social Media Engine.
 *
 * Exposes all pipeline, calendar, and posting functionality as MCP tools
 * so that AI agents (Claude in Cowork mode, scheduled tasks) can operate
 * the engine programmatically instead of through browser automation.
 *
 * Architecture: Streamable HTTP transport mounted at /mcp on the existing Express server.
 * Auth: Bearer token via MCP_AUTH_TOKEN env var.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { Express, Request, Response } from "express";

// ─── Auth helper ─────────────────────────────────────────────────────────────

function validateAuth(req: Request): boolean {
  const token = process.env.MCP_AUTH_TOKEN;
  if (!token) return true; // No token configured = open (dev mode)
  const header = req.headers.authorization;
  return header === `Bearer ${token}`;
}

// ─── Lazy imports (keep startup fast, same pattern as routers.ts) ────────────

async function getDb() {
  const { getDb } = await import("./db");
  return getDb();
}

async function getSchema() {
  return import("../drizzle/schema");
}

async function getDrizzleOps() {
  return import("drizzle-orm");
}

// ─── MCP Server Setup ───────────────────────────────────────────────────────

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "suggestedbygpt-social-media-engine",
    version: "1.0.0",
  });

  // =========================================================================
  // 1. CAROUSEL PIPELINE
  // =========================================================================

  server.tool(
    "trigger_carousel_run",
    "Start a new carousel pipeline run. Equivalent to clicking 'Run Pipeline' in Content Studio.",
    {
      run_slot: z.enum(["monday", "friday", "wednesday", "manual"]).optional()
        .describe("Which day slot. Defaults to 'manual'."),
    },
    async ({ run_slot }) => {
      const { runContentPipeline } = await import("./contentPipeline");
      const { ENV } = await import("./_core/env");
      const slot = run_slot || "manual";
      const runId = await runContentPipeline({
        runSlot: slot as any,
        perplexityApiKey: process.env.PERPLEXITY_API_KEY,
        klingAccessKey: ENV.klingAccessKey,
        klingSecretKey: ENV.klingSecretKey,
        makeWebhookUrl: process.env.MAKE_WEBHOOK_URL,
        requireAdminApproval: true,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify({ run_id: runId, status: "discovering", message: "Pipeline started" }) }] };
    },
  );

  server.tool(
    "get_carousel_runs",
    "List carousel pipeline runs with their current status.",
    {
      limit: z.number().optional().describe("Max runs to return. Default 10."),
      offset: z.number().optional().describe("Pagination offset."),
      status: z.string().optional().describe("Filter by status."),
    },
    async ({ limit, offset, status }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { contentRuns } = await getSchema();
      const { desc, eq } = await getDrizzleOps();
      let query = db.select().from(contentRuns).orderBy(desc(contentRuns.createdAt)).limit(limit ?? 10);
      if (offset) query = query.offset(offset);
      const runs = await query;
      const filtered = status ? runs.filter((r: any) => r.status === status) : runs;
      return { content: [{ type: "text" as const, text: JSON.stringify(filtered.map((r: any) => ({
        run_id: r.id, run_slot: r.runSlot, status: r.status, created_at: r.createdAt,
        error_message: r.errorMessage,
      }))) }] };
    },
  );

  server.tool(
    "get_carousel_run",
    "Get full details of a single carousel run including slides, caption, and status.",
    { run_id: z.number().describe("The run ID to look up.") },
    async ({ run_id }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { contentRuns, generatedSlides } = await getSchema();
      const { eq } = await getDrizzleOps();
      const [run] = await db.select().from(contentRuns).where(eq(contentRuns.id, run_id));
      if (!run) throw new Error(`Run ${run_id} not found`);
      const slides = await db.select().from(generatedSlides).where(eq(generatedSlides.runId, run_id));
      return { content: [{ type: "text" as const, text: JSON.stringify({
        run_id: run.id, status: run.status, run_slot: run.runSlot,
        topics_selected: run.topicsSelected ? JSON.parse(run.topicsSelected) : null,
        caption: run.instagramCaption, post_approved: run.postApproved,
        error_message: run.errorMessage,
        slides: slides.map((s: any) => ({
          slide_index: s.slideIndex, headline: s.headline, summary: s.summary,
          assembled_url: s.assembledUrl, is_video: s.isVideo, status: s.status,
        })),
      }) }] };
    },
  );

  server.tool(
    "get_run_topics",
    "Get the scored topic candidates for a run that is waiting for review.",
    { run_id: z.number().describe("The run ID.") },
    async ({ run_id }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { contentRuns } = await getSchema();
      const { eq } = await getDrizzleOps();
      const [run] = await db.select().from(contentRuns).where(eq(contentRuns.id, run_id));
      if (!run) throw new Error(`Run ${run_id} not found`);
      const shortlisted = run.topicsShortlisted ? JSON.parse(run.topicsShortlisted) : [];
      const selected = run.topicsSelected ? JSON.parse(run.topicsSelected) : [];
      return { content: [{ type: "text" as const, text: JSON.stringify({ shortlisted, selected }) }] };
    },
  );

  server.tool(
    "approve_topics",
    "Approve the topic selection for a run, advancing the pipeline to deep research.",
    {
      run_id: z.number().describe("The run ID."),
      selected_topics: z.array(z.object({
        title: z.string(), summary: z.string().optional(),
        source: z.string().optional(), url: z.string().optional(),
        scores: z.string().optional().describe("JSON object of score name→number pairs"),
      })).describe("The topics to approve. Use the topics from get_run_topics."),
    },
    async ({ run_id, selected_topics }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { contentRuns } = await getSchema();
      const { eq } = await getDrizzleOps();
      const { ENV } = await import("./_core/env");
      const { continueAfterApproval } = await import("./contentPipeline");

      await db.update(contentRuns).set({
        status: "researching",
        topicsSelected: JSON.stringify(selected_topics),
        updatedAt: new Date(),
      }).where(eq(contentRuns.id, run_id));

      continueAfterApproval(run_id, selected_topics as any, {
        klingAccessKey: ENV.klingAccessKey,
        klingSecretKey: ENV.klingSecretKey,
        makeWebhookUrl: process.env.MAKE_WEBHOOK_URL,
        requireAdminApproval: true,
      }).catch(console.error);

      return { content: [{ type: "text" as const, text: JSON.stringify({ run_id, status: "researching", message: "Topics approved, pipeline continuing" }) }] };
    },
  );

  server.tool(
    "swap_topic",
    "Replace one selected topic with a new topic.",
    {
      run_id: z.number(), topic_index: z.number().describe("Index of topic to replace."),
      new_topic: z.object({ title: z.string(), summary: z.string().optional(), source: z.string().optional(), url: z.string().optional() }),
    },
    async ({ run_id, topic_index, new_topic }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { contentRuns } = await getSchema();
      const { eq } = await getDrizzleOps();
      const [run] = await db.select().from(contentRuns).where(eq(contentRuns.id, run_id));
      if (!run) throw new Error(`Run ${run_id} not found`);
      const topics = run.topicsSelected ? JSON.parse(run.topicsSelected) : [];
      if (topic_index < 0 || topic_index >= topics.length) throw new Error("Invalid topic index");
      topics[topic_index] = new_topic;
      await db.update(contentRuns).set({ topicsSelected: JSON.stringify(topics), updatedAt: new Date() }).where(eq(contentRuns.id, run_id));
      return { content: [{ type: "text" as const, text: JSON.stringify({ run_id, updated_topics: topics }) }] };
    },
  );

  server.tool(
    "approve_and_post_carousel",
    "Approve the final carousel and fire the Make.com webhook to post to Instagram.",
    {
      run_id: z.number(), caption: z.string().optional().describe("Override caption. If omitted, uses existing."),
    },
    async ({ run_id, caption }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { contentRuns, generatedSlides } = await getSchema();
      const { eq } = await getDrizzleOps();
      const { triggerInstagramPost } = await import("./contentPipeline");

      const [run] = await db.select().from(contentRuns).where(eq(contentRuns.id, run_id));
      if (!run) throw new Error(`Run ${run_id} not found`);
      const slides = await db.select().from(generatedSlides).where(eq(generatedSlides.runId, run_id));
      const finalCaption = caption || run.instagramCaption || "";

      if (caption) {
        await db.update(contentRuns).set({ instagramCaption: caption, updatedAt: new Date() }).where(eq(contentRuns.id, run_id));
      }

      const webhookUrl = process.env.MAKE_WEBHOOK_URL;
      if (!webhookUrl) throw new Error("MAKE_WEBHOOK_URL not configured");

      const posted = await triggerInstagramPost(
        run_id,
        slides.map((s: any) => ({ assembledUrl: s.assembledUrl, isVideo: s.isVideo })),
        finalCaption,
        webhookUrl,
      );

      await db.update(contentRuns).set({
        status: "completed", postApproved: true, updatedAt: new Date(),
      }).where(eq(contentRuns.id, run_id));

      return { content: [{ type: "text" as const, text: JSON.stringify({ run_id, status: "completed", posted, message: "Carousel approved and posted" }) }] };
    },
  );

  server.tool(
    "update_carousel_caption",
    "Update the Instagram caption for a carousel run.",
    { run_id: z.number(), caption: z.string() },
    async ({ run_id, caption }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { contentRuns } = await getSchema();
      const { eq } = await getDrizzleOps();
      await db.update(contentRuns).set({ instagramCaption: caption, updatedAt: new Date() }).where(eq(contentRuns.id, run_id));
      return { content: [{ type: "text" as const, text: JSON.stringify({ run_id, caption, message: "Caption updated" }) }] };
    },
  );

  server.tool(
    "regenerate_slide",
    "Re-generate media for a single slide without re-running the whole pipeline.",
    { run_id: z.number(), slide_index: z.number().describe("Slide index (0-5).") },
    async ({ run_id, slide_index }) => {
      // This delegates to the existing regenerateSlide logic
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { generatedSlides } = await getSchema();
      const { eq, and } = await getDrizzleOps();
      const [slide] = await db.select().from(generatedSlides)
        .where(and(eq(generatedSlides.runId, run_id), eq(generatedSlides.slideIndex, slide_index)));
      if (!slide) throw new Error(`Slide ${slide_index} not found for run ${run_id}`);
      // Clear existing media to trigger re-gen
      await db.update(generatedSlides).set({ videoUrl: null, assembledUrl: null, status: "pending" })
        .where(eq(generatedSlides.id, slide.id));
      return { content: [{ type: "text" as const, text: JSON.stringify({ slide_index, status: "pending", message: "Slide queued for regeneration" }) }] };
    },
  );

  server.tool(
    "get_run_preview",
    "Get the assembled slide URLs and caption for the approval view.",
    { run_id: z.number() },
    async ({ run_id }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { contentRuns, generatedSlides } = await getSchema();
      const { eq } = await getDrizzleOps();
      const [run] = await db.select().from(contentRuns).where(eq(contentRuns.id, run_id));
      if (!run) throw new Error(`Run ${run_id} not found`);
      const slides = await db.select().from(generatedSlides).where(eq(generatedSlides.runId, run_id));
      return { content: [{ type: "text" as const, text: JSON.stringify({
        slides: slides.map((s: any) => ({ slide_index: s.slideIndex, assembled_url: s.assembledUrl, is_video: s.isVideo })),
        caption: run.instagramCaption, status: run.status, post_approved: run.postApproved,
      }) }] };
    },
  );

  server.tool(
    "get_published_topics",
    "List previously published topics to avoid repeats.",
    { days: z.number().optional().describe("How far back to look. Default 14.") },
    async ({ days }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { contentRuns } = await getSchema();
      const { gte, eq } = await getDrizzleOps();
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - (days ?? 14));
      const runs = await db.select().from(contentRuns)
        .where(eq(contentRuns.status, "completed"));
      const recent = runs.filter((r: any) => new Date(r.createdAt) >= cutoff);
      const topics = recent.flatMap((r: any) => {
        const selected = r.topicsSelected ? JSON.parse(r.topicsSelected) : [];
        return selected.map((t: any) => ({ title: t.title, published_at: r.createdAt, run_id: r.id }));
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(topics) }] };
    },
  );

  // =========================================================================
  // 2. X/TWITTER POSTING
  // =========================================================================

  server.tool(
    "post_to_x",
    "Post a tweet with optional images. Core X posting tool.",
    {
      text: z.string().max(280).describe("Tweet text (max 280 chars)."),
      image_urls: z.array(z.string()).max(4).optional().describe("Up to 4 image URLs to attach."),
    },
    async ({ text, image_urls }) => {
      if (image_urls && image_urls.length > 0) {
        const { postTweet } = await import("./twitterClient");
        const result = await postTweet(text, image_urls);
        return { content: [{ type: "text" as const, text: JSON.stringify({ tweet_id: result.tweetId, success: result.success }) }] };
      } else {
        const { postTextTweet } = await import("./twitterClient");
        const result = await postTextTweet(text);
        return { content: [{ type: "text" as const, text: JSON.stringify({ tweet_id: result.tweetId, success: result.success }) }] };
      }
    },
  );

  server.tool(
    "post_carousel_to_x",
    "Cross-post a completed carousel run to X (first 4 slides + caption trimmed to 280 chars).",
    {
      run_id: z.number(), caption_override: z.string().optional(),
      include_sales_slide: z.boolean().optional().describe("If true, uses first 3 slides + last slide."),
    },
    async ({ run_id, caption_override, include_sales_slide }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { contentRuns, generatedSlides } = await getSchema();
      const { eq } = await getDrizzleOps();
      const { postTweet } = await import("./twitterClient");

      const [run] = await db.select().from(contentRuns).where(eq(contentRuns.id, run_id));
      if (!run) throw new Error(`Run ${run_id} not found`);
      const slides = await db.select().from(generatedSlides).where(eq(generatedSlides.runId, run_id));

      const imageSlides = slides.filter((s: any) => !s.isVideo && s.assembledUrl).map((s: any) => s.assembledUrl);
      let selected: string[];
      if (include_sales_slide && imageSlides.length > 4) {
        selected = [...imageSlides.slice(0, 3), imageSlides[imageSlides.length - 1]];
      } else {
        selected = imageSlides.slice(0, 4);
      }

      const caption = (caption_override || run.instagramCaption || "").slice(0, 280);
      const result = await postTweet(caption, selected);
      return { content: [{ type: "text" as const, text: JSON.stringify({ tweet_id: result.tweetId, success: result.success, slides_posted: selected.length }) }] };
    },
  );

  server.tool(
    "post_thread_to_x",
    "Post a thread (multiple connected tweets) to X.",
    {
      tweets: z.array(z.object({
        text: z.string().max(280),
        image_urls: z.array(z.string()).max(4).optional(),
      })).min(1).describe("Array of tweets to post as a thread."),
    },
    async ({ tweets }) => {
      const { postTweet, postTextTweet } = await import("./twitterClient");
      // Twitter API v2 requires chaining via reply.in_reply_to_tweet_id
      // We need to use the raw client for thread support
      const twitterApi = await import("twitter-api-v2");
      const { ENV } = await import("./_core/env");

      const client = new twitterApi.TwitterApi({
        appKey: ENV.twitterApiKey,
        appSecret: ENV.twitterApiSecret,
        accessToken: ENV.twitterAccessToken,
        accessSecret: ENV.twitterAccessSecret,
      });

      const results: { tweet_id: string; position: number }[] = [];
      let lastTweetId: string | null = null;

      for (let i = 0; i < tweets.length; i++) {
        const tweet = tweets[i];
        const payload: any = { text: tweet.text };

        if (lastTweetId) {
          payload.reply = { in_reply_to_tweet_id: lastTweetId };
        }

        // Upload images if provided
        if (tweet.image_urls && tweet.image_urls.length > 0) {
          const mediaIds: string[] = [];
          for (const url of tweet.image_urls.slice(0, 4)) {
            try {
              const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
              if (!res.ok) continue;
              const buffer = Buffer.from(await res.arrayBuffer());
              const mediaId = await client.v1.uploadMedia(buffer, {
                mimeType: url.includes(".png") ? "image/png" : "image/jpeg",
              });
              mediaIds.push(mediaId);
            } catch { /* skip failed uploads */ }
          }
          if (mediaIds.length > 0) payload.media = { media_ids: mediaIds };
        }

        const result = await client.v2.tweet(payload);
        lastTweetId = result.data.id;
        results.push({ tweet_id: result.data.id, position: i });
      }

      return { content: [{ type: "text" as const, text: JSON.stringify(results) }] };
    },
  );

  // =========================================================================
  // 3. EDITORIAL CALENDAR
  // =========================================================================

  server.tool(
    "get_calendar_entries",
    "Get all calendar entries for a date range. Supports filtering by content type and status.",
    {
      start_date: z.string().describe("Start date (YYYY-MM-DD)."),
      end_date: z.string().describe("End date (YYYY-MM-DD)."),
      content_type: z.enum(["carousel", "reel", "x_post", "x_thread", "story"]).optional(),
      status: z.string().optional(),
    },
    async ({ start_date, end_date, content_type, status }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { calendarEntries } = await getSchema();
      const { gte, lte, and, eq } = await getDrizzleOps();

      const conditions = [
        gte(calendarEntries.scheduledDate, start_date),
        lte(calendarEntries.scheduledDate, end_date),
      ];
      if (content_type) conditions.push(eq(calendarEntries.contentType, content_type));
      if (status) conditions.push(eq(calendarEntries.status, status));

      const entries = await db.select().from(calendarEntries)
        .where(and(...conditions))
        .orderBy(calendarEntries.scheduledDate);

      return { content: [{ type: "text" as const, text: JSON.stringify(entries.map((e: any) => ({
        id: e.id, scheduled_date: e.scheduledDate, content_type: e.contentType,
        topic_title: e.topicTitle, status: e.status, pipeline_run_id: e.pipelineRunId,
        notes: e.notes, text_content: e.textContent, instagram_caption: e.instagramCaption,
        image_urls: e.imageUrls, tweet_id: e.tweetId, tweet_url: e.tweetUrl,
        tweet_ids: e.tweetIds, post_status: e.postStatus, created_at: e.createdAt,
      }))) }] };
    },
  );

  server.tool(
    "create_calendar_entry",
    "Add a new content item to the calendar. Supports carousels, reels, X posts, threads, and stories.",
    {
      scheduled_date: z.string().describe("Date (YYYY-MM-DD)."),
      content_type: z.enum(["carousel", "reel", "x_post", "x_thread", "story"]).describe("Content type."),
      topic_title: z.string().optional().describe("Topic or headline."),
      topic_context: z.string().optional().describe("Background context."),
      text_content: z.string().optional().describe("Tweet text, thread JSON, or caption draft."),
      image_urls: z.string().optional().describe("JSON array of image URLs (max 4) for x_post entries. e.g. '[\"https://...\"]'"),
      notes: z.string().optional().describe("Internal notes."),
      status: z.string().optional().describe("Status. Default: planned."),
    },
    async ({ scheduled_date, content_type, topic_title, topic_context, text_content, image_urls, notes, status }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { calendarEntries } = await getSchema();
      const values: any = {
        scheduledDate: scheduled_date,
        contentType: content_type,
        topicTitle: topic_title ?? null,
        topicContext: topic_context ?? null,
        notes: notes ?? null,
        status: status ?? "planned",
      };
      if (text_content) {
        values.textContent = text_content;
      }
      if (image_urls) {
        values.imageUrls = image_urls;
      }
      const [entry] = await db.insert(calendarEntries).values(values).returning();
      return { content: [{ type: "text" as const, text: JSON.stringify({
        id: entry.id, scheduled_date: entry.scheduledDate, content_type: entry.contentType,
        topic_title: entry.topicTitle, status: entry.status, message: "Entry created",
      }) }] };
    },
  );

  server.tool(
    "update_calendar_entry",
    "Update an existing calendar entry.",
    {
      id: z.number().describe("Entry ID."),
      scheduled_date: z.string().optional(), content_type: z.string().optional(),
      topic_title: z.string().optional(), text_content: z.string().optional(),
      image_urls: z.string().optional().describe("JSON array of image URLs (max 4)."),
      notes: z.string().optional(), status: z.string().optional(),
      pipeline_run_id: z.number().optional(),
    },
    async ({ id, scheduled_date, content_type, topic_title, text_content, image_urls, notes, status, pipeline_run_id }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { calendarEntries } = await getSchema();
      const { eq } = await getDrizzleOps();
      const updates: Record<string, any> = { updatedAt: new Date() };
      if (scheduled_date !== undefined) updates.scheduledDate = scheduled_date;
      if (content_type !== undefined) updates.contentType = content_type;
      if (topic_title !== undefined) updates.topicTitle = topic_title;
      if (text_content !== undefined) updates.textContent = text_content;
      if (image_urls !== undefined) updates.imageUrls = image_urls;
      if (notes !== undefined) updates.notes = notes;
      if (status !== undefined) updates.status = status;
      if (pipeline_run_id !== undefined) updates.pipelineRunId = pipeline_run_id;
      const [entry] = await db.update(calendarEntries).set(updates).where(eq(calendarEntries.id, id)).returning();
      return { content: [{ type: "text" as const, text: JSON.stringify({
        id: entry.id, scheduled_date: entry.scheduledDate, content_type: entry.contentType, status: entry.status, message: "Entry updated",
      }) }] };
    },
  );

  server.tool(
    "delete_calendar_entry",
    "Remove a calendar entry.",
    { id: z.number().describe("Entry ID.") },
    async ({ id }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { calendarEntries } = await getSchema();
      const { eq } = await getDrizzleOps();
      await db.delete(calendarEntries).where(eq(calendarEntries.id, id));
      return { content: [{ type: "text" as const, text: JSON.stringify({ message: "Entry deleted" }) }] };
    },
  );

  server.tool(
    "trigger_calendar_entry",
    "Trigger a calendar entry — posts tweets/threads directly, kicks off carousel/reel pipelines. Works for all content types.",
    { id: z.number().describe("Calendar entry ID.") },
    async ({ id }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { calendarEntries } = await getSchema();
      const { eq } = await getDrizzleOps();
      const [entry] = await db.select().from(calendarEntries).where(eq(calendarEntries.id, id));
      if (!entry) throw new Error("Calendar entry not found");

      if (entry.contentType === "carousel") {
        if (entry.status !== "planned") throw new Error("Can only trigger planned carousel entries");
        const { runContentPipeline } = await import("./contentPipeline");
        const { ENV } = await import("./_core/env");
        const day = new Date(entry.scheduledDate).getDay();
        const slot = (day === 1 ? "monday" : day === 5 ? "friday" : "manual") as any;
        const runId = await runContentPipeline({
          runSlot: slot,
          perplexityApiKey: process.env.PERPLEXITY_API_KEY,
          klingAccessKey: ENV.klingAccessKey,
          klingSecretKey: ENV.klingSecretKey,
          makeWebhookUrl: process.env.MAKE_WEBHOOK_URL,
          requireAdminApproval: true,
        });
        await db.update(calendarEntries).set({
          status: "discovering", pipelineRunId: runId, pipelineType: "carousel", updatedAt: new Date(),
        }).where(eq(calendarEntries.id, id));
        return { content: [{ type: "text" as const, text: JSON.stringify({ id, pipeline_run_id: runId, status: "discovering", message: "Carousel pipeline triggered" }) }] };

      } else if (entry.contentType === "x_post") {
        const text = (entry as any).textContent || entry.instagramCaption || entry.topicTitle || "";
        if (!text.trim()) throw new Error("No tweet text found on this entry");

        // Check for image URLs
        const imageUrlsRaw = (entry as any).imageUrls;
        const imageUrls: string[] = imageUrlsRaw ? JSON.parse(imageUrlsRaw) : [];

        let result: { tweetId: string; success: boolean };
        if (imageUrls.length > 0) {
          const { postTweet } = await import("./twitterClient");
          result = await postTweet(text, imageUrls);
        } else {
          const { postTextTweet } = await import("./twitterClient");
          result = await postTextTweet(text);
        }

        const tweetUrl = `https://x.com/i/status/${result.tweetId}`;
        await db.update(calendarEntries).set({
          status: "posted", postStatus: "posted_x",
          tweetId: result.tweetId, tweetUrl: tweetUrl,
          updatedAt: new Date(),
        }).where(eq(calendarEntries.id, id));
        return { content: [{ type: "text" as const, text: JSON.stringify({
          id, tweet_id: result.tweetId, tweet_url: tweetUrl, status: "posted", message: "X post published",
        }) }] };

      } else if (entry.contentType === "x_thread") {
        const textContent = (entry as any).textContent;
        if (!textContent) throw new Error("No thread content found (text_content should be a JSON array of tweet objects)");

        let tweets: Array<{ text: string; image_urls?: string[] }>;
        try {
          tweets = JSON.parse(textContent);
        } catch {
          throw new Error("text_content is not valid JSON. Expected: [{\"text\": \"Tweet 1\"}, {\"text\": \"Tweet 2\"}]");
        }
        if (!Array.isArray(tweets) || tweets.length === 0) {
          throw new Error("Thread must contain at least one tweet");
        }

        const { postThread } = await import("./twitterClient");
        const result = await postThread(tweets);

        const tweetUrl = `https://x.com/i/status/${result.tweetIds[0]}`;
        await db.update(calendarEntries).set({
          status: "posted", postStatus: "posted_x",
          tweetId: result.tweetIds[0], tweetUrl: tweetUrl,
          tweetIds: JSON.stringify(result.tweetIds),
          updatedAt: new Date(),
        }).where(eq(calendarEntries.id, id));
        return { content: [{ type: "text" as const, text: JSON.stringify({
          id, tweet_ids: result.tweetIds, tweet_url: tweetUrl, status: "posted",
          message: `Thread published (${result.tweetIds.length} tweets)`,
        }) }] };

      } else {
        throw new Error(`Trigger not yet supported for content type: ${entry.contentType}`);
      }
    },
  );

  // =========================================================================
  // 4. AVATAR REEL PIPELINE
  // =========================================================================

  server.tool(
    "trigger_reel_run",
    "Start a new avatar reel pipeline run.",
    {
      topic: z.string().optional().describe("If provided, skips discovery and uses this topic."),
      pipeline_type: z.enum(["api", "captions"]).optional().describe("Pipeline type. Default: captions."),
    },
    async ({ topic, pipeline_type }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { avatarRuns } = await getSchema();
      const pType = pipeline_type || "captions";

      const [run] = await db.insert(avatarRuns).values({
        status: "pending",
        pipelineType: pType,
        topic: topic ?? null,
      }).returning();

      // Fire pipeline async — both types share Stage 1 (discovery), split based on pipelineType in DB
      const { runAvatarPipeline } = await import("./avatarPipeline");
      runAvatarPipeline(run.id, topic || undefined).catch(console.error);

      return { content: [{ type: "text" as const, text: JSON.stringify({ run_id: run.id, pipeline_type: pType, status: "pending", message: "Reel pipeline started" }) }] };
    },
  );

  server.tool(
    "get_reel_runs",
    "List all avatar reel pipeline runs.",
    {
      limit: z.number().optional().describe("Max runs. Default 10."),
      status: z.string().optional().describe("Filter by status."),
    },
    async ({ limit, status }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { avatarRuns } = await getSchema();
      const { desc } = await getDrizzleOps();
      const runs = await db.select().from(avatarRuns).orderBy(desc(avatarRuns.createdAt)).limit(limit ?? 10);
      const filtered = status ? runs.filter((r: any) => r.status === status) : runs;
      return { content: [{ type: "text" as const, text: JSON.stringify(filtered.map((r: any) => ({
        run_id: r.id, topic: r.topic, status: r.status, pipeline_type: r.pipelineType,
        script_ready: !!r.scriptJson, broll_ready: !!r.multiAssetMap || !!r.brollImageCount,
        created_at: r.createdAt,
      }))) }] };
    },
  );

  server.tool(
    "get_reel_run",
    "Get full details of a single reel run including script, B-roll, and status.",
    { run_id: z.number() },
    async ({ run_id }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { avatarRuns } = await getSchema();
      const { eq } = await getDrizzleOps();
      const [run] = await db.select().from(avatarRuns).where(eq(avatarRuns.id, run_id));
      if (!run) throw new Error(`Reel run ${run_id} not found`);
      return { content: [{ type: "text" as const, text: JSON.stringify({
        run_id: run.id, topic: run.topic, status: run.status, status_detail: run.statusDetail,
        pipeline_type: run.pipelineType,
        topic_candidates: run.topicCandidates ? JSON.parse(run.topicCandidates) : null,
        script_json: run.scriptJson ? JSON.parse(run.scriptJson) : null,
        script_text: run.scriptJson ? JSON.parse(run.scriptJson)?.beats?.map((b: any) => b.narration).join(" ") : null,
        avatar_video_url: run.avatarVideoUrl,
        assembled_video_url: run.assembledVideoUrl,
        final_video_url: run.finalVideoUrl,
        broll_output_dir: run.brollOutputDir,
        broll_image_count: run.brollImageCount,
        instagram_caption: run.instagramCaption,
        created_at: run.createdAt,
      }) }] };
    },
  );

  server.tool(
    "get_reel_topics",
    "Get pending suggested topics for reel production.",
    async () => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { suggestedTopics } = await getSchema();
      const { desc } = await getDrizzleOps();
      const topics = await db.select().from(suggestedTopics).orderBy(desc(suggestedTopics.createdAt));
      return { content: [{ type: "text" as const, text: JSON.stringify(topics.map((t: any) => ({
        id: t.id, topic: t.topic, notes: t.notes, status: t.status, created_at: t.createdAt,
      }))) }] };
    },
  );

  server.tool(
    "select_reel_topic",
    "Select a topic from discovery candidates for a reel run.",
    { run_id: z.number(), topic_index: z.number().describe("Index of topic in candidates array.") },
    async ({ run_id, topic_index }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { avatarRuns } = await getSchema();
      const { eq } = await getDrizzleOps();
      const [run] = await db.select().from(avatarRuns).where(eq(avatarRuns.id, run_id));
      if (!run) throw new Error(`Run ${run_id} not found`);

      if (run.pipelineType === "captions") {
        const { continueAfterTopicApprovalCaptions } = await import("./captionsPipeline");
        continueAfterTopicApprovalCaptions(run_id, topic_index).catch(console.error);
      } else {
        const { continueAfterTopicApproval } = await import("./avatarPipeline");
        continueAfterTopicApproval(run_id, topic_index).catch(console.error);
      }

      return { content: [{ type: "text" as const, text: JSON.stringify({ run_id, topic_index, status: "scripting", message: "Topic selected, generating script" }) }] };
    },
  );

  server.tool(
    "get_reel_script",
    "Get the generated script for a reel run.",
    { run_id: z.number() },
    async ({ run_id }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { avatarRuns } = await getSchema();
      const { eq } = await getDrizzleOps();
      const [run] = await db.select().from(avatarRuns).where(eq(avatarRuns.id, run_id));
      if (!run) throw new Error(`Run ${run_id} not found`);
      if (!run.scriptJson) throw new Error("Script not yet generated");
      const script = JSON.parse(run.scriptJson);
      return { content: [{ type: "text" as const, text: JSON.stringify({
        script_text: script.beats?.map((b: any) => b.narration).join(" "),
        script_json: script,
        broll_cues: script.beats?.map((b: any, i: number) => ({
          beat_number: i, visual_type: b.visualType, visual_prompt: b.visualPrompt, layout: b.layout,
        })),
      }) }] };
    },
  );

  server.tool(
    "get_reel_broll",
    "Get the B-roll asset URLs for a reel run.",
    { run_id: z.number() },
    async ({ run_id }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { avatarRuns } = await getSchema();
      const { eq } = await getDrizzleOps();
      const [run] = await db.select().from(avatarRuns).where(eq(avatarRuns.id, run_id));
      if (!run) throw new Error(`Run ${run_id} not found`);

      const assets: any[] = [];
      if (run.multiAssetMap) {
        const map = JSON.parse(run.multiAssetMap);
        Object.entries(map).forEach(([idx, data]: [string, any]) => {
          assets.push({
            index: parseInt(idx), url: data.url || data.path, type: data.type || "image",
            filename: data.filename,
          });
        });
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(assets) }] };
    },
  );

  server.tool(
    "upload_final_reel",
    "Upload the final enhanced video back to the engine for calendar posting.",
    {
      run_id: z.number(),
      video_url: z.string().describe("URL of the final video."),
      calendar_date: z.string().optional().describe("Auto-create a calendar entry for this date (YYYY-MM-DD)."),
    },
    async ({ run_id, video_url, calendar_date }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { avatarRuns, calendarEntries } = await getSchema();
      const { eq } = await getDrizzleOps();

      // Update avatar run with final video
      await db.update(avatarRuns).set({
        finalVideoUrl: video_url, status: "completed", updatedAt: new Date(),
      }).where(eq(avatarRuns.id, run_id));

      let calendarEntryId: number | null = null;
      if (calendar_date) {
        const [run] = await db.select().from(avatarRuns).where(eq(avatarRuns.id, run_id));
        const [entry] = await db.insert(calendarEntries).values({
          scheduledDate: calendar_date,
          contentType: "reel",
          topicTitle: run?.topic ?? null,
          uploadedVideoUrl: video_url,
          status: "ready_to_post",
          postStatus: "ready",
          pipelineRunId: run_id,
          pipelineType: "reel",
        }).returning();
        calendarEntryId = entry.id;
      }

      return { content: [{ type: "text" as const, text: JSON.stringify({
        run_id, status: "completed", calendar_entry_id: calendarEntryId,
        message: calendarEntryId ? "Video uploaded and calendar entry created" : "Video uploaded",
      }) }] };
    },
  );

  server.tool(
    "add_suggested_topic",
    "Add a suggested topic for future reel production.",
    {
      topic: z.string().describe("The topic text."),
      notes: z.string().optional().describe("Additional notes."),
    },
    async ({ topic, notes }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const { suggestedTopics } = await getSchema();
      const [entry] = await db.insert(suggestedTopics).values({
        topic, notes: notes ?? null, status: "pending",
      }).returning();
      return { content: [{ type: "text" as const, text: JSON.stringify({ id: entry.id, topic: entry.topic, status: "pending" }) }] };
    },
  );

  // =========================================================================
  // 5. SYSTEM / STATUS
  // =========================================================================

  server.tool(
    "get_pipeline_status",
    "Returns overall system health — which pipelines are operational, API connectivity, recent errors.",
    async () => {
      const { ENV } = await import("./_core/env");
      const db = await getDb();

      const status: any = {
        server: "operational",
        carousel_pipeline: process.env.PERPLEXITY_API_KEY ? "operational" : "missing_api_key",
        reel_pipeline: process.env.HEYGEN_API_KEY ? "operational" : "missing_api_key",
        x_api: ENV.twitterApiKey ? "operational" : "not_configured",
        instagram_webhook: process.env.MAKE_WEBHOOK_URL ? "operational" : "not_configured",
        kling_api: ENV.klingAccessKey ? "configured" : "not_configured",
      };

      if (db) {
        const { contentRuns, avatarRuns } = await getSchema();
        const { desc, eq } = await getDrizzleOps();

        // Last successful carousel
        const [lastCarousel] = await db.select().from(contentRuns)
          .where(eq(contentRuns.status, "completed"))
          .orderBy(desc(contentRuns.createdAt)).limit(1);
        if (lastCarousel) {
          status.last_successful_carousel = { run_id: lastCarousel.id, date: lastCarousel.createdAt };
        }

        // Last successful reel
        const [lastReel] = await db.select().from(avatarRuns)
          .where(eq(avatarRuns.status, "completed"))
          .orderBy(desc(avatarRuns.createdAt)).limit(1);
        if (lastReel) {
          status.last_successful_reel = { run_id: lastReel.id, date: lastReel.createdAt };
        }

        // Recent errors
        const recentErrors = await db.select().from(contentRuns)
          .where(eq(contentRuns.status, "failed"))
          .orderBy(desc(contentRuns.createdAt)).limit(3);
        const recentReelErrors = await db.select().from(avatarRuns)
          .where(eq(avatarRuns.status, "failed"))
          .orderBy(desc(avatarRuns.createdAt)).limit(3);
        status.recent_errors = [
          ...recentErrors.map((r: any) => ({ type: "carousel", run_id: r.id, message: r.errorMessage, date: r.createdAt })),
          ...recentReelErrors.map((r: any) => ({ type: "reel", run_id: r.id, message: r.statusDetail, date: r.createdAt })),
        ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5);
      }

      return { content: [{ type: "text" as const, text: JSON.stringify(status) }] };
    },
  );

  server.tool(
    "get_app_settings",
    "Get current configuration state (which APIs are configured). Does NOT return secrets.",
    async () => {
      const { ENV } = await import("./_core/env");
      return { content: [{ type: "text" as const, text: JSON.stringify({
        kling_configured: !!(ENV.klingAccessKey && ENV.klingSecretKey),
        make_webhook_configured: !!process.env.MAKE_WEBHOOK_URL,
        x_api_configured: !!(ENV.twitterApiKey && ENV.twitterApiSecret && ENV.twitterAccessToken && ENV.twitterAccessSecret),
        heygen_configured: !!process.env.HEYGEN_API_KEY,
        perplexity_configured: !!process.env.PERPLEXITY_API_KEY,
        openai_configured: !!process.env.OPENAI_API_KEY,
        pexels_configured: !!process.env.PEXELS_API_KEY,
      }) }] };
    },
  );

  return server;
}

// ─── Express Integration ────────────────────────────────────────────────────

export function registerMcpEndpoint(app: Express): void {
  // Each session gets its own McpServer + Transport pair
  const sessions = new Map<string, { server: McpServer; transport: StreamableHTTPServerTransport }>();

  app.post("/mcp", async (req: Request, res: Response) => {
    if (!validateAuth(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (sessionId && sessions.has(sessionId)) {
        // Existing session
        const session = sessions.get(sessionId)!;
        await session.transport.handleRequest(req, res, req.body);
      } else {
        // New session — create fresh McpServer + Transport
        const server = createMcpServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, { server, transport });
          },
        });

        transport.onclose = () => {
          const sid = (transport as any).sessionId;
          if (sid) sessions.delete(sid);
        };

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      }
    } catch (err: any) {
      console.error("[MCP] Error:", err?.message);
      if (!res.headersSent) {
        res.status(500).json({ error: err?.message || "Internal server error" });
      }
    }
  });

  // GET for SSE stream (server-to-client notifications)
  app.get("/mcp", async (req: Request, res: Response) => {
    if (!validateAuth(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: "No active session. Send a POST to /mcp first." });
      return;
    }

    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res);
  });

  // DELETE for session cleanup
  app.delete("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      await session.transport.close();
      await session.server.close();
      sessions.delete(sessionId);
    }
    res.status(200).json({ message: "Session closed" });
  });

  console.log("[MCP] Server registered at /mcp — 30 tools available");
}
