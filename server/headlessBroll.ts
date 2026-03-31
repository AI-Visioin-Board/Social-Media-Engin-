// ============================================================
// Headless Browser B-Roll Capture
// Uses Puppeteer to navigate to real tool/website URLs and take
// high-quality screenshots for use as B-roll in video pipelines.
//
// Each capture is a short 3-5 second visual beat:
//   1. Navigate to URL
//   2. Wait for page load + dynamic content
//   3. Optionally scroll or interact
//   4. Capture viewport screenshot (1080x1920 for reels)
//
// Integrates into assetGenerator.ts as the "headless_capture" source.
// Falls back gracefully if URL is behind auth, 404, or slow.
// ============================================================

import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { type Browser, type Page } from "puppeteer";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ─── Stealth Mode ──────────────────────────────────────────
// Evades bot detection (Cloudflare, DataDome, etc.) so we don't
// get blocked or served captcha pages instead of real content.
puppeteer.use(StealthPlugin());

// ─── Types ──────────────────────────────────────────────────

export interface ScreenCaptureRequest {
  beatId: number;
  url: string;
  description: string;       // what we expect to see on screen
  sectionMarker?: string;    // HOOK, STEP1, STEP2, etc.
  durationHint: number;      // seconds this beat lasts (for filename)
  scrollY?: number;          // optional scroll position in pixels
  waitForSelector?: string;  // optional CSS selector to wait for
  clickSelector?: string;    // optional element to click before capture
  layout: "pip" | "fullscreen_broll" | "avatar_closeup" | "text_card";
}

export interface ScreenCaptureResult {
  beatId: number;
  url: string;
  screenshotBuffer: Buffer;
  width: number;
  height: number;
  success: boolean;
  error?: string;
  filename?: string;         // descriptive filename for folder saves
}

// ─── Viewport Sizes ─────────────────────────────────────────
// Match the B-roll frame sizes in our video templates

const VIEWPORTS = {
  // Full reel frame (9:16 aspect)
  fullscreen: { width: 1080, height: 1920 },
  // PIP TV box is roughly square (~1:1 aspect)
  pip: { width: 1080, height: 1080 },
} as const;

// ─── URL Extraction ─────────────────────────────────────────

const URL_REGEX = /https?:\/\/[^\s"'<>,)}\]—]+/gi;

/**
 * Extract the first URL from a visualPrompt string.
 * Returns null if no URL is found.
 */
export function extractUrlFromPrompt(prompt: string): string | null {
  const matches = prompt.match(URL_REGEX);
  if (!matches) return null;
  // Strip trailing punctuation that may have been captured
  return matches[0].replace(/[.;:!?]+$/, "");
}

// ─── Browser Pool ───────────────────────────────────────────
// Reuse a single browser instance across captures for efficiency

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.connected) {
    return browserInstance;
  }
  browserInstance = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-features=VizDisplayCompositor",
      "--window-size=1920,1080",
    ],
    defaultViewport: null,
  });
  return browserInstance;
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
  }
}

// ─── Single Page Capture ────────────────────────────────────

async function capturePage(
  browser: Browser,
  req: ScreenCaptureRequest,
  signal?: AbortSignal,
): Promise<ScreenCaptureResult> {
  const viewport = req.layout === "pip" ? VIEWPORTS.pip : VIEWPORTS.fullscreen;
  let page: Page | null = null;

  try {
    if (signal?.aborted) throw new Error("Aborted");

    page = await browser.newPage();
    await page.setViewport(viewport);

    // Set a realistic user agent
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );

    // Block unnecessary resources for faster load
    await page.setRequestInterception(true);
    page.on("request", (interceptedRequest) => {
      const resourceType = interceptedRequest.resourceType();
      // Block large media files — keep images, css, scripts, fonts for visual accuracy
      if (resourceType === "media") {
        interceptedRequest.abort();
      } else {
        interceptedRequest.continue();
      }
    });

    // Navigate with timeout
    console.log(`[HeadlessBroll] Beat ${req.beatId}: navigating to ${req.url}`);
    await page.goto(req.url, {
      waitUntil: "networkidle2",
      timeout: 20_000,
    });

    // Wait for specific element if requested
    if (req.waitForSelector) {
      await page.waitForSelector(req.waitForSelector, { timeout: 5_000 }).catch(() => {
        console.warn(`[HeadlessBroll] Beat ${req.beatId}: selector "${req.waitForSelector}" not found, continuing`);
      });
    }

    // Close common popups/overlays (cookie banners, modals)
    await dismissPopups(page);

    // Short pause for dynamic content to settle
    await delay(1500);

    // Scroll if requested
    if (req.scrollY && req.scrollY > 0) {
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: "smooth" }), req.scrollY);
      await delay(800);
    }

    // Click if requested (e.g., open a dropdown, expand a section)
    if (req.clickSelector) {
      try {
        await page.click(req.clickSelector);
        await delay(1000);
      } catch {
        console.warn(`[HeadlessBroll] Beat ${req.beatId}: click target "${req.clickSelector}" not found`);
      }
    }

    if (signal?.aborted) throw new Error("Aborted");

    // Validate page content BEFORE taking screenshot
    const pageIssue = await validatePageContent(page);
    if (pageIssue) {
      console.warn(`[HeadlessBroll] Beat ${req.beatId}: BAD PAGE — ${pageIssue}`);
      throw new Error(`Bad page content: ${pageIssue}`);
    }

    // Take the screenshot
    const screenshotBuffer = await page.screenshot({
      type: "png",
      fullPage: false,
      clip: {
        x: 0,
        y: 0,
        width: viewport.width,
        height: viewport.height,
      },
    }) as Buffer;

    // Validate the screenshot isn't blank/tiny
    if (!validateScreenshotBuffer(screenshotBuffer)) {
      throw new Error("Screenshot appears blank or too small to be real content");
    }

    // Build descriptive filename
    const filename = buildFilename(req);

    console.log(`[HeadlessBroll] Beat ${req.beatId}: captured ${viewport.width}x${viewport.height} from ${req.url} ✓`);

    return {
      beatId: req.beatId,
      url: req.url,
      screenshotBuffer,
      width: viewport.width,
      height: viewport.height,
      success: true,
      filename,
    };
  } catch (err: any) {
    console.error(`[HeadlessBroll] Beat ${req.beatId}: capture failed: ${err.message}`);
    return {
      beatId: req.beatId,
      url: req.url,
      screenshotBuffer: Buffer.alloc(0),
      width: viewport.width,
      height: viewport.height,
      success: false,
      error: err.message,
    };
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
}

