import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerAuthRoutes } from "./oauth";
import path from "path";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { registerStripeWebhook } from "../stripeWebhook";
import { migrateDatabase } from "../migrate";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function installFonts() {
  // Install Anton and Oswald fonts system-wide so Sharp/librsvg can find them via fontconfig.
  // librsvg does NOT support @font-face with local file paths — fonts must be in the system font cache.
  try {
    const { execSync } = await import("child_process");
    const { existsSync, copyFileSync, mkdirSync } = await import("fs");
    const { join, dirname } = await import("path");
    const { fileURLToPath } = await import("url");
    const __dir = dirname(fileURLToPath(import.meta.url));
    const fontsDir = join(__dir, "../fonts");
    const systemFontsDir = "/usr/share/fonts/truetype/custom";

    if (!existsSync(systemFontsDir)) {
      execSync(`sudo mkdir -p ${systemFontsDir}`, { stdio: "ignore" });
    }

    const fonts = ["Anton-Regular.ttf", "Oswald-Bold.ttf"];
    let installed = 0;
    for (const font of fonts) {
      const src = join(fontsDir, font);
      const dest = join(systemFontsDir, font);
      if (existsSync(src) && !existsSync(dest)) {
        execSync(`sudo cp "${src}" "${dest}"`, { stdio: "ignore" });
        installed++;
      }
    }
    if (installed > 0) {
      execSync("sudo fc-cache -f", { stdio: "ignore" });
      console.log(`[Startup] Installed ${installed} font(s) to ${systemFontsDir} and refreshed fontconfig cache`);
    } else {
      console.log("[Startup] Fonts already installed — fontconfig cache up to date");
    }
  } catch (e: any) {
    console.warn("[Startup] Font installation skipped (non-critical):", e?.message);
  }
}

async function startServer() {
  // ── Create database tables if they don't exist ──
  await migrateDatabase();

  // ── Install fonts for Sharp/librsvg text rendering ──
  await installFonts();

  // ── Ghost-run recovery: fail any runs left in-flight from a previous server crash ──
  try {
    const postgres = await import("postgres");
    const sql = postgres.default(process.env.DATABASE_URL!);
    // Mark all in-flight runs as failed
    const result = await sql`
      UPDATE content_runs SET status = 'failed'
      WHERE status NOT IN ('completed','failed','needs_review','idle')
    `;
    if (Number(result.count) > 0) {
      console.log(`[Startup] Auto-failed ${result.count} ghost run(s) left in-flight from previous session`);
    }
    // Also reset any stuck slide statuses
    const slideResult = await sql`
      UPDATE generated_slides SET status = 'ready'
      WHERE status IN ('generating_video','assembling')
    `;
    if (Number(slideResult.count) > 0) {
      console.log(`[Startup] Reset ${slideResult.count} stuck slide(s) to 'ready'`);
    }
    await sql.end();
  } catch (e) {
    console.warn("[Startup] Ghost-run recovery skipped:", e);
  }

  const app = express();
  const server = createServer(app);
  // Stripe webhook MUST be registered before express.json() to preserve raw body
  registerStripeWebhook(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // Auth routes (login endpoint)
  registerAuthRoutes(app);
  // Serve uploaded files (local filesystem storage)
  app.use("/uploads", express.static(path.resolve(process.env.UPLOADS_DIR || "./public/uploads")));
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
