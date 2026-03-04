import { boolean, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
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
export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),
  clientName: varchar("clientName", { length: 255 }).notNull(),
  clientEmail: varchar("clientEmail", { length: 320 }).notNull(),
  businessName: varchar("businessName", { length: 255 }).notNull(),
  websiteUrl: varchar("websiteUrl", { length: 500 }),
  businessAddress: varchar("businessAddress", { length: 500 }),
  businessPhone: varchar("businessPhone", { length: 50 }),
  businessCategory: varchar("businessCategory", { length: 255 }),
  targetArea: varchar("targetArea", { length: 255 }),
  serviceTier: mysqlEnum("serviceTier", ["ai_jumpstart", "ai_dominator"]).notNull(),
  status: mysqlEnum("status", ["pending", "processing", "completed", "cancelled"]).default("pending").notNull(),
  currentPhase: mysqlEnum("currentPhase", [
    "onboarding", "ai_audit", "gbp_optimization", "schema_markup",
    "citation_audit", "review_strategy", "content_optimization",
    "competitor_analysis", "final_report", "follow_up",
  ]).default("onboarding").notNull(),
  welcomeEmailSent: boolean("welcomeEmailSent").default(false).notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Order = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;

/**
 * Messages table — client-admin communication
 */
export const messages = mysqlTable("messages", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull(),
  sender: mysqlEnum("sender", ["client", "admin"]).notNull(),
  content: text("content").notNull(),
  isProcessed: boolean("isProcessed").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;

/**
 * Phase progress — tracks QA verification for each phase
 */
export const phaseProgress = mysqlTable("phase_progress", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull(),
  phase: mysqlEnum("phase", [
    "onboarding", "ai_audit", "gbp_optimization", "schema_markup",
    "citation_audit", "review_strategy", "content_optimization",
    "competitor_analysis", "final_report", "follow_up",
  ]).notNull(),
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
export const deliverables = mysqlTable("deliverables", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull(),
  phase: mysqlEnum("phase", [
    "onboarding", "ai_audit", "gbp_optimization", "schema_markup",
    "citation_audit", "review_strategy", "content_optimization",
    "competitor_analysis", "final_report", "follow_up",
  ]).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  fileUrl: varchar("fileUrl", { length: 1000 }).notNull(),
  fileKey: varchar("fileKey", { length: 500 }).notNull(),
  mimeType: varchar("mimeType", { length: 100 }),
  fileSize: int("fileSize"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Deliverable = typeof deliverables.$inferSelect;
export type InsertDeliverable = typeof deliverables.$inferInsert;

/**
 * Client access tokens — magic links for client portal login
 * Each token is tied to an order and the client's email.
 * Tokens expire after 7 days and can only be used once (or reused within session).
 */
export const clientAccessTokens = mysqlTable("client_access_tokens", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull(),
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
export const clientUploads = mysqlTable("client_uploads", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  fileUrl: varchar("fileUrl", { length: 1000 }).notNull(),
  fileKey: varchar("fileKey", { length: 500 }).notNull(),
  mimeType: varchar("mimeType", { length: 100 }),
  fileSize: int("fileSize"),
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
export const contentRuns = mysqlTable("content_runs", {
  id: int("id").autoincrement().primaryKey(),
  /** "monday" or "friday" — which slot this run is for */
  runSlot: mysqlEnum("runSlot", ["monday", "friday"]).notNull(),
  /** Overall pipeline status */
  status: mysqlEnum("status", [
    "pending",        // just created, not started
    "discovering",    // fetching topics from APIs
    "scoring",        // GPT scoring agent running
    "researching",    // Perplexity deep research
    "generating",     // Seedance video generation
    "assembling",     // FFmpeg compositing slides
    "review",         // awaiting admin topic approval
    "pending_post",   // assembled, awaiting admin post approval
    "posting",        // sending to Instagram via Make.com
    "completed",      // done
    "failed",         // error occurred
  ]).default("pending").notNull(),
  /** Raw topics discovered (JSON array of {title, source, url}) */
  topicsRaw: text("topicsRaw"),
  /** Shortlisted 12 topics after dedup/no-repeat filter (JSON) */
  topicsShortlisted: text("topicsShortlisted"),
  /** Final 5 selected topics with scores (JSON) */
  topicsSelected: text("topicsSelected"),
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ContentRun = typeof contentRuns.$inferSelect;
export type InsertContentRun = typeof contentRuns.$inferInsert;

/**
 * Published topics — used for no-repeat logic across Mon/Fri runs
 */
export const publishedTopics = mysqlTable("published_topics", {
  id: int("id").autoincrement().primaryKey(),
  runId: int("runId").notNull(),
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
export const generatedSlides = mysqlTable("generated_slides", {
  id: int("id").autoincrement().primaryKey(),
  runId: int("runId").notNull(),
  slideIndex: int("slideIndex").notNull(), // 0 = cover, 1-5 = content
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
  isVideoSlide: int("isVideoSlide").default(0).notNull(),
  /** Optional 1-sentence context line shown as a chat bubble below the headline (null = not needed) */
  insightLine: varchar("insightLine", { length: 200 }),
  status: mysqlEnum("status", [
    "pending", "researching", "generating_video", "assembling", "ready", "failed"
  ]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type GeneratedSlide = typeof generatedSlides.$inferSelect;
export type InsertGeneratedSlide = typeof generatedSlides.$inferInsert;
