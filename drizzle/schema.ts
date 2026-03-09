import { boolean, integer, pgEnum, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

// ─── Enum Definitions (Postgres requires top-level enum types) ───

export const roleEnum = pgEnum("role", ["user", "admin"]);
export const serviceTierEnum = pgEnum("service_tier", ["ai_jumpstart", "ai_dominator"]);
export const orderStatusEnum = pgEnum("order_status", ["pending", "processing", "completed", "cancelled"]);
export const servicePhaseEnum = pgEnum("service_phase", [
  "onboarding", "ai_audit", "gbp_optimization", "schema_markup",
  "citation_audit", "review_strategy", "content_optimization",
  "competitor_analysis", "final_report", "follow_up",
]);
export const messageSenderEnum = pgEnum("message_sender", ["client", "admin"]);
export const runSlotEnum = pgEnum("run_slot", ["monday", "friday"]);
export const contentRunStatusEnum = pgEnum("content_run_status", [
  "pending", "discovering", "scoring", "researching",
  "generating", "assembling", "review", "pending_post",
  "posting", "completed", "failed",
]);
export const slideStatusEnum = pgEnum("slide_status", [
  "pending", "researching", "generating_video", "assembling", "ready", "failed",
]);

// ─────────────────────────────────────────────
// CORE — Auth & CRM
// ─────────────────────────────────────────────

/**
 * Core user table backing auth flow.
 */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Service tiers offered by SuggestedByGPT
 */
export const SERVICE_TIERS = ["ai_jumpstart", "ai_dominator"] as const;
export type ServiceTier = (typeof SERVICE_TIERS)[number];

/**
 * Order statuses
 */
export const ORDER_STATUSES = ["pending", "processing", "completed", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * The 10 service execution phases
 */
export const SERVICE_PHASES = [
  "onboarding",
  "ai_audit",
  "gbp_optimization",
  "schema_markup",
  "citation_audit",
  "review_strategy",
  "content_optimization",
  "competitor_analysis",
  "final_report",
  "follow_up",
] as const;
export type ServicePhase = (typeof SERVICE_PHASES)[number];

/**
 * Phase labels for display
 */
export const PHASE_LABELS: Record<ServicePhase, string> = {
  onboarding: "Client Onboarding",
  ai_audit: "AI Visibility Audit",
  gbp_optimization: "GBP Optimization",
  schema_markup: "Schema Markup",
  citation_audit: "Citation Audit",
  review_strategy: "Review Strategy",
  content_optimization: "Content Optimization",
  competitor_analysis: "Competitor Analysis",
  final_report: "Final Report & Delivery",
  follow_up: "30-Day Follow-Up",
};

/**
 * Phases included in each tier
 */
export const TIER_PHASES: Record<ServiceTier, ServicePhase[]> = {
  ai_jumpstart: [
    "onboarding", "ai_audit", "gbp_optimization", "schema_markup",
    "citation_audit", "review_strategy", "final_report",
  ],
  ai_dominator: [
    "onboarding", "ai_audit", "gbp_optimization", "schema_markup",
    "citation_audit", "review_strategy", "content_optimization",
    "competitor_analysis", "final_report", "follow_up",
  ],
};

/**
 * Orders table — tracks client service orders
 */
export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  clientName: varchar("clientName", { length: 255 }).notNull(),
  clientEmail: varchar("clientEmail", { length: 320 }).notNull(),
  businessName: varchar("businessName", { length: 255 }).notNull(),
  websiteUrl: varchar("websiteUrl", { length: 500 }),
  businessAddress: varchar("businessAddress", { length: 500 }),
  businessPhone: varchar("businessPhone", { length: 50 }),
  businessCategory: varchar("businessCategory", { length: 255 }),
  targetArea: varchar("targetArea", { length: 255 }),
  serviceTier: serviceTierEnum("serviceTier").notNull(),
  status: orderStatusEnum("status").default("pending").notNull(),
  currentPhase: servicePhaseEnum("currentPhase").default("onboarding").notNull(),
  welcomeEmailSent: boolean("welcomeEmailSent").default(false).notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Order = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;

/**
 * Messages table — client-admin communication
 */
export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  orderId: integer("orderId").notNull(),
  sender: messageSenderEnum("sender").notNull(),
  content: text("content").notNull(),
  isProcessed: boolean("isProcessed").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;

/**
 * Phase progress — tracks QA verification for each phase
 */
export const phaseProgress = pgTable("phase_progress", {
  id: serial("id").primaryKey(),
  orderId: integer("orderId").notNull(),
  phase: servicePhaseEnum("phase").notNull(),
  qaExecute: boolean("qaExecute").default(false).notNull(),
  qaVerify: boolean("qaVerify").default(false).notNull(),
  qaTest: boolean("qaTest").default(false).notNull(),
  qaDocument: boolean("qaDocument").default(false).notNull(),
  notes: text("notes"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PhaseProgress = typeof phaseProgress.$inferSelect;
export type InsertPhaseProgress = typeof phaseProgress.$inferInsert;

/**
 * Deliverables — files uploaded per order/phase
 */
export const deliverables = pgTable("deliverables", {
  id: serial("id").primaryKey(),
  orderId: integer("orderId").notNull(),
  phase: servicePhaseEnum("phase").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  fileUrl: varchar("fileUrl", { length: 1000 }).notNull(),
  fileKey: varchar("fileKey", { length: 500 }).notNull(),
  mimeType: varchar("mimeType", { length: 100 }),
  fileSize: integer("fileSize"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Deliverable = typeof deliverables.$inferSelect;
export type InsertDeliverable = typeof deliverables.$inferInsert;

/**
 * Client access tokens — magic links for client portal login
 * Each token is tied to an order and the client's email.
 * Tokens expire after 7 days and can only be used once (or reused within session).
 */
export const clientAccessTokens = pgTable("client_access_tokens", {
  id: serial("id").primaryKey(),
  orderId: integer("orderId").notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  token: varchar("token", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ClientAccessToken = typeof clientAccessTokens.$inferSelect;
export type InsertClientAccessToken = typeof clientAccessTokens.$inferInsert;

/**
 * Client uploads — documents uploaded by clients (intake forms, logos, credentials, etc.)
 */
export const clientUploads = pgTable("client_uploads", {
  id: serial("id").primaryKey(),
  orderId: integer("orderId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  fileUrl: varchar("fileUrl", { length: 1000 }).notNull(),
  fileKey: varchar("fileKey", { length: 500 }).notNull(),
  mimeType: varchar("mimeType", { length: 100 }),
  fileSize: integer("fileSize"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ClientUpload = typeof clientUploads.$inferSelect;
export type InsertClientUpload = typeof clientUploads.$inferInsert;

// ─────────────────────────────────────────────
// CONTENT STUDIO — Social Media Automation
// ─────────────────────────────────────────────

/**
 * Content pipeline run — one run = one carousel post (Mon or Fri)
 */
export const contentRuns = pgTable("content_runs", {
  id: serial("id").primaryKey(),
  /** "monday" or "friday" — which slot this run is for */
  runSlot: runSlotEnum("runSlot").notNull(),
  /** Overall pipeline status */
  status: contentRunStatusEnum("status").default("pending").notNull(),
  /** Raw topics discovered (JSON array of {title, source, url}) */
  topicsRaw: text("topicsRaw"),
  /** Shortlisted 12 topics after dedup/no-repeat filter (JSON) */
  topicsShortlisted: text("topicsShortlisted"),
  /** Final 5 selected topics with scores (JSON) */
  topicsSelected: text("topicsSelected"),
  /** Human-readable progress detail (e.g. "Researching topic 2/4: OpenAI GPT-5...") */
  statusDetail: text("statusDetail"),
  /** Error message if status = failed */
  errorMessage: text("errorMessage"),
  /** Whether admin has approved the topic selection */
  adminApproved: boolean("adminApproved").default(false).notNull(),
  /** GPT-4o generated Instagram caption with hashtags */
  instagramCaption: text("instagramCaption"),
  /** Whether admin has approved the post to be sent to Instagram */
  postApproved: boolean("postApproved").default(false).notNull(),
  /** Make.com webhook response / Instagram post ID after posting */
  instagramPostId: varchar("instagramPostId", { length: 255 }),
  /** Full Creative Director brief JSON — persisted for diagnosis/review */
  creativeBrief: text("creativeBrief"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type ContentRun = typeof contentRuns.$inferSelect;
export type InsertContentRun = typeof contentRuns.$inferInsert;

/**
 * Published topics — used for no-repeat logic across Mon/Fri runs
 */
export const publishedTopics = pgTable("published_topics", {
  id: serial("id").primaryKey(),
  runId: integer("runId").notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  summary: text("summary"),
  /** Normalized title for fuzzy dedup matching */
  titleNormalized: varchar("titleNormalized", { length: 500 }).notNull(),
  publishedAt: timestamp("publishedAt").defaultNow().notNull(),
});

export type PublishedTopic = typeof publishedTopics.$inferSelect;
export type InsertPublishedTopic = typeof publishedTopics.$inferInsert;

/**
 * Generated slides — one row per slide per run (cover + 5 content slides)
 */
export const generatedSlides = pgTable("generated_slides", {
  id: serial("id").primaryKey(),
  runId: integer("runId").notNull(),
  slideIndex: integer("slideIndex").notNull(), // 0 = cover, 1-5 = content
  headline: varchar("headline", { length: 500 }),
  summary: text("summary"),
  /** Research citations from Perplexity (JSON array of {source, url}) */
  citations: text("citations"),
  /** Seedance-generated B-roll video URL (S3) */
  videoUrl: varchar("videoUrl", { length: 1000 }),
  /** Assembled final slide MP4 URL (S3) — output of FFmpeg compositor */
  assembledUrl: varchar("assembledUrl", { length: 1000 }),
  /** Seedance video prompt used */
  videoPrompt: text("videoPrompt"),
  /** Whether this slide should use video (1) or still image (0) — 2 video slides per carousel */
  isVideoSlide: integer("isVideoSlide").default(0).notNull(),
  /** Optional 1-sentence context line shown as a chat bubble below the headline (null = not needed) */
  insightLine: varchar("insightLine", { length: 200 }),
  status: slideStatusEnum("status").default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type GeneratedSlide = typeof generatedSlides.$inferSelect;
export type InsertGeneratedSlide = typeof generatedSlides.$inferInsert;

/**
 * Key-value store for app-level settings (e.g. Kling API credentials).
 * Values are stored as text; sensitive values are stored encrypted.
 */
export const appSettings = pgTable("appSettings", {
  key: varchar("key", { length: 128 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type AppSetting = typeof appSettings.$inferSelect;
