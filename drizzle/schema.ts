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
export const runSlotEnum = pgEnum("run_slot", ["monday", "friday", "manual"]);
export const contentRunStatusEnum = pgEnum("content_run_status", [
  "pending", "discovering", "scoring", "researching",
  "generating", "assembling", "review", "pending_post",
  "posting", "completed", "failed",
]);
export const slideStatusEnum = pgEnum("slide_status", [
  "pending", "researching", "generating_video", "assembling", "ready", "failed",
]);
export const avatarRunStatusEnum = pgEnum("avatar_run_status", [
  "pending", "topic_discovery", "topic_review",
  "scripting", "generating_assets", "generating_avatar",
  "assembling", "video_review", "revision",
  "posting", "completed", "failed", "cancelled",
]);
export const suggestedTopicStatusEnum = pgEnum("suggested_topic_status", [
  "pending", "running", "used", "skipped",
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

// ─────────────────────────────────────────────
// AVATAR REELS — AI Avatar Video Pipeline
// ─────────────────────────────────────────────

/**
 * Avatar reel run — one run = one Quinn avatar reel video
 * Stores all intermediate pipeline state for surgical editing (B-roll swap, narration edit)
 */
export const avatarRuns = pgTable("avatar_runs", {
  id: serial("id").primaryKey(),
  /** Pipeline status state machine */
  status: avatarRunStatusEnum("status").default("pending").notNull(),
  /** Granular progress detail (e.g. "Generating asset 3/15...") */
  statusDetail: text("statusDetail"),
  /** Approved topic headline */
  topic: text("topic"),
  /** JSON array of 3 scored topic candidates for user selection */
  topicCandidates: text("topicCandidates"),
  /** JSON array of verified source articles {url, domain, title, publishedAt, bodyExcerpt, credibilityTier} */
  sourceArticles: text("sourceArticles"),
  /** JSON array of extracted facts {fact, sourceUrl, sourceIndex} */
  extractedFacts: text("extractedFacts"),
  /** Verification status: verified_3plus | insufficient_sources | unverified */
  verificationStatus: varchar("verificationStatus", { length: 32 }),
  /** Weighted virality score from topic selection */
  viralityScore: integer("viralityScore"),
  /** Full VideoScript JSON from Stage 1 — persisted for narration editing */
  scriptJson: text("scriptJson"),
  /** JSON AssetMap from Stage 3 — persisted for surgical B-roll editing */
  assetMap: text("assetMap"),
  /** JSON MultiAssetMap — multiple clips per beat for rapid-fire sub-clipping */
  multiAssetMap: text("multiAssetMap"),
  /** Full Shotstack Edit JSON — persisted for re-assembly */
  shotstackEditJson: text("shotstackEditJson"),
  /** HeyGen avatar video URL */
  avatarVideoUrl: varchar("avatarVideoUrl", { length: 1000 }),
  /** Avatar video duration in seconds */
  avatarDurationSec: integer("avatarDurationSec"),
  /** Shotstack render output URL */
  assembledVideoUrl: varchar("assembledVideoUrl", { length: 1000 }),
  /** Post-processed final URL */
  finalVideoUrl: varchar("finalVideoUrl", { length: 1000 }),
  /** Instagram caption + hashtags */
  instagramCaption: text("instagramCaption"),
  /** JSON array of feedback entries {feedback, timestamp, fromStt} */
  feedbackHistory: text("feedbackHistory"),
  /** Number of revision cycles */
  revisionCount: integer("revisionCount").default(0).notNull(),
  /** Day number in 30-day series (null if not in series) */
  dayNumber: integer("dayNumber"),
  /** Content bucket: tool_drop, big_move, proof_drop, reality_check, future_drop, ai_fail */
  contentBucket: varchar("contentBucket", { length: 32 }),
  /** HeyGen outfit/look ID used for this video */
  outfitId: varchar("outfitId", { length: 128 }),
  /** Make.com webhook response / Instagram post ID */
  instagramPostId: varchar("instagramPostId", { length: 255 }),
  /** Error message if status = failed */
  errorMessage: text("errorMessage"),
  /** HeyGen API credits consumed by this run */
  heygenCreditsUsed: integer("heygenCreditsUsed").default(0).notNull(),
  /** FK to suggested_topics if this run was seeded by a user suggestion */
  suggestedTopicId: integer("suggested_topic_id"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type AvatarRun = typeof avatarRuns.$inferSelect;
export type InsertAvatarRun = typeof avatarRuns.$inferInsert;

/**
 * Suggested topics bank — user-submitted topics that still go through full research verification
 */
export const suggestedTopics = pgTable("suggested_topics", {
  id: serial("id").primaryKey(),
  /** The topic/headline the user wants researched */
  topic: text("topic").notNull(),
  /** Optional notes about why this topic matters or what angle to take */
  notes: text("notes"),
  /** pending = in bank, running = pipeline active, used = reel created, skipped = dismissed */
  status: suggestedTopicStatusEnum("status").default("pending").notNull(),
  /** Link to the avatar_runs row that used this topic (null if unused) */
  avatarRunId: integer("avatar_run_id"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SuggestedTopic = typeof suggestedTopics.$inferSelect;
export type InsertSuggestedTopic = typeof suggestedTopics.$inferInsert;

// ─────────────────────────────────────────────
// EDITORIAL CALENDAR
// ─────────────────────────────────────────────

/**
 * Calendar entries — planned content for the editorial calendar
 */
export const calendarEntries = pgTable("calendar_entries", {
  id: serial("id").primaryKey(),
  scheduledDate: varchar("scheduled_date", { length: 10 }).notNull(), // 'YYYY-MM-DD'
  contentType: varchar("content_type", { length: 20 }).notNull(), // 'carousel' or 'reel'
  topicTitle: text("topic_title"),
  topicContext: text("topic_context"),
  status: varchar("status", { length: 30 }).notNull().default("planned"),
  pipelineRunId: integer("pipeline_run_id"),
  pipelineType: varchar("pipeline_type", { length: 20 }),
  notes: text("notes"),
  // Video upload fields (Captions/Mirage workflow)
  uploadedVideoUrl: text("uploaded_video_url"),
  uploadedVideoName: text("uploaded_video_name"),
  instagramCaption: text("instagram_caption"),
  postStatus: varchar("post_status", { length: 30 }).default("draft"), // draft | ready | posted_ig | posted_yt | posted_both
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type CalendarEntry = typeof calendarEntries.$inferSelect;
export type InsertCalendarEntry = typeof calendarEntries.$inferInsert;
