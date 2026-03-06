import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";

// ─── Utility ────────────────────────────────────────────────────
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export type SessionPayload = {
  openId: string;
  name: string;
};

// ─── Internals ──────────────────────────────────────────────────

function getSessionSecret() {
  return new TextEncoder().encode(ENV.cookieSecret);
}

function parseCookies(cookieHeader: string | undefined) {
  if (!cookieHeader) return new Map<string, string>();
  const parsed = parseCookieHeader(cookieHeader);
  return new Map(Object.entries(parsed));
}

// ─── JWT Signing / Verification ─────────────────────────────────

async function signSession(
  payload: SessionPayload,
  options: { expiresInMs?: number } = {}
): Promise<string> {
  const issuedAt = Date.now();
  const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
  const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
  const secretKey = getSessionSecret();

  return new SignJWT({
    openId: payload.openId,
    name: payload.name,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(expirationSeconds)
    .sign(secretKey);
}

async function verifySession(
  cookieValue: string | undefined | null
): Promise<{ openId: string; name: string } | null> {
  if (!cookieValue) return null;

  try {
    const secretKey = getSessionSecret();
    const { payload } = await jwtVerify(cookieValue, secretKey, {
      algorithms: ["HS256"],
    });
    const { openId, name } = payload as Record<string, unknown>;

    if (!isNonEmptyString(openId) || !isNonEmptyString(name)) {
      console.warn("[Auth] Session payload missing required fields");
      return null;
    }

    return { openId, name };
  } catch (error) {
    console.warn("[Auth] Session verification failed", String(error));
    return null;
  }
}

// ─── Password Authentication ────────────────────────────────────

async function loginWithPassword(
  email: string,
  password: string
): Promise<User> {
  if (!ENV.adminEmail || !ENV.adminPasswordHash) {
    throw new Error("Admin credentials not configured (ADMIN_EMAIL / ADMIN_PASSWORD_HASH)");
  }

  if (email.toLowerCase() !== ENV.adminEmail.toLowerCase()) {
    throw ForbiddenError("Invalid credentials");
  }

  const valid = await bcrypt.compare(password, ENV.adminPasswordHash);
  if (!valid) {
    throw ForbiddenError("Invalid credentials");
  }

  // Upsert admin user into DB
  const openId = `admin_${email.toLowerCase()}`;
  await db.upsertUser({
    openId,
    name: "Admin",
    email: email.toLowerCase(),
    loginMethod: "password",
    role: "admin",
    lastSignedIn: new Date(),
  });

  const user = await db.getUserByOpenId(openId);
  if (!user) throw new Error("Failed to create admin user");

  return user;
}

// ─── Request Authentication (used by tRPC context) ──────────────

async function authenticateRequest(req: Request): Promise<User> {
  const cookies = parseCookies(req.headers.cookie);
  const sessionCookie = cookies.get(COOKIE_NAME);
  const session = await verifySession(sessionCookie);

  if (!session) {
    throw ForbiddenError("Invalid session cookie");
  }

  const user = await db.getUserByOpenId(session.openId);
  if (!user) {
    throw ForbiddenError("User not found");
  }

  // Update last signed in
  await db.upsertUser({
    openId: user.openId,
    lastSignedIn: new Date(),
  });

  return user;
}

// ─── Exported SDK object (consumed by context.ts, oauth.ts) ─────

export const sdk = {
  authenticateRequest,
  signSession,
  verifySession,
  loginWithPassword,
  createSessionToken: async (
    openId: string,
    options: { expiresInMs?: number; name?: string } = {}
  ): Promise<string> => {
    return signSession({ openId, name: options.name || "" }, options);
  },
};
