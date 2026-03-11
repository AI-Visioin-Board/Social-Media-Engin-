/**
 * screenshot.ts
 *
 * Headless browser screenshot service using Puppeteer + @sparticuz/chromium.
 * Replaces the Sharp SVG text rendering approach with native HTML/CSS rendering.
 *
 * Why: Sharp is an image processor, not a layout engine. Using SVG strings for
 * typography, text wrapping, gradients, and drop shadows was fragile:
 * - Font rendering required base64 embedding hacks for containerized environments
 * - Text wrapping was manual character-count guessing (wrapText())
 * - Every element had hardcoded X/Y coordinates that broke if headlines changed length
 * - SVG template strings were massive and unreadable
 *
 * This module renders the same layouts as HTML/CSS in a headless browser and
 * captures a pixel-perfect 1080x1350 PNG screenshot. CSS handles:
 * - Font loading (Google Fonts, no base64 hacks)
 * - Text wrapping (native, automatic)
 * - Layout (Flexbox, no hardcoded coordinates)
 * - Gradients, shadows, border-radius (native CSS properties)
 */

import puppeteer, { type Browser, type Page } from "puppeteer-core";
import chromium from "@sparticuz/chromium";

// ─── Browser Singleton ──────────────────────────────────────────────────────
// Reuse a single Chromium instance across all slide captures to avoid the
// ~2-3s startup cost per slide. The browser is lazily initialized on first use.

let _browser: Browser | null = null;
let _browserLaunchPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.connected) return _browser;

  // Prevent multiple concurrent launches
  if (_browserLaunchPromise) return _browserLaunchPromise;

  _browserLaunchPromise = (async () => {
    console.log("[Screenshot] Launching headless Chromium...");
    const executablePath = await chromium.executablePath();

    const browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
      defaultViewport: { width: 1080, height: 1350 },
      executablePath,
      headless: true,
    });

    console.log("[Screenshot] Chromium launched successfully");
    _browser = browser;
    _browserLaunchPromise = null;

    // Auto-close on process exit
    const cleanup = () => {
      if (_browser) {
        _browser.close().catch(() => {});
        _browser = null;
      }
    };
    process.on("exit", cleanup);
    process.on("SIGTERM", cleanup);
    process.on("SIGINT", cleanup);

    return browser;
  })();

  return _browserLaunchPromise;
}

// ─── Core Capture Function ──────────────────────────────────────────────────

/**
 * Render an HTML string in a headless browser and capture it as a PNG buffer.
 *
 * @param html - Complete HTML document string (including <!DOCTYPE html>)
 * @param options.width - Viewport width (default: 1080)
 * @param options.height - Viewport height (default: 1350)
 * @param options.transparent - Capture with transparent background (for video overlays)
 * @returns PNG buffer of the rendered page
 */
export async function captureHtmlToImage(
  html: string,
  options?: {
    width?: number;
    height?: number;
    transparent?: boolean;
  }
): Promise<Buffer> {
  const width = options?.width ?? 1080;
  const height = options?.height ?? 1350;
  const transparent = options?.transparent ?? false;

  const browser = await getBrowser();
  let page: Page | null = null;

  try {
    page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });

    // Set the HTML content and wait for all resources (fonts, images) to load
    await page.setContent(html, {
      waitUntil: "networkidle0",
      timeout: 30_000,
    });

    // Additional wait for Google Fonts to fully render
    // document.fonts.ready resolves when all font face loading is complete
    await page.evaluate(() => document.fonts.ready);

    // Small safety delay for any CSS transitions/animations to settle
    await new Promise((r) => setTimeout(r, 200));

    // Capture the screenshot
    const buffer = await page.screenshot({
      type: "png",
      omitBackground: transparent,
      clip: { x: 0, y: 0, width, height },
    });

    return Buffer.from(buffer);
  } catch (err: any) {
    console.error(`[Screenshot] Capture failed: ${err?.message}`);
    throw err;
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
}

/**
 * Close the shared browser instance. Call during graceful shutdown.
 */
export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
    console.log("[Screenshot] Browser closed");
  }
}
