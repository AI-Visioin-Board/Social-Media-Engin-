import { and, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgresDriver from "postgres";
import {
  InsertUser, users,
  orders, InsertOrder, Order, OrderStatus,
  messages, InsertMessage,
  phaseProgress, InsertPhaseProgress, ServicePhase,
  deliverables, InsertDeliverable,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      const client = postgresDriver(process.env.DATABASE_URL);
      _db = drizzle(client);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── User Helpers ───────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.email && user.email.toLowerCase() === ENV.adminEmail.toLowerCase()) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }
    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }
    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }
    await db.insert(users).values(values).onConflictDoUpdate({
      target: users.openId,
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Order Helpers ──────────────────────────────────────────────

export async function createOrder(data: InsertOrder) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(orders).values(data).returning({ id: orders.id });
  return getOrderById(result[0].id);
}

export async function getOrderById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  return result[0] ?? undefined;
}

export async function listOrders(filters?: { status?: OrderStatus }) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.status) {
    conditions.push(eq(orders.status, filters.status));
  }
  const query = conditions.length > 0
    ? db.select().from(orders).where(and(...conditions)).orderBy(desc(orders.createdAt))
    : db.select().from(orders).orderBy(desc(orders.createdAt));
  return query;
}

export async function updateOrder(id: number, data: Partial<Pick<Order, "status" | "currentPhase" | "welcomeEmailSent" | "notes" | "clientName" | "clientEmail" | "businessName" | "websiteUrl" | "businessAddress" | "businessPhone" | "businessCategory" | "targetArea">>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(orders).set(data).where(eq(orders.id, id));
  return getOrderById(id);
}

export async function getOrdersNeedingWelcomeEmail() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(orders).where(eq(orders.welcomeEmailSent, false));
}

export async function getPendingOrders() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(orders).where(eq(orders.status, "pending"));
}

export async function getOrderStats() {
  const db = await getDb();
  if (!db) return { total: 0, pending: 0, processing: 0, completed: 0 };
  const result = await db.select({
    total: sql<number>`COUNT(*)`,
    pending: sql<number>`SUM(CASE WHEN ${orders.status} = 'pending' THEN 1 ELSE 0 END)`,
    processing: sql<number>`SUM(CASE WHEN ${orders.status} = 'processing' THEN 1 ELSE 0 END)`,
    completed: sql<number>`SUM(CASE WHEN ${orders.status} = 'completed' THEN 1 ELSE 0 END)`,
  }).from(orders);
  return result[0] ?? { total: 0, pending: 0, processing: 0, completed: 0 };
}

// ─── Message Helpers ────────────────────────────────────────────

export async function createMessage(data: InsertMessage) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(messages).values(data).returning();
  return result[0];
}

export async function getMessagesByOrderId(orderId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(messages).where(eq(messages.orderId, orderId)).orderBy(messages.createdAt);
}

export async function getUnprocessedClientMessages() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(messages).where(
    and(
      eq(messages.sender, "client"),
      eq(messages.isProcessed, false)
    )
  ).orderBy(messages.createdAt);
}

export async function markMessageProcessed(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(messages).set({ isProcessed: true }).where(eq(messages.id, id));
}

export async function getUnreadMessageCount() {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({
    count: sql<number>`COUNT(*)`,
  }).from(messages).where(
    and(eq(messages.sender, "client"), eq(messages.isProcessed, false))
  );
  return result[0]?.count ?? 0;
}

// ─── Phase Progress Helpers ─────────────────────────────────────

export async function getPhaseProgressByOrder(orderId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(phaseProgress).where(eq(phaseProgress.orderId, orderId)).orderBy(phaseProgress.createdAt);
}

