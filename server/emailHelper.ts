/**
 * Email helper for SuggestedByGPT
 * 
 * NOTE: Gmail MCP requires interactive user confirmation before sending.
 * This module provides email template generation so the admin can send
 * welcome emails via the "Send Welcome Email" button in the admin dashboard.
 * The actual sending is done client-side via the Gmail MCP tool.
 */

export function buildWelcomeEmailContent(params: {
  clientName: string;
  businessName: string;
  serviceTier: string;
  portalUrl: string;
  orderId: number;
}): { subject: string; body: string } {
  const { clientName, businessName, serviceTier, portalUrl, orderId } = params;
  const tierName = serviceTier === "ai_dominator" ? "AI Dominator" : "AI Jumpstart";
  const tierPrice = serviceTier === "ai_dominator" ? "$799" : "$299";

  const subject = `Welcome to SuggestedByGPT — Your ${tierName} Order is Confirmed! 🎉`;

  const body = `Hi ${clientName},

Welcome to SuggestedByGPT! We're excited to start working on your AI visibility optimization for ${businessName}.

Your ${tierName} package (${tierPrice}) has been confirmed and we're getting started right away.

ACCESS YOUR CLIENT PORTAL
You can track your progress, view deliverables, and message us directly through your personal client portal:

${portalUrl}

This link is valid for 7 days. We'll send you a fresh link whenever you need access.

WHAT HAPPENS NEXT
We'll begin your AI Visibility Audit within 1-2 business days. You'll be able to see each phase of work as we complete it, and all your deliverables will be uploaded directly to your portal.

WHAT'S INCLUDED IN YOUR ${tierName.toUpperCase()} PACKAGE
${serviceTier === "ai_dominator" ? `
• AI Visibility Audit — See exactly how you appear on ChatGPT, Gemini & Perplexity
• Google Business Profile Optimization — Fully optimized for AI and local search
• Schema Markup Implementation — Structured data so AI understands your business
• Citation Audit & Cleanup — NAP consistency across all directories
• Review Strategy — System to generate authentic 5-star reviews
• Content Optimization — Website content aligned with AI platform descriptions
• Competitor Analysis — Reverse-engineer your top competitors' AI strategies
• Final Report & Deliverables — Everything documented and delivered
• 30-Day Follow-Up — We check results and fine-tune after 30 days
` : `
• AI Visibility Audit — See exactly how you appear on ChatGPT, Gemini & Perplexity
• Google Business Profile Optimization — Fully optimized for AI and local search
• Schema Markup Implementation — Structured data so AI understands your business
• Citation Audit & Cleanup — NAP consistency across all directories
• Review Strategy — System to generate authentic 5-star reviews
• Final Report & Deliverables — Everything documented and delivered
`}

QUESTIONS?
Just reply to this email or send us a message directly through your portal. We typically respond within a few hours during business hours.

Order Reference: #${orderId}

Talk soon,
The SuggestedByGPT Team
support@suggestedbygpt.com

---
SuggestedByGPT — AI Visibility Optimization for Local Businesses
You're receiving this because you purchased a service from SuggestedByGPT.`;

  return { subject, body };
}
