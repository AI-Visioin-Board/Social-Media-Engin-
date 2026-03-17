import { ENV } from "./_core/env";
import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { notifyOwner } from "./_core/notification";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  createOrder, getOrderById, listOrders, updateOrder,
  getOrdersNeedingWelcomeEmail, getPendingOrders, getOrderStats,
  createMessage, getMessagesByOrderId, getUnprocessedClientMessages, markMessageProcessed, getUnreadMessageCount,
  getPhaseProgressByOrder, upsertPhaseProgress,
  createDeliverable, getDeliverablesByOrder, deleteDeliverable,
  createClientAccessToken, getClientAccessToken, deleteClientAccessToken,
  createClientUpload, getClientUploadsByOrder, deleteClientUpload,
} from "./db";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";
import { SERVICE_PHASES, SERVICE_TIERS, ORDER_STATUSES, TIER_PHASES } from "../drizzle/schema";
import Stripe from "stripe";
import { PRODUCTS } from "./products";
import { buildWelcomeEmailContent } from "./emailHelper";
import { invokeLLM } from "./_core/llm";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2026-02-25.clover",
});

const phaseEnum = z.enum(SERVICE_PHASES as unknown as [string, ...string[]]);

// Cookie name for client portal sessions
const CLIENT_PORTAL_COOKIE = "sbgpt_client_session";