export async function upsertPhaseProgress(data: {
  orderId: number;
  phase: ServicePhase;
  qaExecute?: boolean;
  qaVerify?: boolean;
  qaTest?: boolean;
  qaDocument?: boolean;
  notes?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db.select().from(phaseProgress).where(
    and(eq(phaseProgress.orderId, data.orderId), eq(phaseProgress.phase, data.phase))
  ).limit(1);

  if (existing.length > 0) {
    const updateData: Record<string, unknown> = {};
    if (data.qaExecute !== undefined) updateData.qaExecute = data.qaExecute;
    if (data.qaVerify !== undefined) updateData.qaVerify = data.qaVerify;
    if (data.qaTest !== undefined) updateData.qaTest = data.qaTest;
    if (data.qaDocument !== undefined) updateData.qaDocument = data.qaDocument;
    if (data.notes !== undefined) updateData.notes = data.notes;

    // Check if all 4 QA steps are complete
    const merged = {
      qaExecute: data.qaExecute ?? existing[0].qaExecute,
      qaVerify: data.qaVerify ?? existing[0].qaVerify,
      qaTest: data.qaTest ?? existing[0].qaTest,
      qaDocument: data.qaDocument ?? existing[0].qaDocument,
    };
    if (merged.qaExecute && merged.qaVerify && merged.qaTest && merged.qaDocument) {
      updateData.completedAt = new Date();
    } else {
      updateData.completedAt = null;
    }

    await db.update(phaseProgress).set(updateData).where(eq(phaseProgress.id, existing[0].id));
    const updated = await db.select().from(phaseProgress).where(eq(phaseProgress.id, existing[0].id)).limit(1);
    return updated[0];
  } else {
    const allComplete = data.qaExecute && data.qaVerify && data.qaTest && data.qaDocument;
    await db.insert(phaseProgress).values({
      orderId: data.orderId,
      phase: data.phase,
      qaExecute: data.qaExecute ?? false,
      qaVerify: data.qaVerify ?? false,
      qaTest: data.qaTest ?? false,
      qaDocument: data.qaDocument ?? false,
      notes: data.notes ?? null,
      completedAt: allComplete ? new Date() : null,
    });
    const rows = await db.select().from(phaseProgress).where(
      and(eq(phaseProgress.orderId, data.orderId), eq(phaseProgress.phase, data.phase))
    ).limit(1);
    return rows[0];
  }
}

// ─── Deliverable Helpers ────────────────────────────────────────

export async function createDeliverable(data: InsertDeliverable) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(deliverables).values(data).returning();
  return result[0];
}

export async function getDeliverablesByOrder(orderId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(deliverables).where(eq(deliverables.orderId, orderId)).orderBy(deliverables.createdAt);
}

export async function deleteDeliverable(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(deliverables).where(eq(deliverables.id, id));
}

// ─── Client Access Token Helpers ────────────────────────────────

import { clientAccessTokens, InsertClientAccessToken, clientUploads, InsertClientUpload } from "../drizzle/schema";

export async function createClientAccessToken(data: InsertClientAccessToken) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Invalidate any existing tokens for this order+email
  await db.delete(clientAccessTokens).where(
    and(eq(clientAccessTokens.orderId, data.orderId), eq(clientAccessTokens.email, data.email))
  );
  const result = await db.insert(clientAccessTokens).values(data).returning();
  return result[0];
}

export async function getClientAccessToken(token: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(clientAccessTokens).where(eq(clientAccessTokens.token, token)).limit(1);
  return result[0] ?? undefined;
}

export async function deleteClientAccessToken(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(clientAccessTokens).where(eq(clientAccessTokens.id, id));
}

// ─── Client Upload Helpers ───────────────────────────────────────

export async function createClientUpload(data: InsertClientUpload) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(clientUploads).values(data).returning();
  return result[0];
}

export async function getClientUploadsByOrder(orderId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(clientUploads).where(eq(clientUploads.orderId, orderId)).orderBy(clientUploads.createdAt);
}

export async function deleteClientUpload(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(clientUploads).where(eq(clientUploads.id, id));
}
