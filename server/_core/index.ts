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
  // Install Anton and Oswald fonts for the SVG fallback rendering path.
  // Primary rendering: HTML/CSS via headless Chromium (loads Google Fonts via CDN).
  // Fallback rendering: Sharp SVG overlays using librsvg (needs fontconfig).
  // librsvg does NOT support @font-face with local file paths — fonts must be discoverable via fontconfig.
  //
  // Railway (and most Docker containers) don't have sudo, so we use USER-SPACE font directories
  // and a custom fontconfig configuration. This works without any elevated privileges.
  try {
    const { existsSync, copyFileSync, mkdirSync, writeFileSync } = await import("fs");
    const { join, dirname } = await import("path");
    const { fileURLToPath } = await import("url");
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    const __dir = dirname(fileURLToPath(import.meta.url));
    // Robust font directory resolution — works in dev (server/_core → ../fonts)
    // and in prod build (dist/_core → ../../fonts or ../fonts)
    const fontsDir = [
      join(__dir, "../fonts"),
      join(__dir, "../../fonts"),
      join(__dir, "../server/fonts"),
    ].find(d => existsSync(d)) || join(__dir, "../fonts");
    const homeDir = process.env.HOME || "/app";

    // ── Step 1: Copy fonts to user-space font directory (no sudo needed) ──
    const userFontsDir = join(homeDir, ".local", "share", "fonts");
    if (!existsSync(userFontsDir)) {
      mkdirSync(userFontsDir, { recursive: true });
    }

    const fonts = ["Anton-Regular.ttf", "Oswald-Bold.ttf"];
    let installed = 0;
    for (const font of fonts) {
      const src = join(fontsDir, font);
      const dest = join(userFontsDir, font);
      if (existsSync(src) && !existsSync(dest)) {
        copyFileSync(src, dest);
        installed++;
      }
    }

    // ── Step 2: Create a custom fontconfig configuration ──
    // This is CRITICAL for Railway where the default fontconfig config may be missing.
    // The "Fontconfig error: Cannot load default config file: No such file: (null)" error
    // means fontconfig can't find fonts.conf — we create one that points to our fonts.
    const fontconfigDir = join(homeDir, ".config", "fontconfig");
    if (!existsSync(fontconfigDir)) {
      mkdirSync(fontconfigDir, { recursive: true });
    }

    const cacheDir = join(homeDir, ".cache", "fontconfig");
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }

    // Write a complete fontconfig configuration that includes both our custom fonts
    // and any system fonts that might exist on the container
    const fontsConf = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <!-- Custom fonts bundled with the app -->
  <dir>${fontsDir}</dir>
  <dir>${userFontsDir}</dir>
  <!-- Standard system font directories (may or may not exist) -->
  <dir>/usr/share/fonts</dir>
  <dir>/usr/local/share/fonts</dir>
  <!-- Font cache directory -->
  <cachedir>${cacheDir}</cachedir>
  <!-- Alias Anton as a fallback for Impact (common substitution) -->
  <alias>
    <family>Anton</family>
    <prefer><family>Anton</family></prefer>
    <default><family>Impact</family></default>
  </alias>