// ─── Music Track Library (module-level, not re-created per request) ───────────
const TRACK_LIBRARY = [
  { name: "Titan", artist: "Audionautix", mood: "Epic / Orchestral", bpm: 120, url: "https://audionautix.com/Music/Titan.mp3", license: "CC BY 4.0" },
  { name: "Colossal Boss Battle Theme", artist: "Kevin MacLeod", mood: "Intense / Battle", bpm: 140, url: "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100791", license: "CC BY 4.0" },
  { name: "Epic Cinematic", artist: "Scott Buckley", mood: "Cinematic / Grandiose", bpm: 110, url: "https://www.scottbuckley.com.au/library/epic-cinematic/", license: "CC BY 4.0" },
  { name: "Ascension", artist: "Scott Buckley", mood: "Uplifting / Triumphant", bpm: 128, url: "https://www.scottbuckley.com.au/library/ascension/", license: "CC BY 4.0" },
  { name: "Thunderstruck (Cinematic)", artist: "Audionautix", mood: "Dramatic / Powerful", bpm: 132, url: "https://audionautix.com", license: "CC BY 4.0" },
  { name: "Infinite Horizon", artist: "Scott Buckley", mood: "Futuristic / Expansive", bpm: 118, url: "https://www.scottbuckley.com.au/library/infinite-horizon/", license: "CC BY 4.0" },
  { name: "Impact Moderato", artist: "Kevin MacLeod", mood: "Urgent / Driving", bpm: 125, url: "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100504", license: "CC BY 4.0" },
  { name: "Olympus", artist: "Scott Buckley", mood: "Heroic / Majestic", bpm: 115, url: "https://www.scottbuckley.com.au/library/olympus/", license: "CC BY 4.0" },
] as const;

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── Orders ─────────────────────────────────────────────────
  orders: router({
    list: protectedProcedure
      .input(z.object({
        status: z.enum(ORDER_STATUSES as unknown as [string, ...string[]]).optional(),
      }).optional())
      .query(async ({ input }) => {
        return listOrders(input ? { status: input.status as any } : undefined);
      }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const order = await getOrderById(input.id);
        if (!order) throw new Error("Order not found");
        return order;
      }),

    create: protectedProcedure
      .input(z.object({
        clientName: z.string().min(1),
        clientEmail: z.string().email(),
        businessName: z.string().min(1),
        websiteUrl: z.string().optional(),
        businessAddress: z.string().optional(),
        businessPhone: z.string().optional(),
        businessCategory: z.string().optional(),
        targetArea: z.string().optional(),
        serviceTier: z.enum(SERVICE_TIERS as unknown as [string, ...string[]]),
        notes: z.string().optional(),
        origin: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const order = await createOrder({
          ...input,
          serviceTier: input.serviceTier as "ai_jumpstart" | "ai_dominator",
          websiteUrl: input.websiteUrl ?? null,
          businessAddress: input.businessAddress ?? null,
          businessPhone: input.businessPhone ?? null,
          businessCategory: input.businessCategory ?? null,
          targetArea: input.targetArea ?? null,
          notes: input.notes ?? null,
        });

        if (!order) throw new Error("Failed to create order");

        // Auto-generate portal access token so welcome email can be sent immediately
        let portalToken: string | null = null;
        let portalUrl: string | null = null;
        if (input.origin) {
          try {
            const token = nanoid(48);
            const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
            await createClientAccessToken({
              orderId: order.id,
              email: order.clientEmail,
              token,
              expiresAt,
            });
            portalToken = token;
            portalUrl = `${input.origin}/portal/${token}`;
          } catch (e) {
            console.warn("[Orders] Failed to generate portal token:", e);
          }
        }

        // Build welcome email content
        const welcomeEmail = portalUrl
          ? buildWelcomeEmailContent({
              clientName: order.clientName,
              businessName: order.businessName,
              serviceTier: order.serviceTier,
              portalUrl,
              orderId: order.id,
            })
          : null;

        try {
          await notifyOwner({
            title: `New Order: ${input.businessName}`,
            content: `New ${input.serviceTier === "ai_dominator" ? "AI Dominator" : "AI Jumpstart"} order from ${input.clientName} (${input.clientEmail}) for ${input.businessName}. Portal link ready to send.`,
          });
        } catch (e) {
          console.warn("[Orders] Failed to notify owner:", e);
        }

        return { ...order, portalUrl, welcomeEmail };
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(ORDER_STATUSES as unknown as [string, ...string[]]).optional(),
        currentPhase: phaseEnum.optional(),
        welcomeEmailSent: z.boolean().optional(),
        notes: z.string().optional(),
        clientName: z.string().optional(),
        clientEmail: z.string().email().optional(),
        businessName: z.string().optional(),
        websiteUrl: z.string().optional(),
        businessAddress: z.string().optional(),
        businessPhone: z.string().optional(),
        businessCategory: z.string().optional(),
        targetArea: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return updateOrder(id, data as any);
      }),

    stats: protectedProcedure.query(async () => getOrderStats()),
    needingWelcomeEmail: protectedProcedure.query(async () => getOrdersNeedingWelcomeEmail()),
    pending: protectedProcedure.query(async () => getPendingOrders()),

    // Generate a magic link token for a client to access their portal
    generatePortalLink: protectedProcedure
      .input(z.object({ orderId: z.number(), origin: z.string() }))
      .mutation(async ({ input }) => {
        const order = await getOrderById(input.orderId);
        if (!order) throw new Error("Order not found");

        const token = nanoid(48);
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        await createClientAccessToken({
          orderId: input.orderId,
          email: order.clientEmail,
          token,
          expiresAt,
        });

        const portalUrl = `${input.origin}/portal/${token}`;
        return { portalUrl, token, expiresAt };
      }),
  }),

  // ─── Messages ───────────────────────────────────────────────
  messages: router({
    listByOrder: protectedProcedure
      .input(z.object({ orderId: z.number() }))
      .query(async ({ input }) => getMessagesByOrderId(input.orderId)),

    create: protectedProcedure
      .input(z.object({
        orderId: z.number(),
        sender: z.enum(["client", "admin"]),
        content: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        const msg = await createMessage(input);
        if (input.sender === "client") {
          try {
            const order = await getOrderById(input.orderId);
            await notifyOwner({
              title: `New Client Message: ${order?.businessName ?? "Unknown"}`,
              content: `${order?.clientName ?? "Client"} sent a message for order #${input.orderId}: "${input.content.substring(0, 200)}${input.content.length > 200 ? "..." : ""}"`,
            });
          } catch (e) {
            console.warn("[Messages] Failed to notify owner:", e);
          }
        }
        return msg;
      }),

    markProcessed: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await markMessageProcessed(input.id);
        return { success: true };
      }),

    unprocessed: protectedProcedure.query(async () => getUnprocessedClientMessages()),
    unreadCount: protectedProcedure.query(async () => getUnreadMessageCount()),
  }),

  // ─── Phase Progress ─────────────────────────────────────────
  phases: router({
    getByOrder: protectedProcedure
      .input(z.object({ orderId: z.number() }))
      .query(async ({ input }) => getPhaseProgressByOrder(input.orderId)),

    updateQA: protectedProcedure
      .input(z.object({
        orderId: z.number(),
        phase: phaseEnum,
        qaExecute: z.boolean().optional(),
        qaVerify: z.boolean().optional(),
        qaTest: z.boolean().optional(),
        qaDocument: z.boolean().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => upsertPhaseProgress(input as any)),
  }),

  // ─── Deliverables ──────────────────────────────────────────
  deliverables: router({
    listByOrder: protectedProcedure
      .input(z.object({ orderId: z.number() }))
      .query(async ({ input }) => getDeliverablesByOrder(input.orderId)),

    upload: protectedProcedure
      .input(z.object({
        orderId: z.number(),
        phase: phaseEnum,
        name: z.string().min(1),
        fileBase64: z.string(),
        mimeType: z.string(),
        fileSize: z.number(),
      }))
      .mutation(async ({ input }) => {
        const buffer = Buffer.from(input.fileBase64, "base64");
        const ext = input.name.split(".").pop() ?? "bin";
        const fileKey = `deliverables/${input.orderId}/${input.phase}/${nanoid()}.${ext}`;
        const { url } = await storagePut(fileKey, buffer, input.mimeType);
        return createDeliverable({
          orderId: input.orderId,
          phase: input.phase as any,
          name: input.name,
          fileUrl: url,
          fileKey,
          mimeType: input.mimeType,
          fileSize: input.fileSize,
        });
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteDeliverable(input.id);
        return { success: true };
      }),
  }),

  // ─── Client Portal ─────────────────────────────────────────
  // All procedures here validate the magic-link token from the cookie
  portal: router({
    // Validate a magic link token and set a session cookie
    validateToken: publicProcedure
      .input(z.object({ token: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const record = await getClientAccessToken(input.token);
        if (!record) throw new Error("Invalid or expired link");
        if (record.expiresAt < new Date()) {
          await deleteClientAccessToken(record.id);
          throw new Error("This link has expired. Please request a new one.");
        }

        // Set a session cookie so client stays logged in
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(CLIENT_PORTAL_COOKIE, input.token, {
          ...cookieOptions,
          maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        return { success: true, orderId: record.orderId };
      }),

    // Get the current client's session from cookie
    me: publicProcedure.query(async ({ ctx }) => {
      const token = (ctx.req as any).cookies?.[CLIENT_PORTAL_COOKIE];
      if (!token) return null;

      const record = await getClientAccessToken(token);
      if (!record || record.expiresAt < new Date()) return null;

      const order = await getOrderById(record.orderId);
      if (!order) return null;

      return {
        orderId: record.orderId,
        email: record.email,
        clientName: order.clientName,
        businessName: order.businessName,
      };
    }),

    // Logout client portal
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(CLIENT_PORTAL_COOKIE, { ...cookieOptions, maxAge: -1 });
      return { success: true };
    }),

    // Get the client's own order (validates token from cookie)
    getOrder: publicProcedure.query(async ({ ctx }) => {
      const token = (ctx.req as any).cookies?.[CLIENT_PORTAL_COOKIE];
      if (!token) throw new Error("Not authenticated");

      const record = await getClientAccessToken(token);
      if (!record || record.expiresAt < new Date()) throw new Error("Session expired");

      const order = await getOrderById(record.orderId);
      if (!order) throw new Error("Order not found");

      const phases = await getPhaseProgressByOrder(record.orderId);
      const delivs = await getDeliverablesByOrder(record.orderId);
      const msgs = await getMessagesByOrderId(record.orderId);
      const uploads = await getClientUploadsByOrder(record.orderId);

      // Build phase list for the tier
      const tierPhases = TIER_PHASES[order.serviceTier] ?? [];

      return {
        order,
        tierPhases,
        phaseProgress: phases,
        deliverables: delivs,
        messages: msgs,
        uploads,
      };
    }),

    // Client sends a message
    sendMessage: publicProcedure
      .input(z.object({ content: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const token = (ctx.req as any).cookies?.[CLIENT_PORTAL_COOKIE];
        if (!token) throw new Error("Not authenticated");

        const record = await getClientAccessToken(token);
        if (!record || record.expiresAt < new Date()) throw new Error("Session expired");

        const msg = await createMessage({
          orderId: record.orderId,
          sender: "client",
          content: input.content,
        });

        try {
          const order = await getOrderById(record.orderId);
          await notifyOwner({
            title: `New Client Message: ${order?.businessName ?? "Unknown"}`,
            content: `${order?.clientName ?? "Client"} sent a message: "${input.content.substring(0, 200)}${input.content.length > 200 ? "..." : ""}"`,
          });
        } catch (e) {
          console.warn("[Portal] Failed to notify owner:", e);
        }

        return msg;
      }),

    // Client uploads a document
    uploadDocument: publicProcedure
      .input(z.object({
        name: z.string().min(1),
        fileBase64: z.string(),
        mimeType: z.string(),
        fileSize: z.number().max(10 * 1024 * 1024),
      }))
      .mutation(async ({ input, ctx }) => {
        const token = (ctx.req as any).cookies?.[CLIENT_PORTAL_COOKIE];
        if (!token) throw new Error("Not authenticated");

        const record = await getClientAccessToken(token);
        if (!record || record.expiresAt < new Date()) throw new Error("Session expired");

        const buffer = Buffer.from(input.fileBase64, "base64");
        const ext = input.name.split(".").pop() ?? "bin";
        const fileKey = `client-uploads/${record.orderId}/${nanoid()}.${ext}`;
        const { url } = await storagePut(fileKey, buffer, input.mimeType);

        return createClientUpload({
          orderId: record.orderId,
          name: input.name,
          fileUrl: url,
          fileKey,
          mimeType: input.mimeType,
          fileSize: input.fileSize,
        });
      }),

    // Client initiates Stripe checkout to upgrade from Jumpstart → Dominator
    createUpgradeCheckout: publicProcedure
      .input(z.object({ origin: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const token = (ctx.req as any).cookies?.[CLIENT_PORTAL_COOKIE];
        if (!token) throw new Error("Not authenticated");

        const record = await getClientAccessToken(token);
        if (!record || record.expiresAt < new Date()) throw new Error("Session expired");

        const order = await getOrderById(record.orderId);
        if (!order) throw new Error("Order not found");
        if (order.serviceTier !== "ai_jumpstart") throw new Error("Already on AI Dominator");

        const product = PRODUCTS.ai_dominator_upgrade;

        const session = await stripe.checkout.sessions.create({
          mode: "payment",
          customer_email: order.clientEmail,
          allow_promotion_codes: true,
          line_items: [
            {
              price_data: {
                currency: product.currency,
                unit_amount: product.unitAmount,
                product_data: {
                  name: product.name,
                  description: product.description,
                },
              },
              quantity: 1,
            },
          ],
          client_reference_id: order.id.toString(),
          metadata: {
            order_id: order.id.toString(),
            user_id: order.id.toString(),
            customer_email: order.clientEmail,
            customer_name: order.clientName,
          },
          success_url: `${input.origin}/portal?upgrade=success`,
          cancel_url: `${input.origin}/portal?upgrade=cancelled`,
        });

         return { checkoutUrl: session.url };
      }),
  }),

  // ─── Content Studio ─────────────────────────────────────────
  contentStudio: router({
    // Trigger a new pipeline run
    triggerRun: adminProcedure
      .input(z.object({
        runSlot: z.enum(["monday", "friday"]),
        requireApproval: z.boolean().default(true),
      }))
      .mutation(async ({ input }) => {
        const { runContentPipeline } = await import("./contentPipeline");
        const runId = await runContentPipeline({
          runSlot: input.runSlot,
          perplexityApiKey: process.env.PERPLEXITY_API_KEY,
          klingAccessKey: ENV.klingAccessKey,
          klingSecretKey: ENV.klingSecretKey,
          makeWebhookUrl: process.env.MAKE_WEBHOOK_URL,
          requireAdminApproval: input.requireApproval,
        });
        return { runId };
      }),

    // Get all runs (paginated)
    getRuns: adminProcedure
      .input(z.object({ limit: z.number().default(20) }).optional())
      .query(async ({ input }) => {
        const { getDb } = await import("./db");
        const { contentRuns, generatedSlides } = await import("../drizzle/schema");
        const { desc } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return [];
        return db.select().from(contentRuns).orderBy(desc(contentRuns.createdAt)).limit(input?.limit ?? 20);
      }),

    // Get a single run with its slides
    getRun: adminProcedure
      .input(z.object({ runId: z.number() }))
      .query(async ({ input }) => {
        const { getDb } = await import("./db");
        const { contentRuns, generatedSlides } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return null;
        const [run] = await db.select().from(contentRuns).where(eq(contentRuns.id, input.runId));
        const slides = await db.select().from(generatedSlides)
          .where(eq(generatedSlides.runId, input.runId))
          .orderBy(generatedSlides.slideIndex as any);
        return run ? { ...run, slides } : null;
      }),

    // Approve topics and continue pipeline
    approveTopics: adminProcedure
      .input(z.object({
        runId: z.number(),
        selectedTopics: z.array(z.object({
          title: z.string(),
          summary: z.string(),
          source: z.string(),
          url: z.string(),
          // Accept any score field names for backward compatibility — frontend normalizes before sending
          scores: z.record(z.string(), z.number()).optional().default({}),
        })),
      }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const { contentRuns } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) throw new Error("DB not available");

        // Normalize score fields: map any legacy/alternate field names to canonical names
        const normalizedTopics = input.selectedTopics.map((t) => {
          const s = t.scores as Record<string, number>;
          const canonical = {
            shareability:    s.shareability    ?? s.viralPotential        ?? s.generalPublicRelevance ?? 5,
            saveWorthiness:  s.saveWorthiness  ?? s.businessOwnerImpact   ?? 5,
            debatePotential: s.debatePotential ?? s.worldImportance       ?? 5,
            informationGap:  s.informationGap  ?? s.interestingness       ?? 5,
            personalImpact:  s.personalImpact  ?? 5,
            total:           s.total           ?? 70,
          };
          return { ...t, scores: canonical };
        });

        await db.update(contentRuns).set({
          topicsSelected: JSON.stringify(normalizedTopics),
          adminApproved: true,
          status: "researching",
        }).where(eq(contentRuns.id, input.runId));

        // Continue pipeline async
        const { continueAfterApproval } = await import("./contentPipeline");
        continueAfterApproval(input.runId, normalizedTopics, {
          perplexityApiKey: process.env.PERPLEXITY_API_KEY,
          klingAccessKey: ENV.klingAccessKey,
          klingSecretKey: ENV.klingSecretKey,
          makeWebhookUrl: process.env.MAKE_WEBHOOK_URL,
        }).catch(console.error);

        return { success: true };
      }),

    // Get published topics (for no-repeat visibility)
    getPublishedTopics: adminProcedure
      .input(z.object({ days: z.number().default(30) }).optional())
      .query(async ({ input }) => {
        const { getDb } = await import("./db");
        const { publishedTopics } = await import("../drizzle/schema");
        const { gte, desc } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return [];
        const days = input?.days ?? 30;
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        return db.select().from(publishedTopics)
          .where(gte(publishedTopics.publishedAt, cutoff))
          .orderBy(desc(publishedTopics.publishedAt));
      }),

    // Get full run preview: slides + caption for Instagram preview UI
    getRunPreview: adminProcedure
      .input(z.object({ runId: z.number() }))
      .query(async ({ input }) => {
        const { getDb } = await import("./db");
        const { contentRuns, generatedSlides } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return null;
        const [run] = await db.select().from(contentRuns).where(eq(contentRuns.id, input.runId));
        if (!run) return null;
        const slides = await db.select().from(generatedSlides)
          .where(eq(generatedSlides.runId, input.runId))
          .orderBy(generatedSlides.slideIndex as any);
        return {
          run,
          slides,
          caption: run.instagramCaption ?? null,
          status: run.status,
          postApproved: run.postApproved,
        };
      }),

    // Approve post — update caption (optional edit) then fire Make.com webhook
    approvePost: adminProcedure
      .input(z.object({
        runId: z.number(),
        caption: z.string(), // allow edited caption
      }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const { contentRuns, generatedSlides, publishedTopics } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) throw new Error("DB not available");

        const [run] = await db.select().from(contentRuns).where(eq(contentRuns.id, input.runId));
        if (!run) throw new Error("Run not found");
        if (run.status !== "pending_post") throw new Error(`Run is not pending post approval (status: ${run.status})`);

        // Save final caption and mark approved
        await db.update(contentRuns).set({
          instagramCaption: input.caption,
          postApproved: true,
          status: "posting",
        }).where(eq(contentRuns.id, input.runId));

        // Get assembled slides
        const slides = await db.select().from(generatedSlides)
          .where(eq(generatedSlides.runId, input.runId))
          .orderBy(generatedSlides.slideIndex as any);

        const readySlides = slides.filter((s) => s.assembledUrl).map((s) => ({
          assembledUrl: s.assembledUrl!,
          headline: s.headline ?? "",
          isVideo: s.isVideoSlide === 1 && !!(s.assembledUrl && (s.assembledUrl.includes(".mp4") || s.assembledUrl.includes("video"))),
        }));
        // Fire Make.com webhook (URL resolved inside triggerInstagramPost: env → DB fallback)
        const { triggerInstagramPost } = await import("./contentPipeline");
        const posted = await triggerInstagramPost(
          input.runId,
          readySlides,
          input.caption,
          process.env.MAKE_WEBHOOK_URL
        );

        // Save published topics for no-repeat logic
        const topicsSelected = JSON.parse(run.topicsSelected ?? "[]");
        const { normalizeTitle } = await import("./contentPipeline");
        for (const topic of topicsSelected) {
          await db.insert(publishedTopics).values({
            runId: input.runId,
            title: topic.title,
            summary: topic.summary ?? "",
            titleNormalized: normalizeTitle(topic.title),
          });
        }

        await db.update(contentRuns).set({
          status: posted ? "completed" : "pending_post",
          postApproved: posted,
        }).where(eq(contentRuns.id, input.runId));

        const { notifyOwner } = await import("./_core/notification");
        await notifyOwner({
          title: posted ? "Instagram Post Published!" : "Post Failed — Webhook Error",
          content: posted
            ? `Run #${input.runId} carousel was posted to Instagram successfully.`
            : `Run #${input.runId} approval was set but Make.com webhook failed. Check your webhook URL.`,
        });

        return { success: true, posted };
      }),

    // Resend webhook for a completed (or failed-post) run — retry Make.com without re-running the pipeline
    resendWebhook: adminProcedure
      .input(z.object({ runId: z.number() }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const { contentRuns, generatedSlides } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) throw new Error("DB not available");

        const [run] = await db.select().from(contentRuns).where(eq(contentRuns.id, input.runId));
        if (!run) throw new Error("Run not found");
        if (run.status !== "completed" && run.status !== "pending_post") {
          throw new Error(`Run must be completed or pending_post to resend (status: ${run.status})`);
        }

        const caption = run.instagramCaption;
        if (!caption) throw new Error("Run has no caption — was it approved?");

        const slides = await db.select().from(generatedSlides)
          .where(eq(generatedSlides.runId, input.runId))
          .orderBy(generatedSlides.slideIndex as any);

        const readySlides = slides.filter((s) => s.assembledUrl).map((s) => ({
          assembledUrl: s.assembledUrl!,
          headline: s.headline ?? "",
          isVideo: s.isVideoSlide === 1 && !!(s.assembledUrl && (s.assembledUrl.includes(".mp4") || s.assembledUrl.includes("video"))),
        }));

        if (readySlides.length === 0) throw new Error("No assembled slides found for this run");

        const { triggerInstagramPost } = await import("./contentPipeline");
        const posted = await triggerInstagramPost(
          input.runId,
          readySlides,
          caption,
          process.env.MAKE_WEBHOOK_URL
        );

        return { success: true, posted };
      }),

    // Get Kling API status
    getKlingStatus: adminProcedure
      .query(async () => {
        // Check env vars first, then fall back to DB-stored credentials
        let accessKey = ENV.klingAccessKey;
        let secretKey = ENV.klingSecretKey;
        if (!accessKey || !secretKey) {
          try {
            const { getDb } = await import("./db");
            const { appSettings } = await import("../drizzle/schema");
            const { eq } = await import("drizzle-orm");
            const db = await getDb();
            if (db) {
              const [ak] = await db.select().from(appSettings).where(eq(appSettings.key, "kling_access_key"));
              const [sk] = await db.select().from(appSettings).where(eq(appSettings.key, "kling_secret_key"));
              if (ak?.value) accessKey = ak.value;
              if (sk?.value) secretKey = sk.value;
            }
          } catch { /* ignore */ }
        }
        const active = !!(accessKey && secretKey);
        // Return masked key for display (last 4 chars only)
        const maskedKey = accessKey ? `...${accessKey.slice(-4)}` : null;
        return { active, maskedKey };
      }),

    // Save Kling API credentials (persisted in DB appSettings table)
    saveKlingCredentials: adminProcedure
      .input(z.object({
        accessKey: z.string().min(1),
        secretKey: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        if (!input.accessKey.trim() || !input.secretKey.trim()) {
          throw new Error("Both Access Key and Secret Key are required");
        }
        const { getDb } = await import("./db");
        const { appSettings } = await import("../drizzle/schema");
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        // Upsert both keys
        await db.insert(appSettings)
          .values({ key: "kling_access_key", value: input.accessKey.trim() })
          .onConflictDoUpdate({ target: appSettings.key, set: { value: input.accessKey.trim() } });
        await db.insert(appSettings)
          .values({ key: "kling_secret_key", value: input.secretKey.trim() })
          .onConflictDoUpdate({ target: appSettings.key, set: { value: input.secretKey.trim() } });
        console.log("[Kling] Credentials saved to DB successfully");
        return { success: true, message: "Kling credentials saved. Video generation is now active." };
      }),

    // Get Google CSE status
    getGoogleCseStatus: adminProcedure
      .query(async () => {
        let apiKey = ENV.googleCseApiKey;
        let cseId = ENV.googleCseId;
        if (!apiKey || !cseId) {
          try {
            const { getDb } = await import("./db");
            const { appSettings } = await import("../drizzle/schema");
            const { eq } = await import("drizzle-orm");
            const db = await getDb();
            if (db) {
              const [ak] = await db.select().from(appSettings).where(eq(appSettings.key, "google_cse_api_key"));
              const [ci] = await db.select().from(appSettings).where(eq(appSettings.key, "google_cse_id"));
              if (ak?.value) apiKey = ak.value;
              if (ci?.value) cseId = ci.value;
            }
          } catch { /* ignore */ }
        }
        const active = !!(apiKey && cseId);
        const maskedKey = apiKey ? `...${apiKey.slice(-4)}` : null;
        return { active, maskedKey };
      }),

    // Save Google CSE credentials (persisted in DB appSettings table)
    saveGoogleCseCredentials: adminProcedure
      .input(z.object({
        apiKey: z.string().min(1),
        cseId: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        if (!input.apiKey.trim() || !input.cseId.trim()) {
          throw new Error("Both API Key and Search Engine ID are required");
        }
        const { getDb } = await import("./db");
        const { appSettings } = await import("../drizzle/schema");
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db.insert(appSettings)
          .values({ key: "google_cse_api_key", value: input.apiKey.trim() })
          .onConflictDoUpdate({ target: appSettings.key, set: { value: input.apiKey.trim() } });
        await db.insert(appSettings)
          .values({ key: "google_cse_id", value: input.cseId.trim() })
          .onConflictDoUpdate({ target: appSettings.key, set: { value: input.cseId.trim() } });
        console.log("[Google CSE] Credentials saved to DB successfully");
        return { success: true, message: "Google CSE credentials saved. Image search is now active." };
      }),

    // Regenerate a single slide (re-generate media + re-assemble composite)
    regenerateSlide: adminProcedure
      .input(z.object({
        runId: z.number(),
        slideId: z.number(),
      }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const { generatedSlides, appSettings } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) throw new Error("DB not available");

        // Load the slide
        const [slide] = await db.select().from(generatedSlides).where(eq(generatedSlides.id, input.slideId));
        if (!slide) throw new Error("Slide not found");
        if (slide.runId !== input.runId) throw new Error("Slide does not belong to this run");
        if (!slide.videoPrompt) throw new Error("Slide has no video prompt — cannot regenerate");

        // Mark as regenerating — clear old media URLs so the UI shows the spinner
        // Use sql`NULL` cast to safely null out nullable varchar columns
        const { sql: drizzleSql } = await import("drizzle-orm");
        await db.update(generatedSlides)
          .set({ status: "generating_video", videoUrl: drizzleSql`NULL`, assembledUrl: drizzleSql`NULL` })
          .where(eq(generatedSlides.id, input.slideId));

        // Load Kling credentials from DB if env vars are empty
        let klingAK = ENV.klingAccessKey;
        let klingSK = ENV.klingSecretKey;
        if (!klingAK || !klingSK) {
          try {
            const [ak] = await db.select().from(appSettings).where(eq(appSettings.key, "kling_access_key"));
            const [sk] = await db.select().from(appSettings).where(eq(appSettings.key, "kling_secret_key"));
            if (ak?.value) klingAK = ak.value;
            if (sk?.value) klingSK = sk.value;
          } catch { /* ignore */ }
        }
        const hasKling = !!(klingAK && klingSK);
        const wantsVideo = slide.isVideoSlide === 1;

        try {
          // Re-generate media
          let mediaUrl: string | null = null;
          const { generateKlingVideo, generateSlideImage } = await import("./contentPipeline");

          if (wantsVideo && hasKling) {
            console.log(`[RegenerateSlide] Slide ${slide.slideIndex}: Kling 2.5 Turbo video generation`);
            mediaUrl = await generateKlingVideo(slide.videoPrompt, klingAK, klingSK);
          }
          if (!mediaUrl) {
            console.log(`[RegenerateSlide] Slide ${slide.slideIndex}: Nano Banana still image`);
            mediaUrl = await generateSlideImage(slide.videoPrompt);
          }

          if (!mediaUrl) throw new Error("Media generation failed for this slide");

          // Update videoUrl (use empty string instead of null to avoid varchar NOT NULL constraint)
          await db.update(generatedSlides)
            .set({ videoUrl: mediaUrl, status: "assembling" })
            .where(eq(generatedSlides.id, input.slideId));

          // Re-assemble composite
          const { assembleSlideWithSharp } = await import("./sharpCompositor");
          const isVideo = wantsVideo && !!(mediaUrl.includes(".mp4") || mediaUrl.includes("video"));
          const assembledUrl = await assembleSlideWithSharp({
            runId: input.runId,
            slideIndex: slide.slideIndex,
            headline: slide.headline ?? "",
            summary: slide.summary ?? undefined,
            insightLine: slide.insightLine ?? undefined,
            mediaUrl,
            isVideo,
            isCover: slide.slideIndex === 0,
          });

          if (!assembledUrl) throw new Error("Slide assembly failed");

          // Save final result
          await db.update(generatedSlides)
            .set({ assembledUrl, status: "ready" })
            .where(eq(generatedSlides.id, input.slideId));

          console.log(`[RegenerateSlide] Slide ${slide.slideIndex} regenerated → ${assembledUrl.slice(0, 80)}...`);
          return { success: true, assembledUrl, slideIndex: slide.slideIndex };
        } catch (err: any) {
          // Reset slide status to failed so it doesn't stay stuck in generating_video
          await db.update(generatedSlides)
            .set({ status: "failed" })
            .where(eq(generatedSlides.id, input.slideId));
          console.error(`[RegenerateSlide] Slide ${slide.slideIndex} failed:`, err?.message);
          throw err;
        }
      }),

    // Get music suggestion for a run based on its topics
    getMusicSuggestion: adminProcedure
      .input(z.object({ runId: z.number() }))
      .query(async ({ input }) => {
        const { getDb } = await import("./db");
        const { contentRuns } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return null;

        const [run] = await db.select().from(contentRuns).where(eq(contentRuns.id, input.runId));
        if (!run || !run.topicsSelected) return null;

        let topics: Array<{ title: string; summary: string }> = [];
        try {
          topics = JSON.parse(run.topicsSelected) as Array<{ title: string; summary: string }>;
        } catch {
          console.warn(`[getMusicSuggestion] Failed to parse topicsSelected for run #${input.runId}`);
          return null;
        }
        if (!topics.length) return null;
        const topicList = topics.map((t, i) => `${i + 1}. ${t.title}`).join("\n");

        const trackListStr = TRACK_LIBRARY.map((t, idx) => `${idx + 1}. "${t.name}" by ${t.artist} — ${t.mood}, ${t.bpm} BPM`).join("\n");

        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: "You are a music director for viral social media content. You match background music to content themes for maximum emotional impact.",
            },
            {
              role: "user",
              content: `Pick the BEST background track for an Instagram AI news carousel with these topics:\n${topicList}\n\nAvailable tracks:\n${trackListStr}\n\nReturn ONLY the track number (1-${TRACK_LIBRARY.length}), nothing else.`,
            },
          ],
        });

        const raw = (response as any)?.choices?.[0]?.message?.content?.trim() ?? "1";
        const parsedIdx = parseInt(raw, 10);
        const trackIndex = isNaN(parsedIdx) ? 0 : Math.max(0, Math.min(TRACK_LIBRARY.length - 1, parsedIdx - 1));
        const track = TRACK_LIBRARY[trackIndex];

        return {
          name: track.name,
          artist: track.artist,
          mood: track.mood,
          bpm: track.bpm,
          url: track.url,
          license: track.license,
          note: "Royalty-free. Add manually in Instagram's music picker when posting.",
        };
      }),

    // Swap a topic in a pending run
    swapTopic: adminProcedure
      .input(z.object({
        runId: z.number(),
        topicIndex: z.number(),
        newTopic: z.object({
          title: z.string(),
          summary: z.string(),
          source: z.string(),
          url: z.string(),
        }),
      }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const { contentRuns } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const [run] = await db.select().from(contentRuns).where(eq(contentRuns.id, input.runId));
        if (!run) throw new Error("Run not found");
        const topics = JSON.parse(run.topicsSelected ?? "[]");
        topics[input.topicIndex] = {
          ...input.newTopic,
          scores: { shareability: 5, saveWorthiness: 5, debatePotential: 5, informationGap: 5, personalImpact: 5, total: 70 },
        };
        await db.update(contentRuns).set({ topicsSelected: JSON.stringify(topics) }).where(eq(contentRuns.id, input.runId));
        return { success: true };
      }),
    // ─── Make.com Webhook URL ─────────────────────────────────────────────────
    // Save Make.com webhook URL (persisted in DB appSettings table)
    saveWebhookUrl: adminProcedure
      .input(z.object({
        webhookUrl: z.string().url("Must be a valid URL"),
      }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const { appSettings } = await import("../drizzle/schema");
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db.insert(appSettings)
          .values({ key: "make_webhook_url", value: input.webhookUrl.trim() })
          .onConflictDoUpdate({ target: appSettings.key, set: { value: input.webhookUrl.trim() } });
        console.log("[Make.com] Webhook URL saved to DB");
        return { success: true, message: "Webhook URL saved. Auto-posting is now active." };
      }),
    // Get Make.com webhook status
    getWebhookStatus: adminProcedure
      .query(async () => {
        // Check env var first, then fall back to DB-stored value
        let webhookUrl = process.env.MAKE_WEBHOOK_URL;
        if (!webhookUrl) {
          try {
            const { getDb } = await import("./db");
            const { appSettings } = await import("../drizzle/schema");
            const { eq } = await import("drizzle-orm");
            const db = await getDb();
            if (db) {
              const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "make_webhook_url"));
              if (row?.value) webhookUrl = row.value;
            }
          } catch { /* ignore */ }
        }
        if (!webhookUrl) return { configured: false, maskedUrl: null };
        // Mask the URL for display — show only the last 8 chars of the path
        const masked = webhookUrl.replace(/(https:\/\/hook\.make\.com\/[^/]+\/)(.+)/, (_, prefix, token) =>
          prefix + "*".repeat(Math.max(0, token.length - 8)) + token.slice(-8)
        );
        return { configured: true, maskedUrl: masked };
      }),
    // Test Make.com webhook with a ping payload
    testWebhook: adminProcedure
      .mutation(async () => {
        let webhookUrl = process.env.MAKE_WEBHOOK_URL;
        if (!webhookUrl) {
          try {
            const { getDb } = await import("./db");
            const { appSettings } = await import("../drizzle/schema");
            const { eq } = await import("drizzle-orm");
            const db = await getDb();
            if (db) {
              const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "make_webhook_url"));
              if (row?.value) webhookUrl = row.value;
            }
          } catch { /* ignore */ }
        }
        if (!webhookUrl) throw new Error("No webhook URL configured");
        try {
          const res = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "ping",
              message: "SuggestedByGPT webhook test — connection verified",
              timestamp: new Date().toISOString(),
            }),
          });
          return { success: res.ok, statusCode: res.status };
        } catch (err: any) {
          throw new Error(`Webhook ping failed: ${err.message}`);
        }
      }),

    // ─── CTA / Sales Slide ───────────────────────────────────────────────────

    // Save CTA slide image URL (uploaded via the dashboard)
    saveCtaSlide: adminProcedure
      .input(z.object({ imageUrl: z.string() }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const { appSettings } = await import("../drizzle/schema");
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db.insert(appSettings)
          .values({ key: "cta_slide_url", value: input.imageUrl.trim() })
          .onConflictDoUpdate({ target: appSettings.key, set: { value: input.imageUrl.trim() } });
        return { success: true };
      }),

    // Get saved CTA slide URL
    getCtaSlide: adminProcedure
      .query(async () => {
        const { getDb } = await import("./db");
        const { appSettings } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return { url: null };
        const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "cta_slide_url"));
        return { url: row?.value ?? null };
      }),

    // Append CTA slide to an existing run's slides (before webhook fires)
    appendCtaSlide: adminProcedure
      .input(z.object({ runId: z.number() }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const { appSettings, generatedSlides } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) throw new Error("DB not available");

        // Get the CTA slide URL
        const [ctaRow] = await db.select().from(appSettings).where(eq(appSettings.key, "cta_slide_url"));
        if (!ctaRow?.value) throw new Error("No CTA slide saved — upload one in Settings first");

        // Get existing slides to determine next index
        const slides = await db.select().from(generatedSlides)
          .where(eq(generatedSlides.runId, input.runId))
          .orderBy(generatedSlides.slideIndex as any);

        const nextIndex = (slides[slides.length - 1]?.slideIndex ?? 0) + 1;

        // Check if CTA slide already appended
        const hasCta = slides.some(s => s.headline === "CTA_SLIDE");
        if (hasCta) throw new Error("CTA slide already added to this run");

        // Insert CTA slide
        await db.insert(generatedSlides).values({
          runId: input.runId,
          slideIndex: nextIndex,
          headline: "CTA_SLIDE",
          summary: "",
          assembledUrl: ctaRow.value,
          isVideoSlide: 0,
          status: "ready",
        });

        return { success: true, slideIndex: nextIndex };
      }),

    // Remove CTA slide from a run
    removeCtaSlide: adminProcedure
      .input(z.object({ runId: z.number() }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const { generatedSlides } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db.delete(generatedSlides)
          .where(and(eq(generatedSlides.runId, input.runId), eq(generatedSlides.headline, "CTA_SLIDE")));
        return { success: true };
      }),
  }),

  // Re-run Stage 6 (Sharp assembly) on an existing run — fixes slides assembled without proper fonts
  reassembleRun: adminProcedure
    .input(z.object({ runId: z.number() }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("./db");
      const { generatedSlides } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const { assembleAllSlides } = await import("./sharpCompositor");
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const slides = await db.select().from(generatedSlides)
        .where(eq(generatedSlides.runId, input.runId))
        .orderBy(generatedSlides.slideIndex as any);
      if (slides.length === 0) throw new Error("No slides found for run");
      const assembled = await assembleAllSlides(
        slides.map((s: typeof slides[0]) => ({
          runId: input.runId,
          slideIndex: s.slideIndex,
          headline: s.headline ?? "",
          summary: s.summary ?? undefined,
          insightLine: s.insightLine ?? undefined,
          mediaUrl: s.videoUrl ?? null,
          isVideo: s.isVideoSlide === 1 && !!(s.videoUrl && (s.videoUrl.includes(".mp4") || s.videoUrl.includes("video"))),
          isCover: s.slideIndex === 0,
        }))
      );
      let updated = 0;
      for (const result of assembled) {
        const slide = slides.find((s: typeof slides[0]) => s.slideIndex === result.slideIndex);
        if (slide && result.url) {
          await db.update(generatedSlides)
            .set({ assembledUrl: result.url, status: "ready" })
            .where(eq(generatedSlides.id, slide.id));
          updated++;
        }
      }
      return { updated, total: slides.length };
    }),

  // ─── Avatar Reels ─────────────────────────────────────────
  avatarReels: router({
    // Trigger a new avatar reel pipeline (optionally from a suggested topic)
    triggerRun: adminProcedure
      .input(z.object({
        contentBucket: z.string().optional(),
        dayNumber: z.number().optional(),
        suggestedTopicId: z.number().optional(),
      }).optional())
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const { avatarRuns, suggestedTopics } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) throw new Error("DB not available");

        let suggestedTopic: string | undefined;

        // If triggered from a suggested topic, fetch it and mark as running
        if (input?.suggestedTopicId) {
          const [st] = await db.select().from(suggestedTopics).where(eq(suggestedTopics.id, input.suggestedTopicId));
          if (!st) throw new Error("Suggested topic not found");
          suggestedTopic = st.topic;
          await db.update(suggestedTopics).set({ status: "running" }).where(eq(suggestedTopics.id, input.suggestedTopicId));
        }

        const [row] = await db.insert(avatarRuns).values({
          status: "pending",
          contentBucket: input?.contentBucket ?? null,
          dayNumber: input?.dayNumber ?? null,
          suggestedTopicId: input?.suggestedTopicId ?? null,
        }).returning({ id: avatarRuns.id });

        // Link suggestion to the run
        if (input?.suggestedTopicId) {
          await db.update(suggestedTopics).set({ avatarRunId: row.id }).where(eq(suggestedTopics.id, input.suggestedTopicId));
        }

        // Fire pipeline async (don't await)
        import("./avatarPipeline").then(m => m.runAvatarPipeline(row.id, suggestedTopic)).catch(console.error);
        return { runId: row.id };
      }),

    // Get all avatar runs
    getRuns: adminProcedure
      .input(z.object({ limit: z.number().default(20) }).optional())
      .query(async ({ input }) => {
        const { getDb } = await import("./db");
        const { avatarRuns } = await import("../drizzle/schema");
        const { desc } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return [];
        return db.select().from(avatarRuns).orderBy(desc(avatarRuns.createdAt)).limit(input?.limit ?? 20);
      }),

    // Get single run with full detail
    getRun: adminProcedure
      .input(z.object({ runId: z.number() }))
      .query(async ({ input }) => {
        const { getDb } = await import("./db");
        const { avatarRuns } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return null;
        const [run] = await db.select().from(avatarRuns).where(eq(avatarRuns.id, input.runId));
        return run ?? null;
      }),

    // Approve selected topic, continue pipeline
    approveTopic: adminProcedure
      .input(z.object({ runId: z.number(), topicIndex: z.number() }))
      .mutation(async ({ input }) => {
        const { continueAfterTopicApproval } = await import("./avatarPipeline");
        // Fire async
        continueAfterTopicApproval(input.runId, input.topicIndex).catch(console.error);
        return { ok: true };
      }),

    // Reject all topics, re-discover
    reselectTopics: adminProcedure
      .input(z.object({ runId: z.number() }))
      .mutation(async ({ input }) => {
        const { runAvatarPipeline } = await import("./avatarPipeline");
        runAvatarPipeline(input.runId).catch(console.error);
        return { ok: true };
      }),

    // Approve video + caption, post to Instagram
    approvePost: adminProcedure
      .input(z.object({ runId: z.number(), caption: z.string().optional() }))
      .mutation(async ({ input }) => {
        const { continueAfterVideoApproval } = await import("./avatarPipeline");
        await continueAfterVideoApproval(input.runId, input.caption);
        return { ok: true };
      }),

    // Submit feedback (text or STT transcript), trigger revision
    submitFeedback: adminProcedure
      .input(z.object({
        runId: z.number(),
        feedback: z.string(),
        fromStt: z.boolean().default(false),
      }))
      .mutation(async ({ input }) => {
        const { handleFeedback } = await import("./avatarPipeline");
        handleFeedback(input.runId, input.feedback, input.fromStt).catch(console.error);
        return { ok: true };
      }),

    // Surgical B-roll swap
    swapBroll: adminProcedure
      .input(z.object({
        runId: z.number(),
        beatIndex: z.number(),
        newPrompt: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { swapBroll } = await import("./avatarPipeline");
        swapBroll(input.runId, input.beatIndex, input.newPrompt).catch(console.error);
        return { ok: true };
      }),

    // Edit narration text for a specific beat
    editNarration: adminProcedure
      .input(z.object({
        runId: z.number(),
        beatIndex: z.number(),
        newText: z.string(),
      }))
      .mutation(async ({ input }) => {
        const { editNarration } = await import("./avatarPipeline");
        editNarration(input.runId, input.beatIndex, input.newText).catch(console.error);
        return { ok: true };
      }),

    // Cancel running pipeline
    cancelRun: adminProcedure
      .input(z.object({ runId: z.number() }))
      .mutation(async ({ input }) => {
        const { cancelPipeline } = await import("./avatarPipeline");
        const { getDb } = await import("./db");
        const { avatarRuns } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const cancelled = cancelPipeline(input.runId);
        if (!cancelled) {
          const db = await getDb();
          if (db) {
            await db.update(avatarRuns)
              .set({ status: "cancelled", statusDetail: "Cancelled by user", updatedAt: new Date() })
              .where(eq(avatarRuns.id, input.runId));
          }
        }
        return { ok: true };
      }),

    // ─── Suggested Topics Bank ──────────────────────────────
    // Add a topic suggestion
    addSuggestedTopic: adminProcedure
      .input(z.object({
        topic: z.string().min(3).max(300),
        notes: z.string().max(500).optional(),
      }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const { suggestedTopics } = await import("../drizzle/schema");
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const [row] = await db.insert(suggestedTopics).values({
          topic: input.topic,
          notes: input.notes ?? null,
        }).returning();
        return row;
      }),

    // List all suggested topics
    getSuggestedTopics: adminProcedure
      .query(async () => {
        const { getDb } = await import("./db");
        const { suggestedTopics } = await import("../drizzle/schema");
        const { desc } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return [];
        return db.select().from(suggestedTopics).orderBy(desc(suggestedTopics.createdAt));
      }),

    // Skip/dismiss a suggested topic
    skipSuggestedTopic: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const { suggestedTopics } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db.update(suggestedTopics).set({ status: "skipped" }).where(eq(suggestedTopics.id, input.id));
        return { ok: true };
      }),

    // Delete a suggested topic
    deleteSuggestedTopic: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const { suggestedTopics } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db.delete(suggestedTopics).where(eq(suggestedTopics.id, input.id));
        return { ok: true };
      }),

    // ─── Script Preview + Voice Test ────────────────────────

    // Generate a script preview without running the full pipeline
    previewScript: adminProcedure
      .input(z.object({
        topic: z.string().min(3).max(300),
        contentBucket: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { generateScript } = await import("../videogen-avatar/src/scriptDirector.js");
        const script = await generateScript({
          topic: input.topic,
          targetDurationSec: 45,
          contentBucket: input.contentBucket as any,
        });
        return script;
      }),

    // Generate a short voice sample using HeyGen (tests voice + avatar)
    previewVoice: adminProcedure
      .input(z.object({
        text: z.string().min(10).max(500),
      }))
      .mutation(async ({ input }) => {
        const { CONFIG } = await import("../videogen-avatar/src/config.js");
        if (!CONFIG.heygenApiKey) throw new Error("HEYGEN_API_KEY not configured");
        if (!CONFIG.heygenAvatarId && !CONFIG.heygenLookId) throw new Error("HEYGEN_AVATAR_ID or HEYGEN_LOOK_ID not configured");

        // Create a short avatar video just for voice testing
        const createRes = await fetch("https://api.heygen.com/v2/video/generate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Api-Key": CONFIG.heygenApiKey,
          },
          body: JSON.stringify({
            video_inputs: [{
              character: {
                type: "avatar",
                avatar_id: CONFIG.heygenLookId || CONFIG.heygenAvatarId,
                avatar_style: "normal",
                version: "v2",  // Avatar IV
              },
              voice: {
                type: "text",
                input_text: input.text,
                voice_id: CONFIG.heygenVoiceId,
                speed: 1.0,
              },
            }],
            dimension: { width: 1080, height: 1920 },
            aspect_ratio: "9:16",
          }),
        });

        if (!createRes.ok) {
          const err = await createRes.text();
          throw new Error(`HeyGen create failed (${createRes.status}): ${err}`);
        }

        const createData = await createRes.json();
        const videoId = createData.data?.video_id;
        if (!videoId) throw new Error("HeyGen returned no video_id");

        // Poll for completion (max 3 minutes for a short clip)
        const maxWait = 180_000;
        const startTime = Date.now();
        while (Date.now() - startTime < maxWait) {
          await new Promise(r => setTimeout(r, 5000));
          const statusRes = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${videoId}`, {
            headers: { "X-Api-Key": CONFIG.heygenApiKey },
          });
          if (!statusRes.ok) continue;
          const statusData = await statusRes.json();
          const status = statusData.data?.status;
          if (status === "completed") {
            return {
              videoUrl: statusData.data.video_url,
              videoId,
              durationSec: statusData.data.duration ?? null,
            };
          }
          if (status === "failed") {
            throw new Error(`HeyGen voice test failed: ${statusData.data?.error ?? "unknown error"}`);
          }
        }
        throw new Error("HeyGen voice test timed out after 3 minutes");
      }),
  }),
});
export type AppRouter = typeof appRouter;
