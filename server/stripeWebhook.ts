import type { Express, Request, Response } from "express";
import express from "express";
import Stripe from "stripe";
import { getDb } from "./db";
import { orders } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { notifyOwner } from "./_core/notification";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2026-02-25.clover",
});

export function registerStripeWebhook(app: Express) {
  // MUST use raw body parser BEFORE express.json() — registered in index.ts before json middleware
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      const sig = req.headers["stripe-signature"];
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";

      let event: Stripe.Event;

      try {
        event = stripe.webhooks.constructEvent(req.body, sig as string, webhookSecret);
      } catch (err: any) {
        console.error("[Stripe Webhook] Signature verification failed:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      // Test events — return verification response
      if (event.id.startsWith("evt_test_")) {
        console.log("[Stripe Webhook] Test event detected, returning verification response");
        return res.json({ verified: true });
      }

      console.log(`[Stripe Webhook] Event: ${event.type} | ID: ${event.id}`);

      try {
        if (event.type === "checkout.session.completed") {
          const session = event.data.object as Stripe.Checkout.Session;
          const orderId = session.metadata?.order_id
            ? parseInt(session.metadata.order_id, 10)
            : null;

          if (orderId) {
            const db = await getDb();
            if (db) {
              // Upgrade the order tier to ai_dominator
              await db
                .update(orders)
                .set({
                  serviceTier: "ai_dominator",
                  status: "processing",
                  updatedAt: new Date(),
                })
                .where(eq(orders.id, orderId));

              console.log(`[Stripe Webhook] Order ${orderId} upgraded to AI Dominator`);

              await notifyOwner({
                title: "Client Upgraded to AI Dominator 🎉",
                content: `Order #${orderId} has been upgraded to AI Dominator after successful payment. Session: ${session.id}`,
              });
            }
          }
        }
      } catch (err) {
        console.error("[Stripe Webhook] Processing error:", err);
        // Still return 200 to prevent Stripe from retrying
      }

      res.json({ received: true });
    }
  );
}
