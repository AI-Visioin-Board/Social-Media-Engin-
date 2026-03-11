/**
 * sharpCompositor.ts
 *
 * Assembles @airesearches/@evolving.ai-style Instagram carousel slides.
 *
 * Architecture (post-Gemini upgrade):
 * - Content slides use HTML/CSS templates (htmlCompositor.ts) rendered via a headless
 *   browser (screenshot.ts) for pixel-perfect typography and Flexbox layout.
 * - Sharp is still used for: image preprocessing (resize, attention crop, color grading),
 *   cover template compositing (multi-layer freeform, triptych), and logo badge rendering.
 * - The old SVG string approach (buildContentOverlaySvg, buildCoverOverlaySvg) is kept
 *   as a FALLBACK if the headless browser is unavailable (e.g. Chromium not installed).
 *
 * Design spec (matching @airesearches 1.1M followers):
 * - Full-bleed background image (1080×1350 portrait, 4:5 ratio)
 * - Heavy dark gradient: starts at 45% height, fully black at bottom 30%
 * - Anton font (bold condensed, matching the @airesearches look)
 * - ALL-CAPS white headline, 1-2 key words highlighted in CYAN (#00E5FF)
 * - "SWIPE FOR MORE →" call-to-action at very bottom
 * - Small "SuggestedByGPT" watermark bottom-left
 * - For video slides: returns the original video URL unchanged (Instagram plays natively)
 */

import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";
import http from "http";
import os from "os";
import { storagePut, resolveLocalPath, isLocalUrl } from "./storage";

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Constants ────────────────────────────────────────────────────────────────

const SLIDE_W = 1080;
const SLIDE_H = 1350; // 4:5 Instagram portrait ratio

// Cyan accent color matching @airesearches
const CYAN = "#00E5FF";

// Font paths — bundled in server/fonts/
// In dev, fonts are at __dirname/fonts. In prod build (dist/), fonts are one level up at ../fonts.
const FONTS_DIR = [
  path.join(__dirname, "fonts"),
  path.join(__dirname, "..", "fonts"),
  path.join(__dirname, "..", "server", "fonts"),
].find(d => fs.existsSync(d)) || path.join(__dirname, "fonts");
const ANTON_FONT = path.join(FONTS_DIR, "Anton-Regular.ttf");
const OSWALD_FONT = path.join(FONTS_DIR, "Oswald-Bold.ttf");

// ─── Font Embedding ────────────────────────────────────────────────────────
// librsvg does NOT reliably find fonts via fontconfig on containerized deployments (Railway, Docker).
// The bulletproof fix: embed the font as a base64 data URI in every SVG's <style> block.
// This makes the SVG self-contained — no external font resolution needed.
let _antonBase64Cache: string | null = null;

function getAntonFontBase64(): string {
  if (_antonBase64Cache) return _antonBase64Cache;
  try {
    const fontPath = path.join(FONTS_DIR, "Anton-Regular.ttf");
    if (fs.existsSync(fontPath)) {
      _antonBase64Cache = fs.readFileSync(fontPath).toString("base64");
      console.log(`[SharpCompositor] Anton font loaded as base64 (${Math.round(_antonBase64Cache.length / 1024)}KB)`);
    } else {
      console.warn(`[SharpCompositor] Anton font not found at ${fontPath} — text will use fallback`);
      _antonBase64Cache = "";
    }
  } catch (e: any) {
    console.warn(`[SharpCompositor] Failed to load Anton font:`, e?.message);
    _antonBase64Cache = "";
  }
  return _antonBase64Cache;
}

function buildFontFaceCSS(): string {
  const b64 = getAntonFontBase64();
  if (!b64) return "";
  return `
    <style>
      @font-face {
        font-family: 'Anton';
        src: url('data:font/truetype;base64,${b64}') format('truetype');
        font-weight: normal;
        font-style: normal;
      }
    </style>`;
}

// ─── Circular Logo Renderer ──────────────────────────────────────────────────
// ALL logos are rendered as circular badges with a white glow border for:
// 1. Standardized shape — no more jarring square logos (Copilot, etc.)
// 2. Universal visibility — white glow ring ensures the logo is visible on ANY background
// 3. Professional aesthetic — matches @theaifield, @airesearches competitor style

