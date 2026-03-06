import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

// Auth bypass — return a default admin user when no valid session exists.
// Remove this and restore the catch block to re-enable authentication.
const BYPASS_USER: User = {
  id: 1,
  openId: "admin_suggestedbygpt@gmail.com",
  name: "Admin",
  email: "suggestedbygpt@gmail.com",
  loginMethod: "bypass",
  role: "admin",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    // Auth bypass: always return admin user instead of null
    user = BYPASS_USER;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