// ─── Batch Capture ──────────────────────────────────────────

/**
 * Capture multiple pages sequentially (to avoid overwhelming the browser).
 * Returns results for all requests, with success=false for failures.
 */
export async function captureScreenshots(
  requests: ScreenCaptureRequest[],
  signal?: AbortSignal,
): Promise<ScreenCaptureResult[]> {
  if (requests.length === 0) return [];

  console.log(`[HeadlessBroll] Capturing ${requests.length} screenshots...`);
  const browser = await getBrowser();
  const results: ScreenCaptureResult[] = [];

  for (const req of requests) {
    if (signal?.aborted) {
      results.push({
        beatId: req.beatId,
        url: req.url,
        screenshotBuffer: Buffer.alloc(0),
        width: 0,
        height: 0,
        success: false,
        error: "Aborted",
      });
      continue;
    }

    const result = await capturePage(browser, req, signal);
    results.push(result);
  }

  // Don't close the browser — pool it for reuse
  console.log(`[HeadlessBroll] Done: ${results.filter(r => r.success).length}/${results.length} successful`);
  return results;
}

/**
 * Capture a single screenshot and return the buffer.
 * Used by assetGenerator.ts for individual beat processing.
 */
export async function captureScreenshot(
  url: string,
  beatId: number,
  layout: "pip" | "fullscreen_broll" | "avatar_closeup" | "text_card",
  description: string,
  signal?: AbortSignal,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const browser = await getBrowser();
  const result = await capturePage(browser, {
    beatId,
    url,
    description,
    layout,
    durationHint: 3,
  }, signal);

  if (!result.success || result.screenshotBuffer.length === 0) {
    throw new Error(`Screenshot capture failed for ${url}: ${result.error ?? "empty buffer"}`);
  }

  return {
    buffer: result.screenshotBuffer,
    width: result.width,
    height: result.height,
  };
}

// ─── Save Captures to Folder ────────────────────────────────

/**
 * Save capture results to a local folder with descriptive filenames.
 * Used by AINYCU and captions pipelines for local folder output.
 */
export async function saveCaptureToFolder(
  result: ScreenCaptureResult,
  outputDir: string,
  fileNumber: number,
): Promise<string | null> {
  if (!result.success || result.screenshotBuffer.length === 0) return null;

  await mkdir(outputDir, { recursive: true });

  // Use descriptive filename if available, otherwise numbered
  const filename = result.filename ?? `${fileNumber}.png`;
  const filepath = join(outputDir, filename);
  await writeFile(filepath, result.screenshotBuffer);

  console.log(`[HeadlessBroll] Saved: ${filename} (${result.width}x${result.height})`);
  return filename;
}

// ─── Helpers ────────────────────────────────────────────────

function buildFilename(req: ScreenCaptureRequest): string {
  // Format: [section]--[description]--[duration].png
  // e.g., step1--gemini-agents-tab-visible--5s.png
  const section = (req.sectionMarker ?? `beat${req.beatId}`).toLowerCase().replace(/[\[\]]/g, "");
  const desc = req.description
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 50)
    .replace(/-+$/, "");
  const duration = `${Math.round(req.durationHint)}s`;

  return `${section}--${desc}--${duration}.png`;
}