async function renderCircularLogo(
  logoBuffer: Buffer,
  size: number,
  style: "full_color" | "badge",
): Promise<Buffer | null> {
  try {
    const OUTER = size;                        // full diameter of the final circle
    const GLOW_WIDTH = 5;                      // white glow ring thickness (was 3 — too faint on dark bgs)
    const INNER = OUTER - GLOW_WIDTH * 2;      // inner circle diameter
    const LOGO_PAD = style === "full_color" ? 0.10 : 0.15; // padding inside circle — tighter for bigger logos
    const LOGO_AREA = Math.round(INNER * (1 - LOGO_PAD * 2)); // logo fits within this box
    const R = OUTER / 2;                       // outer radius
    const RI = INNER / 2;                      // inner radius

    // 1. Resize the logo to fit inside the inner circle with padding
    const resized = await sharp(logoBuffer)
      .resize(LOGO_AREA, LOGO_AREA, { fit: "inside" })
      .png()
      .toBuffer();
    const meta = await sharp(resized).metadata();
    const lW = meta.width ?? LOGO_AREA;
    const lH = meta.height ?? LOGO_AREA;

    // 2. Build SVG with: outer glow ring + semi-transparent dark fill + circular clip for logo
    // Brighter fill + stronger glow ensures badges are visible on ANY background (dark or light)
    const bgFill = style === "full_color"
      ? "rgba(25, 25, 55, 0.85)"    // dark blue translucent — brighter than before for contrast
      : "rgba(20, 20, 45, 0.88)";   // slightly darker for badge mode

    const svgCanvas = `<svg width="${OUTER}" height="${OUTER}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="4" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
        <clipPath id="circClip">
          <circle cx="${R}" cy="${R}" r="${RI - 1}"/>
        </clipPath>
      </defs>
      <!-- White glow ring — brighter + thicker for visibility on dark backgrounds -->
      <circle cx="${R}" cy="${R}" r="${R - 1}" fill="none"
        stroke="rgba(255,255,255,0.85)" stroke-width="${GLOW_WIDTH}" filter="url(#glow)"/>
      <!-- Dark circular background -->
      <circle cx="${R}" cy="${R}" r="${RI}" fill="${bgFill}"/>
    </svg>`;

    const canvas = await sharp(Buffer.from(svgCanvas)).png().toBuffer();

    // 3. Composite the logo centered on the dark circle
    const logoLeft = Math.round((OUTER - lW) / 2);
    const logoTop = Math.round((OUTER - lH) / 2);

    // 4. Create a circular mask to clip the logo to the inner circle
    const maskSvg = `<svg width="${OUTER}" height="${OUTER}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${R}" cy="${R}" r="${RI - 1}" fill="white"/>
    </svg>`;
    const mask = await sharp(Buffer.from(maskSvg)).png().toBuffer();

    // Clip the logo to circle shape first
    const logoOnTransparent = await sharp({
      create: { width: OUTER, height: OUTER, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();

    const logoPlaced = await sharp(logoOnTransparent)
      .composite([{ input: resized, left: logoLeft, top: logoTop }])
      .png()
      .toBuffer();

    const logoClipped = await sharp(logoPlaced)
      .composite([{ input: mask, blend: "dest-in" }])
      .png()
      .toBuffer();

    // 5. Final composite: canvas (glow ring + dark bg) + clipped logo on top
    const final = await sharp(canvas)
      .composite([{ input: logoClipped, left: 0, top: 0 }])
      .png()
      .toBuffer();

    return final;
  } catch (err: any) {
    console.warn(`[SharpCompositor] renderCircularLogo failed: ${err?.message}`);
    return null;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SharpSlideInput {
  runId: number;
  slideIndex: number;
  headline: string;
  summary?: string;
  insightLine?: string;    // optional context sentence shown as chat bubble below headline
  mediaUrl: string | null; // S3/CDN URL of the Nano Banana image (or Kling video)
  isVideo?: boolean;       // if true, skip image assembly and return mediaUrl directly
  isCover?: boolean;

  // ── Cover template fields (only used when isCover=true) ──────────────────
  /** Which of the 8 cover templates to use for slide 0 */
  coverTemplate?: import('./creativeDirector').CoverTemplate;
  /** Pre-fetched + bg-removed primary person buffer */
  personBuffer?: Buffer | null;
  /** Pre-fetched + bg-removed additional person buffers (for multi-person templates) */
  additionalPersonBuffers?: Array<Buffer | null>;
  /** Pre-fetched logo buffers in order */
  logoBuffers?: Array<Buffer | null>;
  /** For screenshot_overlay template: the captured/generated product screenshot (1080×742 PNG) */
  screenshotBuffer?: Buffer | null;

  // ── 2.0 fields: logo control ──
  /** Per-slide logo rendering style: full_color (large, brand colors), badge (dark circle), or none */
  logoStyle?: "full_color" | "badge" | "none";
  /** Logo size in pixels (80-200). Default: 100 for badge, 140 for full_color */
  logoSize?: number;

  // ── 2.0 fields: freeform composition manifest ──
  /** Composition manifest from Creative Director (for freeform_composition covers) */
  coverComposition?: import('./coverTemplateCompositor').CoverTemplateInput["coverComposition"];
  /** Dedicated background buffer for multi-layer freeform covers (DALL-E 3 no-people scene) */
  dedicatedBackgroundBuffer?: Buffer | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Download a URL to a temp file and return the local path (with timeout + redirect limit). Handles local /uploads/ paths. */
async function downloadToTemp(url: string, ext: string): Promise<string> {
  // Handle local storage paths — just copy the file instead of HTTP request
  if (isLocalUrl(url)) {
    const localPath = resolveLocalPath(url);
    if (!localPath) throw new Error(`Local file not found: ${url}`);
    const tmpPath = path.join(os.tmpdir(), `sbgpt-sharp-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
    fs.copyFileSync(localPath, tmpPath);
    return tmpPath;
  }

  const tmpPath = path.join(os.tmpdir(), `sbgpt-sharp-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
  const DOWNLOAD_TIMEOUT_MS = 30_000; // 30s — images are typically small
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error(`Download timed out after 30s: ${url.slice(0, 80)}`)); }
    }, DOWNLOAD_TIMEOUT_MS);

    const doGet = (u: string, redirects = 0) => {
      if (redirects > 3) { clearTimeout(timer); reject(new Error("Too many redirects")); return; }
      const protocol = u.startsWith("https") ? https : http;
      const req = protocol.get(u, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doGet(res.headers.location, redirects + 1);
          return;
        }
        // Reject 4xx/5xx — the response body is an error page, not an image.
        // Without this check, error HTML gets written to disk and Sharp later
        // throws a cryptic "Input buffer contains unsupported image format".
        if (res.statusCode && res.statusCode >= 400) {
          clearTimeout(timer);
          if (!settled) { settled = true; reject(new Error(`HTTP ${res.statusCode} downloading: ${u.slice(0, 80)}`)); }
          res.resume(); // drain the response to free the socket
          return;
        }
        const file = fs.createWriteStream(tmpPath);
        file.on("finish", () => {
          file.close();
          clearTimeout(timer);
          if (!settled) { settled = true; resolve(tmpPath); }
        });
        file.on("error", (e) => { clearTimeout(timer); reject(e); });
      });
      req.on("error", (e) => { clearTimeout(timer); reject(e); });
      req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => { req.destroy(new Error("Socket timeout")); });
    };
    doGet(url);
  });
}

