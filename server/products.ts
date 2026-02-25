/**
 * SuggestedByGPT — Stripe Product Definitions
 * Centralized product/price config for all Stripe checkout sessions.
 */

export const PRODUCTS = {
  ai_dominator_upgrade: {
    name: "AI Dominator Upgrade",
    description:
      "Upgrade from AI Jumpstart to AI Dominator. Includes Content Optimization, Competitor Analysis, and 30-Day Follow-Up phases.",
    // Price in cents (USD)
    unitAmount: 49900, // $499
    currency: "usd",
  },
  ai_dominator_full: {
    name: "AI Dominator Package",
    description:
      "Full AI Dominator local SEO package. All 10 phases including Content Optimization, Competitor Analysis, and 30-Day Follow-Up.",
    unitAmount: 79900, // $799
    currency: "usd",
  },
  ai_jumpstart_full: {
    name: "AI Jumpstart Package",
    description:
      "AI Jumpstart local SEO package. 7-phase optimization including GBP, Schema Markup, Citation Audit, and Review Strategy.",
    unitAmount: 29900, // $299
    currency: "usd",
  },
} as const;

export type ProductKey = keyof typeof PRODUCTS;
