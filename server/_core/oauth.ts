import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

/**
 * Register auth routes — replaces the old Manus OAuth callback
 * with a simple email + password login endpoint.
 */
export function registerAuthRoutes(app: Express) {
  // POST /api/auth/login — email + password admin login
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    try {
      const user = await sdk.loginWithPassword(email, password);

      const sessionToken = await sdk.createSessionToken(user.openId, {
        name: user.name || "Admin",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: ONE_YEAR_MS,
      });

      res.json({
        success: true,
        user: { name: user.name, email: user.email, role: user.role },
      });
    } catch (error: any) {
      console.error("[Auth] Login failed:", error?.message);
      res.status(401).json({ error: "Invalid credentials" });
    }
  });
}

// Legacy alias so callers importing `registerOAuthRoutes` still compile.
export const registerOAuthRoutes = registerAuthRoutes;