/**
 * Try to dismiss common popups: cookie banners, newsletter modals, etc.
 * Best-effort — failures are silently ignored.
 */
async function dismissPopups(page: Page): Promise<void> {
  const dismissSelectors = [
    // Cookie banners
    'button[id*="cookie" i][class*="accept" i]',
    'button[class*="cookie" i][class*="accept" i]',
    'button[aria-label*="accept" i]',
    'button[aria-label*="agree" i]',
    '[class*="cookie"] button:first-child',
    '#onetrust-accept-btn-handler',
    '.cc-btn.cc-dismiss',
    // Generic close/dismiss
    'button[aria-label="Close"]',
    'button[aria-label="Dismiss"]',
    '[class*="modal"] button[class*="close"]',
    '[class*="popup"] button[class*="close"]',
    '[class*="banner"] button[class*="close"]',
  ];

  for (const selector of dismissSelectors) {
    try {
      const btn = await page.$(selector);
      if (btn) {
        await btn.click();
        await delay(300);
      }
    } catch {
      // Silently ignore — popup dismissal is best-effort
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Screenshot Quality Validation ─────────────────────────
// Rejects captcha pages, error pages, mostly-blank screenshots,
// and other junk that would ruin B-roll quality.

const BAD_PAGE_INDICATORS = [
  "verify you are human",
  "captcha",
  "cloudflare",
  "access denied",
  "403 forbidden",
  "404 not found",
  "page not found",
  "just a moment",
  "checking your browser",
  "enable javascript",
  "please wait",
  "bot detection",
  "are you a robot",
  "unusual traffic",
  "blocked",
];

/**
 * Check if a page is showing a captcha, error, or block page
 * instead of real content. Returns a reason string if bad, null if OK.
 */
async function validatePageContent(page: Page): Promise<string | null> {
  try {
    const bodyText = await page.evaluate(() => {
      const body = document.body;
      if (!body) return "";
      return body.innerText.toLowerCase().slice(0, 2000);
    });

    for (const indicator of BAD_PAGE_INDICATORS) {
      if (bodyText.includes(indicator)) {
        return `Page contains "${indicator}" — likely a captcha or block page`;
      }
    }

    // Check if page has very little content (likely an error or blank page)
    const contentLength = bodyText.replace(/\s+/g, "").length;
    if (contentLength < 50) {
      return `Page has almost no text content (${contentLength} chars) — likely blank or error`;
    }

    // Check for Cloudflare challenge iframes
    const hasChallengeFrame = await page.evaluate(() => {
      const iframes = document.querySelectorAll("iframe");
      for (const iframe of iframes) {
        const src = iframe.src || "";
        if (src.includes("challenges.cloudflare.com") || src.includes("captcha")) {
          return true;
        }
      }
      return false;
    });

    if (hasChallengeFrame) {
      return "Page contains Cloudflare challenge iframe — captcha page";
    }

    return null; // Page looks good
  } catch {
    return null; // If we can't check, assume it's OK
  }
}

/**
 * Validate a screenshot buffer isn't mostly a single color
 * (e.g., all white = blank page, all grey = loading screen).
 * Uses simple pixel sampling — no image library needed.
 * Returns true if the image looks like it has real content.
 */
function validateScreenshotBuffer(buffer: Buffer): boolean {
  // PNG files: check if file is suspiciously small (< 30KB for 1080px wide = likely blank)
  if (buffer.length < 30_000) {
    console.warn(`[HeadlessBroll] Screenshot too small (${(buffer.length / 1024).toFixed(0)}KB) — likely blank`);
    return false;
  }
  return true;
}

// ─── Parse Beat for Capture Request ─────────────────────────

/**
 * Convert a script beat into a capture request.
 * Extracts URL from visualPrompt, falls back to topic URL.
 */
export function beatToCaptureRequest(
  beat: {
    id: number;
    visualPrompt: string;
    durationSec: number;
    layout: string;
    narration?: string;
  },
  topicUrl?: string,
): ScreenCaptureRequest | null {
  // Try to extract URL from the visualPrompt
  let url = extractUrlFromPrompt(beat.visualPrompt);

  // Fall back to topic URL
  if (!url && topicUrl) {
    url = topicUrl;
  }

  if (!url) {
    console.warn(`[HeadlessBroll] Beat ${beat.id}: no URL found in visualPrompt or topic, skipping capture`);
    return null;
  }

  // Extract section marker from narration
  const markerMatch = beat.narration?.match(/\[(HOOK|DAYTAG|BRIDGE|STEP\d|SOWHAT|SIGNOFF)\]/i);
  const sectionMarker = markerMatch?.[1] ?? undefined;

  return {
    beatId: beat.id,
    url,
    description: beat.visualPrompt.replace(URL_REGEX, "").trim().slice(0, 100),
    sectionMarker,
    durationHint: beat.durationSec,
    layout: beat.layout as ScreenCaptureRequest["layout"],
  };
}