/** Wrap text into lines that fit within maxWidth characters. */
function wrapText(text: string, maxCharsPerLine: number): string[] {
  // Guard: never return empty array — empty text = empty slide (no visible headline)
  if (!text || text.trim().length === 0) {
    console.warn("[SharpCompositor] wrapText() received empty text — using placeholder");
    return ["BREAKING AI NEWS"];
  }
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length <= maxCharsPerLine) {
      current = (current + " " + word).trim();
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  // Double-check: never return empty
  if (lines.length === 0) lines.push("BREAKING AI NEWS");
  return lines;
}

/**
 * Identify which words/phrases to highlight in cyan.
 * Strategy: highlight the last 2-3 words of the headline (the "punchline")
 * OR any word that is a number, percentage, or a power word.
 */
function getHighlightedWords(headline: string): Set<string> {
  const upper = headline.toUpperCase();
  const words = upper.split(" ");
  const highlighted = new Set<string>();

  // Power words that should be highlighted
  const powerWords = new Set([
    "ILLEGAL", "SECRET", "BANNED", "EXPOSED", "LEAKED", "SHOCKING",
    "INSANE", "WILD", "MASSIVE", "BIGGEST", "WORST", "BEST", "FIRST",
    "NEVER", "ALWAYS", "EVERY", "ALL", "ZERO", "100%", "99%", "95%",
    "DEAD", "ALIVE", "DANGEROUS", "POWERFUL", "REVOLUTIONARY", "HISTORIC",
    "UNPRECEDENTED", "BREAKING", "URGENT", "CRITICAL", "EXTREME",
    "DESTROYED", "REPLACED", "ELIMINATED", "SURPASSED", "DEFEATED",
    "GOD", "GENIUS", "PERFECT", "IMPOSSIBLE", "UNSTOPPABLE",
  ]);

  // Highlight power words
  for (const word of words) {
    const clean = word.replace(/[^A-Z0-9%]/g, "");
    if (powerWords.has(clean)) {
      highlighted.add(word);
    }
    // Highlight percentages and large numbers
    if (/^\d+(\.\d+)?%$/.test(clean) || /^\d{2,}$/.test(clean)) {
      highlighted.add(word);
    }
  }

  // If nothing highlighted, highlight the last 2 words (the punchline)
  if (highlighted.size === 0 && words.length >= 3) {
    highlighted.add(words[words.length - 1]);
    highlighted.add(words[words.length - 2]);
  }

  return highlighted;
}

/**
 * Build SVG tspan elements for a line, with cyan highlighting on certain words.
 * Returns SVG tspan content for a <text> element.
 */
