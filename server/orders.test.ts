import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { SERVICE_PHASES, PHASE_LABELS, TIER_PHASES, SERVICE_TIERS, ORDER_STATUSES } from "../drizzle/schema";

// ─── Test helpers ───────────────────────────────────────────────

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAdminContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "admin-user",
    email: "admin@suggestedbygpt.com",
    name: "Admin",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

function createUnauthContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

// ─── Schema Constants Tests ─────────────────────────────────────

describe("Schema constants", () => {
  it("defines 10 service phases", () => {
    expect(SERVICE_PHASES).toHaveLength(10);
    expect(SERVICE_PHASES[0]).toBe("onboarding");
    expect(SERVICE_PHASES[9]).toBe("follow_up");
  });

  it("has labels for all phases", () => {
    for (const phase of SERVICE_PHASES) {
      expect(PHASE_LABELS[phase]).toBeDefined();
      expect(typeof PHASE_LABELS[phase]).toBe("string");
    }
  });

  it("AI Jumpstart includes 7 phases (skips content_optimization, competitor_analysis, follow_up)", () => {
    const jumpstart = TIER_PHASES.ai_jumpstart;
    expect(jumpstart).toHaveLength(7);
    expect(jumpstart).not.toContain("content_optimization");
    expect(jumpstart).not.toContain("competitor_analysis");
    expect(jumpstart).not.toContain("follow_up");
  });

  it("AI Dominator includes all 10 phases", () => {
    const dominator = TIER_PHASES.ai_dominator;
    expect(dominator).toHaveLength(10);
    for (const phase of SERVICE_PHASES) {
      expect(dominator).toContain(phase);
    }
  });

  it("defines 2 service tiers", () => {
    expect(SERVICE_TIERS).toHaveLength(2);
    expect(SERVICE_TIERS).toContain("ai_jumpstart");
    expect(SERVICE_TIERS).toContain("ai_dominator");
  });

  it("defines 4 order statuses", () => {
    expect(ORDER_STATUSES).toHaveLength(4);
    expect(ORDER_STATUSES).toContain("pending");
    expect(ORDER_STATUSES).toContain("processing");
    expect(ORDER_STATUSES).toContain("completed");
    expect(ORDER_STATUSES).toContain("cancelled");
  });
});

// ─── Router Structure Tests ─────────────────────────────────────

describe("Router structure", () => {
  it("has all expected top-level routers", () => {
    const caller = appRouter.createCaller(createAdminContext());
    expect(caller.auth).toBeDefined();
    expect(caller.orders).toBeDefined();
    expect(caller.messages).toBeDefined();
    expect(caller.phases).toBeDefined();
    expect(caller.deliverables).toBeDefined();
    expect(caller.system).toBeDefined();
  });

  it("orders router has expected procedures", () => {
    const caller = appRouter.createCaller(createAdminContext());
    expect(caller.orders.list).toBeDefined();
    expect(caller.orders.get).toBeDefined();
    expect(caller.orders.create).toBeDefined();
    expect(caller.orders.update).toBeDefined();
    expect(caller.orders.stats).toBeDefined();
    expect(caller.orders.needingWelcomeEmail).toBeDefined();
    expect(caller.orders.pending).toBeDefined();
  });

  it("messages router has expected procedures", () => {
    const caller = appRouter.createCaller(createAdminContext());
    expect(caller.messages.listByOrder).toBeDefined();
    expect(caller.messages.create).toBeDefined();
    expect(caller.messages.markProcessed).toBeDefined();
    expect(caller.messages.unprocessed).toBeDefined();
    expect(caller.messages.unreadCount).toBeDefined();
  });

  it("phases router has expected procedures", () => {
    const caller = appRouter.createCaller(createAdminContext());
    expect(caller.phases.getByOrder).toBeDefined();
    expect(caller.phases.updateQA).toBeDefined();
  });

  it("deliverables router has expected procedures", () => {
    const caller = appRouter.createCaller(createAdminContext());
    expect(caller.deliverables.listByOrder).toBeDefined();
    expect(caller.deliverables.upload).toBeDefined();
    expect(caller.deliverables.delete).toBeDefined();
  });
});

// ─── Auth Guard Tests ───────────────────────────────────────────

describe("Auth guards", () => {
  it("rejects unauthenticated access to orders.list", async () => {
    const caller = appRouter.createCaller(createUnauthContext());
    await expect(caller.orders.list()).rejects.toThrow();
  });

  it("rejects unauthenticated access to messages.unreadCount", async () => {
    const caller = appRouter.createCaller(createUnauthContext());
    await expect(caller.messages.unreadCount()).rejects.toThrow();
  });

  it("rejects unauthenticated access to phases.getByOrder", async () => {
    const caller = appRouter.createCaller(createUnauthContext());
    await expect(caller.phases.getByOrder({ orderId: 1 })).rejects.toThrow();
  });

  it("allows authenticated access to auth.me", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).toBeDefined();
    expect(result?.name).toBe("Admin");
  });
});
