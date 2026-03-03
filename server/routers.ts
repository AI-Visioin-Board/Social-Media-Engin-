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

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2026-02-25.clover",
});

const phaseEnum = z.enum(SERVICE_PHASES as unknown as [string, ...string[]]);

// Cookie name for client portal sessions
const CLIENT_PORTAL_COOKIE = "sbgpt_client_session";

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
        const slides = await db.select().from(generatedSlides).where(eq(generatedSlides.runId, input.runId));
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
          scores: z.object({
            businessOwnerImpact: z.number(),
            generalPublicRelevance: z.number(),
            viralPotential: z.number(),
            worldImportance: z.number(),
            interestingness: z.number(),
            total: z.number(),
          }),
        })),
      }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const { contentRuns } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) throw new Error("DB not available");

        await db.update(contentRuns).set({
          topicsSelected: JSON.stringify(input.selectedTopics),
          adminApproved: true,
          status: "researching",
        }).where(eq(contentRuns.id, input.runId));

        // Continue pipeline async
        const { continueAfterApproval } = await import("./contentPipeline");
        continueAfterApproval(input.runId, input.selectedTopics, {
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
        }));

        // Fire Make.com webhook
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

    // Get Kling API status
    getKlingStatus: adminProcedure
      .query(async () => {
        const active = !!(ENV.klingAccessKey && ENV.klingSecretKey);
        return { active };
      }),

    // Save Kling API credentials (stored as env vars via platform secrets)
    saveKlingCredentials: adminProcedure
      .input(z.object({
        accessKey: z.string().min(1),
        secretKey: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        // Credentials are managed via platform secrets (Settings → Secrets)
        // This endpoint validates the format and confirms they're received
        if (!input.accessKey.trim() || !input.secretKey.trim()) {
          throw new Error("Both Access Key and Secret Key are required");
        }
        // Log that credentials were submitted (actual storage is via platform secrets UI)
        console.log("[Kling] Credentials submitted — update KLING_ACCESS_KEY and KLING_SECRET_KEY in Settings → Secrets");
        return { 
          success: true, 
          message: "Credentials received. To activate, paste these values into Settings → Secrets as KLING_ACCESS_KEY and KLING_SECRET_KEY, then redeploy."
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
          scores: { businessOwnerImpact: 5, generalPublicRelevance: 5, viralPotential: 5, worldImportance: 5, interestingness: 5, total: 25 },
        };
        await db.update(contentRuns).set({ topicsSelected: JSON.stringify(topics) }).where(eq(contentRuns.id, input.runId));
        return { success: true };
      }),
  }),
});
export type AppRouter = typeof appRouter;