function buildHighlightedLine(
  line: string,
  highlightedWords: Set<string>,
  fontSize: number,
  fontFamily: string,
  yPos: number,
  xCenter: number
): string {
  const words = line.split(" ");
  const hasHighlight = words.some(w => highlightedWords.has(w));

  if (!hasHighlight) {
    // Plain white line
    return `<tspan x="${xCenter}" y="${yPos}" fill="white">${escapeXml(line)}</tspan>`;
  }

  // Build word-by-word with color switching
  // Use xml:space="preserve" on the parent text element and include literal spaces
  const parts: string[] = [];
  words.forEach((word, i) => {
    const color = highlightedWords.has(word) ? CYAN : "white";
    if (i === 0) {
      parts.push(`<tspan fill="${color}">${escapeXml(word)}</tspan>`);
    } else {
      // Encode space as &#x20; which SVG renderers preserve
      parts.push(`<tspan fill="white">&#x20;</tspan><tspan fill="${color}">${escapeXml(word)}</tspan>`);
    }
  });

  return `<tspan x="${xCenter}" y="${yPos}" xml:space="preserve">${parts.join("")}</tspan>`;
}

/** Build the full SVG overlay for content slides: split-zone layout matching @airesearches style.
 *  Top 50% = image zone (gradient transition into solid dark)
 *  Thin divider line + "SuggestedByGPT" brand mark
 *  Bottom 50% = dark headline zone with ALL-CAPS cyan-highlighted text
 *  "SWIPE FOR MORE" at the very bottom
 */