</fontconfig>`;

    writeFileSync(join(fontconfigDir, "fonts.conf"), fontsConf);

    // ── Step 3: Set FONTCONFIG_FILE env var BEFORE any Sharp/librsvg usage ──
    // This tells fontconfig exactly where to find our config file.
    // Must be set before Sharp processes any SVG text.
    process.env.FONTCONFIG_FILE = join(fontconfigDir, "fonts.conf");
    process.env.FONTCONFIG_PATH = fontconfigDir;

    // ── Step 4: Refresh font cache (no sudo needed for user fonts) ──
    try {
      await execFileAsync("fc-cache", ["-f", userFontsDir, fontsDir], { timeout: 10_000 });
    } catch {
      // fc-cache might not be available or might fail — fontconfig will still work
      // because we explicitly set FONTCONFIG_FILE pointing to our fonts.conf
    }

    if (installed > 0) {
      console.log(`[Startup] Installed ${installed} font(s) to ${userFontsDir} (user-space, no sudo needed)`);
    } else {
      console.log("[Startup] Fonts already in place — fontconfig configured");
    }
    console.log(`[Startup] FONTCONFIG_FILE=${process.env.FONTCONFIG_FILE}`);
    console.log(`[Startup] Font directories: ${fontsDir}, ${userFontsDir}`);

    // Verify fonts are accessible
    try {
      const { stdout } = await execFileAsync("fc-list", [":", "family"], { encoding: "utf-8", timeout: 5_000 });
      const antonMatch = stdout.split("\n").filter((l: string) => /anton|oswald/i.test(l));
      console.log(`[Startup] Fontconfig sees: ${antonMatch.length > 0 ? antonMatch.join(", ") : "no Anton/Oswald found — check fonts.conf"}`);
    } catch {
      console.log("[Startup] fc-list not available — fonts.conf written, should work when Sharp loads");
    }
  } catch (e: any) {
    console.warn("[Startup] Font installation failed:", e?.message);
  }
}

async function startServer() {
  // ── Create database tables if they don't exist ──
  await migrateDatabase();

  // ── Seed static assets into uploads volume ──
  try {
    const fs = await import("fs");
    const uploadsDir = process.env.UPLOADS_DIR || "./public/uploads";
    const ctaDest = path.resolve(uploadsDir, "cta/sales-slide.png");
    if (!fs.existsSync(ctaDest)) {
      const ctaSrc = path.resolve("./public/uploads/cta/sales-slide.png");
      if (fs.existsSync(ctaSrc)) {
        fs.mkdirSync(path.dirname(ctaDest), { recursive: true });
        fs.copyFileSync(ctaSrc, ctaDest);
        console.log("[Startup] Seeded CTA slide to uploads volume");
      }
    }
  } catch (e) { console.warn("[Startup] CTA seed skipped:", e); }

  // ── Install fonts for SVG fallback path (Sharp/librsvg text rendering) ──
  // Primary rendering uses HTML/CSS via headless Chromium + Google Fonts CDN.
  // This fontconfig setup is still needed when Chromium is unavailable and we
  // fall back to SVG text overlays rendered by Sharp's librsvg.
  await installFonts();

  // ── Ghost-run recovery: fail any runs left in-flight from a previous server crash ──
  try {
    const postgres = await import("postgres");
    const sql = postgres.default(process.env.DATABASE_URL!);
    // Mark all in-flight runs as failed
    // Valid enum: pending, discovering, scoring, researching, generating, assembling, review, pending_post, posting, completed, failed
    // IMPORTANT: pending_post and posting are STABLE states (pipeline finished, waiting for admin approval / actively posting)
    // They must NOT be marked as failed — only truly in-flight stages should be recovered.
    const result = await sql`
      UPDATE content_runs SET status = 'failed'
      WHERE status NOT IN ('completed','failed','review','pending','pending_post','posting')
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
    // Also recover orphaned avatar_runs stuck in non-terminal states
    // Valid terminal states: video_review, completed, failed, cancelled
    // All other states mean the pipeline was in-flight when the server restarted
    const avatarResult = await sql`
      UPDATE avatar_runs
      SET status = 'failed',
          "statusDetail" = 'Server restarted while pipeline was running',
          "errorMessage" = 'Orphaned by server restart — please re-run',
          "updatedAt" = NOW()
      WHERE status NOT IN ('video_review','completed','failed','cancelled','topic_review')
    `;
    if (Number(avatarResult.count) > 0) {
      console.log(`[Startup] Auto-failed ${avatarResult.count} orphaned avatar run(s)`);
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
    console.log(`[Startup] Server running on http://localhost:${port}/ — build ${new Date().toISOString()}`);
  });
}

startServer().catch(console.error);
