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
