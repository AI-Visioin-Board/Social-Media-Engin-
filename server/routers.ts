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
} from "./db";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";
import { SERVICE_PHASES, SERVICE_TIERS, ORDER_STATUSES } from "../drizzle/schema";

const phaseEnum = z.enum(SERVICE_PHASES as unknown as [string, ...string[]]);

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

        // Notify owner of new order
        try {
          await notifyOwner({
            title: `New Order: ${input.businessName}`,
            content: `New ${input.serviceTier === "ai_dominator" ? "AI Dominator ($199)" : "AI Jumpstart ($99)"} order from ${input.clientName} (${input.clientEmail}) for ${input.businessName}.`,
          });
        } catch (e) {
          console.warn("[Orders] Failed to notify owner:", e);
        }

        return order;
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

    stats: protectedProcedure.query(async () => {
      return getOrderStats();
    }),

    needingWelcomeEmail: protectedProcedure.query(async () => {
      return getOrdersNeedingWelcomeEmail();
    }),

    pending: protectedProcedure.query(async () => {
      return getPendingOrders();
    }),
  }),

  // ─── Messages ───────────────────────────────────────────────
  messages: router({
    listByOrder: protectedProcedure
      .input(z.object({ orderId: z.number() }))
      .query(async ({ input }) => {
        return getMessagesByOrderId(input.orderId);
      }),

    create: protectedProcedure
      .input(z.object({
        orderId: z.number(),
        sender: z.enum(["client", "admin"]),
        content: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        const msg = await createMessage(input);

        // Notify owner when client sends a message
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

    unprocessed: protectedProcedure.query(async () => {
      return getUnprocessedClientMessages();
    }),

    unreadCount: protectedProcedure.query(async () => {
      return getUnreadMessageCount();
    }),
  }),

  // ─── Phase Progress ─────────────────────────────────────────
  phases: router({
    getByOrder: protectedProcedure
      .input(z.object({ orderId: z.number() }))
      .query(async ({ input }) => {
        return getPhaseProgressByOrder(input.orderId);
      }),

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
      .mutation(async ({ input }) => {
        return upsertPhaseProgress(input as any);
      }),
  }),

  // ─── Deliverables ──────────────────────────────────────────
  deliverables: router({
    listByOrder: protectedProcedure
      .input(z.object({ orderId: z.number() }))
      .query(async ({ input }) => {
        return getDeliverablesByOrder(input.orderId);
      }),

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
});

export type AppRouter = typeof appRouter;