function buildContentOverlaySvg(
  headline: string,
  font: { path: string; name: string },
  insightLine?: string,
  summary?: string
): string {
  const safeHeadline = (headline && headline.trim().length > 0) ? headline : "BREAKING AI NEWS";
  const upper = safeHeadline.toUpperCase();

  // ── Split-zone constants (50/50 split) ──
  const IMAGE_ZONE_H = 675;  // 50% of 1350 — hero image fills this
  const TEXT_ZONE_TOP = IMAGE_ZONE_H; // y=675 — where dark zone begins
  const DIVIDER_Y = TEXT_ZONE_TOP + 15;
  const BRAND_Y = DIVIDER_Y + 24;
  const HEADLINE_START_Y = BRAND_Y + 32;

  // Headline text sizing
  const lines = wrapText(upper, 20); // tighter wrap for dramatic @airesearches style
  const hasSummary = summary && summary.trim().length > 10;
  let fontSize: number;
  if (hasSummary) {
    fontSize = lines.length <= 2 ? 82 : lines.length <= 3 ? 70 : 60;
  } else {
    fontSize = lines.length <= 2 ? 90 : lines.length <= 3 ? 76 : 66;
  }
  const lineHeight = fontSize * 1.12;

  const highlightedWords = getHighlightedWords(upper);
  const fontFamily = `Anton, Impact, 'Arial Black', sans-serif`;

  // Build headline tspans
  const textLines = lines.map((line, i) => {
    const y = HEADLINE_START_Y + i * lineHeight + fontSize;
    return buildHighlightedLine(line, highlightedWords, fontSize, fontFamily, y, SLIDE_W / 2);
  }).join("\n    ");

  const shadowLines = lines.map((line, i) => {
    const y = HEADLINE_START_Y + i * lineHeight + fontSize;
    return `<tspan x="${SLIDE_W / 2}" y="${y}">${escapeXml(line)}</tspan>`;
  }).join("\n    ");

  // ── Summary text (below headline) ──
  let summarySvg = "";
  let summaryBlockHeight = 0;
  if (hasSummary) {
    const summaryFontSize = 28;
    const summaryLineH = summaryFontSize + 8;

    // ── Bounds check: summary must NOT overflow into SWIPE FOR MORE ──
    const lastHeadlineY = HEADLINE_START_Y + (lines.length - 1) * lineHeight + fontSize;
    const summaryStartY = lastHeadlineY + 16;
    const swipeSafeY = SLIDE_H - 80; // must not place text below this
    const maxSummaryLines = Math.max(1, Math.floor((swipeSafeY - summaryStartY) / summaryLineH));
    const lineLimit = Math.min(maxSummaryLines, 6);

    // ── Complete sentence logic: NEVER cut mid-sentence ──
    // Split summary into sentences, accumulate until we'd exceed the line limit.
    const fullText = summary!.trim();
    const sentences = fullText.match(/[^.!?]*[.!?]+/g) || [fullText];
    let fittingText = "";
    for (const sentence of sentences) {
      const candidate = (fittingText + sentence).trim();
      const candidateWrapped = wrapText(candidate, 44);
      if (candidateWrapped.length <= lineLimit) {
        fittingText = candidate;
      } else {
        break;
      }
    }
    // If even one sentence didn't fit, use the first sentence anyway
    if (!fittingText.trim()) {
      fittingText = sentences[0] || fullText;
    }
    // Hard safety cap: if fittingText (e.g. from no-punctuation summary) still
    // exceeds the line limit, truncate to the max number of wrapped lines.
    const safetyWrapped = wrapText(fittingText.trim(), 44);
    if (safetyWrapped.length > lineLimit) {
      fittingText = safetyWrapped.slice(0, lineLimit).join(" ");
    }
    // Ensure it ends with punctuation (complete sentence)
    fittingText = fittingText.trim();
    if (!/[.!?]$/.test(fittingText)) {
      fittingText += ".";
    }
    let summaryWrapped = wrapText(fittingText, 44);
    summaryBlockHeight = 16 + summaryWrapped.length * summaryLineH;
    const summaryTextLines = summaryWrapped.map((line, i) =>
      `<tspan x="${SLIDE_W / 2}" y="${summaryStartY + (i + 1) * summaryLineH}">${escapeXml(line)}</tspan>`
    ).join("\n    ");

    summarySvg = `
  <text font-family="'Arial', 'Helvetica', sans-serif" font-size="${summaryFontSize}"
    fill="white" fill-opacity="0.80" text-anchor="middle" font-weight="400">
    ${summaryTextLines}
  </text>`;
  }

  // ── Insight bubble (below summary or headline) ──
  let insightBubbleSvg = "";
  if (insightLine && insightLine.trim().length > 3) {
    const insightWrapped = wrapText(insightLine.trim(), 42);
    const iFontSize = 26;
    const iLineH = iFontSize + 8;
    const iPad = 14;
    const iBubbleW = Math.min(SLIDE_W - 80, 680);
    const iBubbleH = insightWrapped.length * iLineH + iPad * 2;
    const iBubbleX = (SLIDE_W - iBubbleW) / 2;

    const lastContentY = HEADLINE_START_Y + (lines.length - 1) * lineHeight + fontSize + summaryBlockHeight;
    const iBubbleY = lastContentY + 20;
    const iTailSize = 10;

    const iTextLines = insightWrapped.map((line, i) =>
      `<text x="${SLIDE_W / 2}" y="${iBubbleY + iPad + (i + 1) * iLineH - 4}" font-family="'Arial', sans-serif" font-size="${iFontSize}" fill="#0a0a0a" text-anchor="middle" font-weight="600">${escapeXml(line)}</text>`
    ).join("\n    ");

    if (iBubbleY + iBubbleH < SLIDE_H - 80) {
      insightBubbleSvg = `
  <polygon points="${SLIDE_W / 2 - iTailSize},${iBubbleY} ${SLIDE_W / 2 + iTailSize},${iBubbleY} ${SLIDE_W / 2},${iBubbleY - iTailSize * 1.5}" fill="white" fill-opacity="0.90"/>
  <rect x="${iBubbleX}" y="${iBubbleY}" width="${iBubbleW}" height="${iBubbleH}" rx="12" ry="12" fill="white" fill-opacity="0.90"/>
  ${iTextLines}`;
    }
  }

  const fontFace = buildFontFaceCSS();

  // Build the SVG with split-zone layout
  return `<svg width="${SLIDE_W}" height="${SLIDE_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    ${fontFace}
    <linearGradient id="splitFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="black" stop-opacity="0"/>
      <stop offset="50%" stop-color="black" stop-opacity="0.70"/>
      <stop offset="100%" stop-color="black" stop-opacity="1"/>
    </linearGradient>
  </defs>

  <!-- Gradient transition from image zone into dark zone -->
  <rect x="0" y="${IMAGE_ZONE_H - 160}" width="${SLIDE_W}" height="160" fill="url(#splitFade)"/>
  <!-- Solid dark zone: bottom 50% -->
  <rect x="0" y="${TEXT_ZONE_TOP}" width="${SLIDE_W}" height="${SLIDE_H - TEXT_ZONE_TOP}" fill="black"/>

  <!-- Thin divider line — @airesearches signature element -->
  <line x1="60" y1="${DIVIDER_Y}" x2="${SLIDE_W - 60}" y2="${DIVIDER_Y}" stroke="white" stroke-opacity="0.25" stroke-width="1"/>

  <!-- Brand mark centered below divider -->
  <text x="${SLIDE_W / 2}" y="${BRAND_Y}" font-family="Arial, sans-serif" font-size="20" fill="white" fill-opacity="0.50" text-anchor="middle" letter-spacing="3" font-weight="bold">SUGGESTEDBYGPT</text>

  <!-- Drop shadow for headline -->
  <text font-family="${fontFamily}" font-size="${fontSize}" font-weight="bold"
    fill="black" fill-opacity="0.5" text-anchor="middle" letter-spacing="1" transform="translate(3,3)">
    ${shadowLines}
  </text>

  <!-- Headline with cyan highlights -->
  <text font-family="${fontFamily}" font-size="${fontSize}" font-weight="bold"
    text-anchor="middle" letter-spacing="1">
    ${textLines}
  </text>

  ${summarySvg}
  ${insightBubbleSvg}

  <!-- Swipe hint — safely within Instagram's visible crop area -->
  <text x="${SLIDE_W / 2}" y="${SLIDE_H - 55}" font-family="'Arial', sans-serif" font-size="26" fill="white" fill-opacity="0.70" text-anchor="middle" letter-spacing="4" font-weight="bold">SWIPE FOR MORE ›</text>
</svg>`;
}

/** Build the full SVG overlay for cover slides: simple gradient + large headline (legacy fallback when no cover template is set) */
function buildCoverOverlaySvg(
  headline: string,
  font: { path: string; name: string },
): string {
  const safeHeadline = (headline && headline.trim().length > 0) ? headline : "BREAKING AI NEWS";
  const upper = safeHeadline.toUpperCase();
  const lines = wrapText(upper, 16);
  const fontSize = lines.length <= 2 ? 108 : lines.length <= 3 ? 90 : 76;
  const lineHeight = fontSize * 1.15;
  const totalTextHeight = lines.length * lineHeight;
  const textBlockBottom = SLIDE_H - 180;
  const textStartY = textBlockBottom - totalTextHeight;

  const highlightedWords = getHighlightedWords(upper);
  const fontFamily = `Anton, Impact, 'Arial Black', sans-serif`;

  const textLines = lines.map((line, i) => {
    const y = textStartY + i * lineHeight + fontSize;
    return buildHighlightedLine(line, highlightedWords, fontSize, fontFamily, y, SLIDE_W / 2);
  }).join("\n    ");

  const shadowLines = lines.map((line, i) => {
    const y = textStartY + i * lineHeight + fontSize;
    return `<tspan x="${SLIDE_W / 2}" y="${y}">${escapeXml(line)}</tspan>`;
  }).join("\n    ");

  const fontFace = buildFontFaceCSS();

  return `<svg width="${SLIDE_W}" height="${SLIDE_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    ${fontFace}
    <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="black" stop-opacity="0"/>
      <stop offset="25%"  stop-color="black" stop-opacity="0"/>
      <stop offset="40%"  stop-color="black" stop-opacity="0.45"/>
      <stop offset="55%"  stop-color="black" stop-opacity="0.78"/>
      <stop offset="70%"  stop-color="black" stop-opacity="0.92"/>
      <stop offset="100%" stop-color="black" stop-opacity="0.98"/>
    </linearGradient>
  </defs>
  <rect x="0" y="${SLIDE_H * 0.25}" width="${SLIDE_W}" height="${SLIDE_H * 0.75}" fill="url(#grad)"/>
  <text font-family="${fontFamily}" font-size="${fontSize}" font-weight="bold"
    fill="black" fill-opacity="0.5" text-anchor="middle" letter-spacing="1" transform="translate(4,4)">
    ${shadowLines}
  </text>
  <text font-family="${fontFamily}" font-size="${fontSize}" font-weight="bold"
    text-anchor="middle" letter-spacing="1">
    ${textLines}
  </text>
  <text x="52" y="${SLIDE_H - 88}" font-family="'Arial', sans-serif" font-size="26" fill="white" fill-opacity="0.6" font-weight="bold" letter-spacing="1">SuggestedByGPT</text>
  <text x="${SLIDE_W / 2}" y="${SLIDE_H - 62}" font-family="'Arial', sans-serif" font-size="30" fill="white" fill-opacity="0.75" text-anchor="middle" letter-spacing="5">SWIPE FOR MORE ›</text>
</svg>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ─── Core: assemble one image slide ──────────────────────────────────────────

/**
 * Assemble a single image slide using Sharp.
 * Downloads the background image, composites the gradient+text SVG overlay,
 * uploads the result to S3, and returns the public CDN URL.
 *
 * For video slides (isVideo=true), returns the original mediaUrl unchanged.
 */
export async function assembleSlideWithSharp(
  slide: SharpSlideInput
): Promise<string | null> {
  const { runId, slideIndex, headline, mediaUrl, isVideo = false, isCover = false } = slide;

  console.log(`[SharpCompositor] Assembling slide ${slideIndex} (${isVideo ? "video pass-through" : "image composite"})...`);

  // ── Video slides: composite with new layout (top 70% video + black bottom 30% + text) ──
  if (isVideo && mediaUrl) {
    try {
      console.log(`[SharpCompositor] Video slide — compositing with VideoCompositor...`);
      const { compositeVideoSlide } = await import("./videoCompositor");
      const composedUrl = await compositeVideoSlide({
        runId,
        slideIndex,
        videoUrl: mediaUrl,
        headline,
        summary: slide.summary,
        insightLine: slide.insightLine,
      });
      return composedUrl;
    } catch (err: any) {
      console.warn(`[SharpCompositor] Video compositor failed (${err?.message}), falling back to pass-through`);
      return mediaUrl; // fallback: return raw video
    }
  }

  // ── Image slides: download + composite + upload ────────────────────────────
  let bgImageBuffer: Buffer | null = null;

  if (mediaUrl) {
    try {
      const ext = mediaUrl.includes(".jpg") ? "jpg" : "png";
      const tmpFile = await downloadToTemp(mediaUrl, ext);
      bgImageBuffer = fs.readFileSync(tmpFile);
      fs.unlink(tmpFile, () => {});
      console.log(`[SharpCompositor] Background image downloaded (${bgImageBuffer.length} bytes)`);
    } catch (err: any) {
      console.warn(`[SharpCompositor] Failed to download background image: ${err?.message} — using solid color fallback`);
    }
  }

  // ── Cover slide: route to cover template compositor ─────────────────────
  if (isCover && slide.coverTemplate) {
    try {
      console.log(`[SharpCompositor] Cover slide — routing to template: ${slide.coverTemplate}`);
      const { composeCoverTemplate } = await import("./coverTemplateCompositor");
      // For multi-layer freeform covers, use the dedicated DALL-E 3 background
      // (not the mediaUrl download which may be a person image)
      const coverBgBuffer = slide.dedicatedBackgroundBuffer ?? bgImageBuffer;
      const coverBuffer = await composeCoverTemplate({
        template: slide.coverTemplate,
        backgroundBuffer: coverBgBuffer,
        headline,
        mainPersonBuffer: slide.personBuffer ?? undefined,
        supportingPersonBuffers: (slide.additionalPersonBuffers ?? []).filter(Boolean) as Buffer[],
        logoBuffers: (slide.logoBuffers ?? []).filter(Boolean) as Buffer[],
        screenshotBuffer: slide.screenshotBuffer ?? undefined,
        coverComposition: slide.coverComposition ?? undefined,
      });
      const s3Key = `sharp-slides/run-${runId}-cover-${slide.coverTemplate}-${Date.now()}.png`;
      const { url } = await storagePut(s3Key, coverBuffer, "image/png");
      console.log(`[SharpCompositor] Cover (${slide.coverTemplate}) uploaded → ${url.slice(0, 80)}...`);
      return url;
    } catch (err: any) {
      console.warn(`[SharpCompositor] Cover template compositor failed (${err?.message}) — falling back to generic overlay`);
      // Fall through to generic overlay below
    }
  }

  // ── Content slides: HTML/CSS compositor (primary) with SVG fallback ─────
  // The HTML approach uses a headless browser for pixel-perfect typography,
  // automatic text wrapping, and CSS Flexbox layout. If Chromium is unavailable,
  // we fall back to the legacy SVG overlay approach.

  try {
    // ── Step 1: Prepare background image with Sharp ──
    // Sharp is still the right tool for: resize, attention crop, color grading.
    // We prep the image here, then pass it to the HTML compositor as a buffer.
    let preparedBgBuffer: Buffer | null = null;

    if (bgImageBuffer) {
      if (!isCover) {
        // Content slides: center image in the VISIBLE top zone (675px)
        const IMAGE_ZONE_H = 675;
        const topZone = await sharp(bgImageBuffer)
          .resize(SLIDE_W, IMAGE_ZONE_H, { fit: "cover", position: sharp.strategy.attention })
          .png()
          .toBuffer();
        // Place on full-height black canvas
        const canvas = await sharp({
          create: { width: SLIDE_W, height: SLIDE_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
        })
          .composite([{ input: topZone, left: 0, top: 0 }])
          .png()
          .toBuffer();
        preparedBgBuffer = canvas;
      } else {
        preparedBgBuffer = await sharp(bgImageBuffer)
          .resize(SLIDE_W, SLIDE_H, { fit: "cover", position: "center" })
          .png()
          .toBuffer();
      }
    }

    // ── Color grading: boost saturation and contrast for cinematic look ──
    if (preparedBgBuffer) {
      try {
        preparedBgBuffer = await sharp(preparedBgBuffer)
          .modulate({ brightness: 1.05, saturation: 1.25 })
          .linear(1.15, -(128 * 0.15))
          .sharpen({ sigma: 0.8 })
          .png()
          .toBuffer();
      } catch { /* color grading failed — use raw buffer */ }
    }

    // ── Step 2: Try HTML/CSS compositor (primary path) ──
    try {
      const { generateContentSlideHtml, generateCoverSlideHtml } = await import("./htmlCompositor");
      const { captureHtmlToImage } = await import("./screenshot");

      let html: string;
      if (isCover) {
        html = generateCoverSlideHtml({
          backgroundBuffer: preparedBgBuffer,
          headline,
          logoBuffers: slide.logoBuffers,
          logoStyle: slide.logoStyle,
          logoSize: slide.logoSize,
        });
      } else {
        html = generateContentSlideHtml({
          backgroundBuffer: preparedBgBuffer,
          headline,
          summary: slide.summary,
          insightLine: slide.insightLine,
          logoBuffers: slide.logoBuffers,
          logoStyle: slide.logoStyle,
          logoSize: slide.logoSize,
        });
      }

      const screenshotBuffer = await captureHtmlToImage(html);
      console.log(`[SharpCompositor] HTML compositor rendered slide ${slideIndex} (${Math.round(screenshotBuffer.length / 1024)}KB)`);

      // Upload to S3
      const s3Key = `sharp-slides/run-${runId}-slide-${slideIndex}-html-${Date.now()}.png`;
      const { url } = await storagePut(s3Key, screenshotBuffer, "image/png");
      console.log(`[SharpCompositor] Slide ${slideIndex} uploaded → ${url.slice(0, 80)}...`);
      return url;

    } catch (htmlErr: any) {
      console.warn(`[SharpCompositor] HTML compositor failed (${htmlErr?.message}) — falling back to SVG overlay`);
      // Fall through to legacy SVG approach
    }

    // ── Step 3: Legacy SVG fallback (if HTML compositor unavailable) ──
    const font = { path: "", name: "Anton" };
    const overlaySvg = isCover
      ? buildCoverOverlaySvg(headline, font)
      : buildContentOverlaySvg(headline, font, slide.insightLine, slide.summary);

    let baseBuffer: Buffer;
    if (preparedBgBuffer) {
      baseBuffer = preparedBgBuffer;
    } else {
      const fallbackSvg = `<svg width="${SLIDE_W}" height="${SLIDE_H}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#0a0a1a"/>
            <stop offset="50%" stop-color="#1a0a2e"/>
            <stop offset="100%" stop-color="#000000"/>
          </linearGradient>
        </defs>
        <rect width="${SLIDE_W}" height="${SLIDE_H}" fill="url(#bg)"/>
      </svg>`;
      baseBuffer = await sharp(Buffer.from(fallbackSvg)).png().toBuffer();
    }

    // Logo compositing (legacy Sharp approach)
    const logoComposites: sharp.OverlayOptions[] = [];
    const effectiveLogoStyle = slide.logoStyle ?? "full_color";
    if (!isCover && effectiveLogoStyle !== "none" && slide.logoBuffers && slide.logoBuffers.length > 0) {
      const validLogos = slide.logoBuffers.filter((b): b is Buffer => b !== null);
      const LOGO_ZONES = [
        { left: SLIDE_W - 160, top: 30 },
        { left: 20, top: 30 },
        { left: SLIDE_W - 150, top: 200 },
      ];
      const logoSizeDefault = effectiveLogoStyle === "full_color" ? 120 : 90;
      const LOGO_SIZE = slide.logoSize ?? logoSizeDefault;

      for (let i = 0; i < Math.min(validLogos.length, 3); i++) {
        try {
          const pos = LOGO_ZONES[i];
          const circledLogo = await renderCircularLogo(validLogos[i], LOGO_SIZE, effectiveLogoStyle);
          if (circledLogo) {
            logoComposites.push({ input: circledLogo, left: pos.left, top: pos.top });
          }
        } catch (logoErr: any) {
          console.warn(`[SharpCompositor] Logo compositing failed: ${logoErr?.message}`);
        }
      }
    }

    const composited = await sharp(baseBuffer)
      .composite([
        { input: Buffer.from(overlaySvg), top: 0, left: 0 },
        ...logoComposites,
      ])
      .png({ compressionLevel: 5 })
      .toBuffer();

    const s3Key = `sharp-slides/run-${runId}-slide-${slideIndex}-${Date.now()}.png`;
    const { url } = await storagePut(s3Key, composited, "image/png");
    console.log(`[SharpCompositor] Slide ${slideIndex} (SVG fallback) uploaded → ${url.slice(0, 80)}...`);
    return url;

  } catch (err: any) {
    console.error(`[SharpCompositor] Failed to assemble slide ${slideIndex}: ${err?.message}`);
    return null;
  }
}

// ─── Batch: assemble all slides for a run ────────────────────────────────────

export interface SharpAssemblyResult {
  slideIndex: number;
  url: string | null;
  isVideo: boolean;
}

/**
 * Assemble all slides for a run in parallel (Sharp is fast — no rate limits).
 * Returns an array of results in slideIndex order.
 */
export async function assembleAllSlides(
  slides: SharpSlideInput[]
): Promise<SharpAssemblyResult[]> {
  console.log(`[SharpCompositor] Assembling ${slides.length} slides in parallel...`);
  const start = Date.now();

  const results = await Promise.all(
    slides.map(async (slide) => {
      const url = await assembleSlideWithSharp(slide);
      return { slideIndex: slide.slideIndex, url, isVideo: slide.isVideo ?? false };
    })
  );

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const succeeded = results.filter((r) => r.url !== null).length;
  console.log(`[SharpCompositor] Done: ${succeeded}/${slides.length} slides in ${elapsed}s`);
  return results;
}
