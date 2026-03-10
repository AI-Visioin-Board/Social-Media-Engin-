/**
 * coverTemplateCompositor.ts
 *
 * 10-template cover slide compositor for SuggestedByGPT.
 * Each template is a plug-and-play layout schema derived from top-performing
 * AI news Instagram accounts (@theaifield, @evolving.ai, @airesearches, @godofprompt).
 *
 * The Creative Director selects the template; this module handles the pixel work.
 * All templates output exactly 1080×1350 PNG (Instagram 4:5 portrait).
 *
 * Template routing:
 *   1. council_of_players       — 1 main figure + 3-4 B&W corner figures + 2 logos above text
 *   2. backs_to_the_storm       — 3 logos in a row + dramatic cinematic bg
 *   3. solo_machine             — 1 AI figure, no logos, dark bg, cyan accent headline
 *   4. person_floating_orbs    — 1 real person + 4-5 logo orbs scattered around head
 *   5. real_photo_corner_badges — real photo bg + 2 logos stacked top-right corner
 *   6. left_column_logos        — 3 logos stacked left edge + AI figure center-right bg
 *   7. duo_reaction             — 2 people side-by-side + 2 logos stacked top-left
 *   8. screenshot_overlay       — screenshot upper 55% + dark vignette + 2 logos + yellow headline
 */

import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { CoverTemplate } from "./creativeDirector";

// ESM-compatible __dirname
const __filename_ct = fileURLToPath(import.meta.url);
const __dirname_ct = path.dirname(__filename_ct);

// ─── Canvas constants ─────────────────────────────────────────────────────────

const W = 1080;
const H = 1350;

// ─── Font Embedding (base64) ──────────────────────────────────────────────────
// Same approach as sharpCompositor: embed Anton as base64 data URI
// In dev, fonts are at __dirname/fonts. In prod build (dist/), fonts are one level up at ../fonts.
const COVER_FONTS_DIR = [
  path.join(__dirname_ct, "fonts"),
  path.join(__dirname_ct, "..", "fonts"),
  path.join(__dirname_ct, "..", "server", "fonts"),
].find(d => fs.existsSync(d)) || path.join(__dirname_ct, "fonts");

let _antonB64: string | null = null;
function getCoverFontFaceCSS(): string {
  if (_antonB64 === null) {
    try {
      const fontPath = path.join(COVER_FONTS_DIR, "Anton-Regular.ttf");
      if (fs.existsSync(fontPath)) {
        _antonB64 = fs.readFileSync(fontPath).toString("base64");
      } else {
        _antonB64 = "";
      }
    } catch {
      _antonB64 = "";
    }
  }
  if (!_antonB64) return "";
  return `<style>@font-face { font-family: 'Anton'; src: url('data:font/truetype;base64,${_antonB64}') format('truetype'); }</style>`;
}

/** y-coordinate where the text zone begins (50% of 1350 = 675px — 50/50 split) */
const TEXT_ZONE_TOP = 675;

/** Cyan accent color for headline highlights */
const CYAN = "#00E5FF";
/** Yellow/gold accent for screenshot_overlay template */
const YELLOW = "#FFD700";
/** White for standard headlines */
const WHITE = "#FFFFFF";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CoverTemplateInput {
  template: CoverTemplate;
  backgroundBuffer: Buffer | null;
  headline: string;
  /** Primary person cutout (bg-removed PNG) */
  mainPersonBuffer?: Buffer | null;
  /** Additional person cutouts for multi-person templates */
  supportingPersonBuffers?: Array<Buffer | null>;
  /** Logo buffers in order */
  logoBuffers?: Array<Buffer | null>;
  /** For screenshot_overlay template: the captured/generated product screenshot (1080×742 PNG) */
  screenshotBuffer?: Buffer | null;
  /** Freeform composition manifest from Creative Director (for freeform_composition template) */
  coverComposition?: {
    backgroundPrompt: string;
    subjects: Array<{
      name: string;
      role?: string;
      expression?: string;
      placement: "center" | "left" | "right" | "background-left" | "background-right";
      scale: "dominant" | "supporting" | "background";
      promptFragment?: string;
    }>;
    logoTreatment: Array<{
      logoKey: string;
      size: "small" | "medium" | "large";
      placement: string;
    }>;
    compositionMode: "single_shot" | "multi_layer";
    compositionDescription: string;
  };
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Escape XML special characters for SVG text */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Wrap text into lines of at most maxChars characters, breaking on word boundaries */
function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length <= maxChars) {
      current = (current + " " + word).trim();
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Build SVG headline text elements with accent color on last 2 words of last line.
 */
function buildHeadlineLines(
  headline: string,
  x: number,
  startY: number,
  lineHeight: number,
  fontSize: number,
  fontFamily: string,
  maxCharsPerLine: number,
  color: string = WHITE,
  accentColor: string = CYAN,
): string {
  const lines = wrapText(headline.toUpperCase(), maxCharsPerLine).slice(0, 5);

  return lines.map((line, i) => {
    const y = startY + i * lineHeight;
    if (i === lines.length - 1 && accentColor !== color) {
      const words = line.split(" ");
      if (words.length > 2) {
        const normalPart = words.slice(0, -2).join(" ");
        const accentPart = words.slice(-2).join(" ");
        return `<text x="${x}" y="${y}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="bold" fill="${color}" text-anchor="middle" letter-spacing="0.5">${esc(normalPart)} <tspan fill="${accentColor}">${esc(accentPart)}</tspan></text>`;
      }
    }
    return `<text x="${x}" y="${y}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="bold" fill="${color}" text-anchor="middle" letter-spacing="0.5">${esc(line)}</text>`;
  }).join("\n");
}

/**
 * Build the standard dark bottom text zone SVG overlay.
 * Includes: gradient fade, divider line, brand watermark, headline, swipe hint.
 */
function buildTextZoneSvg(
  headline: string,
  textZoneTop: number,
  headlineColor: string = WHITE,
  accentColor: string = CYAN,
  showDivider: boolean = true,
  /** Override default text layout for templates with compact text zones (e.g. triangle_triptych) */
  layoutOverrides?: { fontSize?: number; lineHeight?: number; maxChars?: number; startYOffset?: number },
): string {
  const fontFamily = "Anton, 'Arial Black', Arial, sans-serif";
  const fontSize = layoutOverrides?.fontSize ?? 72;
  const lineHeight = layoutOverrides?.lineHeight ?? 82;
  const maxChars = layoutOverrides?.maxChars ?? 18;
  const headlineStartY = textZoneTop + (layoutOverrides?.startYOffset ?? 80);

  const headlineLines = buildHeadlineLines(
    headline, W / 2, headlineStartY, lineHeight, fontSize, fontFamily, maxChars, headlineColor, accentColor,
  );

  const dividerY = textZoneTop + 20;
  const dividerSvg = showDivider
    ? `<line x1="40" y1="${dividerY}" x2="${W - 40}" y2="${dividerY}" stroke="white" stroke-opacity="0.3" stroke-width="1"/>`
    : "";
  const brandY = textZoneTop + 45;
  const swipeY = H - 55;

  return `
  <defs>
    ${getCoverFontFaceCSS()}
    <linearGradient id="textFade_${textZoneTop}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="black" stop-opacity="0"/>
      <stop offset="40%" stop-color="black" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="black" stop-opacity="1"/>
    </linearGradient>
  </defs>
  <rect x="0" y="${textZoneTop - 120}" width="${W}" height="150" fill="url(#textFade_${textZoneTop})"/>
  <rect x="0" y="${textZoneTop + 30}" width="${W}" height="${H - textZoneTop - 30}" fill="black"/>
  ${dividerSvg}
  <text x="${W / 2}" y="${brandY}" font-family="Arial, sans-serif" font-size="20" fill="white" fill-opacity="0.50" text-anchor="middle" letter-spacing="3" font-weight="bold">SUGGESTEDBYGPT</text>
  ${headlineLines}
  <text x="${W / 2}" y="${swipeY}" font-family="Arial, sans-serif" font-size="26" fill="white" fill-opacity="0.75" text-anchor="middle" letter-spacing="2" font-weight="bold">SWIPE FOR MORE ›</text>
  `;
}

/** Resize a buffer to fit within maxW×maxH preserving aspect ratio */
async function resizeFit(buf: Buffer, maxW: number, maxH: number): Promise<{ buf: Buffer; w: number; h: number }> {
  const resized = await sharp(buf)
    .resize(maxW, maxH, { fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer();
  const meta = await sharp(resized).metadata();
  return { buf: resized, w: meta.width ?? maxW, h: meta.height ?? maxH };
}

/** Make a circular logo badge from a logo buffer */
async function makeCircularBadge(logoBuf: Buffer, size: number, bgColor: string = "#1a1a2e"): Promise<Buffer> {
  const innerSize = Math.round(size * 0.72);
  const logoResized = await sharp(logoBuf)
    .resize(innerSize, innerSize, { fit: "inside" })
    .png()
    .toBuffer();
  const logoMeta = await sharp(logoResized).metadata();
  const lW = logoMeta.width ?? innerSize;
  const lH = logoMeta.height ?? innerSize;
  const lLeft = Math.round((size - lW) / 2);
  const lTop = Math.round((size - lH) / 2);

  const circleSvg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 2}" fill="${bgColor}" stroke="white" stroke-width="3" stroke-opacity="0.4"/>
  </svg>`;

  return sharp(Buffer.from(circleSvg))
    .composite([{ input: logoResized, left: lLeft, top: lTop }])
    .png()
    .toBuffer();
}

/** Apply soft vignette fade mask to a person buffer */
async function applyVignetteMask(personBuf: Buffer): Promise<Buffer> {
  const meta = await sharp(personBuf).metadata();
  if (meta.channels === 4) return personBuf;

  const w = meta.width ?? 400;
  const h = meta.height ?? 600;
  const maskSvg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="vfade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="white" stop-opacity="0"/>
        <stop offset="12%" stop-color="white" stop-opacity="1"/>
        <stop offset="88%" stop-color="white" stop-opacity="1"/>
        <stop offset="100%" stop-color="white" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#vfade)"/>
  </svg>`;

  const mask = await sharp(Buffer.from(maskSvg)).greyscale().png().toBuffer();
  return sharp(personBuf).ensureAlpha().composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
}

/** Desaturate a person buffer to B&W */
async function desaturate(buf: Buffer): Promise<Buffer> {
  return sharp(buf).greyscale().png().toBuffer();
}

/** Build a solid dark gradient background PNG (1080×1350) */
async function buildDarkBg(bgBuffer: Buffer | null): Promise<Buffer> {
  if (bgBuffer) {
    return sharp(bgBuffer).resize(W, H, { fit: "cover", position: "center" }).png().toBuffer();
  }
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#0a0a1a"/>
        <stop offset="50%" stop-color="#1a0a2e"/>
        <stop offset="100%" stop-color="#000000"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ─── Template 1: council_of_players ──────────────────────────────────────────

async function renderCouncilOfPlayers(input: CoverTemplateInput): Promise<Buffer> {
  const bg = await buildDarkBg(input.backgroundBuffer);
  const composites: sharp.OverlayOptions[] = [];

  // Main figure: center, full color, bottom-aligned to text zone
  if (input.mainPersonBuffer) {
    const maxH = Math.round(TEXT_ZONE_TOP * 0.75);
    const maxW = Math.round(W * 0.55);
    const { buf: mainResized, w: mW, h: mH } = await resizeFit(
      await applyVignetteMask(input.mainPersonBuffer), maxW, maxH
    );
    composites.push({ input: mainResized, left: Math.round((W - mW) / 2), top: Math.max(0, TEXT_ZONE_TOP - mH) });
  }

  // Supporting figures: B&W, placed in corners
  const supporting = (input.supportingPersonBuffers ?? []).filter(Boolean) as Buffer[];
  const corners = [
    { anchor: "tl" }, { anchor: "tr" }, { anchor: "bl" }, { anchor: "br" },
  ];
  for (let i = 0; i < Math.min(supporting.length, 4); i++) {
    const maxH = Math.round(TEXT_ZONE_TOP * 0.45);
    const maxW = Math.round(W * 0.28);
    const bwBuf = await desaturate(await applyVignetteMask(supporting[i]));
    const { buf: suppResized, w: sW, h: sH } = await resizeFit(bwBuf, maxW, maxH);
    const anchor = corners[i].anchor;
    const left = anchor.includes("r") ? W - sW : 0;
    const top = anchor.includes("b") ? TEXT_ZONE_TOP - sH : 0;
    composites.push({ input: suppResized, left: Math.max(0, left), top: Math.max(0, top) });
  }

  // Logos: 2 circular badges centered above text zone
  const logos = (input.logoBuffers ?? []).filter(Boolean) as Buffer[];
  const BADGE_SIZE = 100;
  const BADGE_GAP = 20;
  const numBadges = Math.min(logos.length, 2);
  if (numBadges > 0) {
    const totalBadgeW = numBadges * BADGE_SIZE + (numBadges - 1) * BADGE_GAP;
    const badgeStartX = Math.round((W - totalBadgeW) / 2);
    const badgeY = TEXT_ZONE_TOP - BADGE_SIZE - 30;
    for (let i = 0; i < numBadges; i++) {
      const badge = await makeCircularBadge(logos[i], BADGE_SIZE);
      composites.push({ input: badge, left: badgeStartX + i * (BADGE_SIZE + BADGE_GAP), top: Math.max(0, badgeY) });
    }
  }

  const textSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    ${buildTextZoneSvg(input.headline, TEXT_ZONE_TOP, WHITE, CYAN, true)}
  </svg>`;
  composites.push({ input: Buffer.from(textSvg), left: 0, top: 0 });

  return sharp(bg).composite(composites).png().toBuffer();
}

// ─── Template 2: backs_to_the_storm ──────────────────────────────────────────

async function renderBacksToTheStorm(input: CoverTemplateInput): Promise<Buffer> {
  const bg = await buildDarkBg(input.backgroundBuffer);
  const composites: sharp.OverlayOptions[] = [];

  // 3 logos in a row, evenly spaced, just above text zone
  const logos = (input.logoBuffers ?? []).filter(Boolean) as Buffer[];
  const BADGE_SIZE = 110;
  const numLogos = Math.min(logos.length, 3);
  if (numLogos > 0) {
    const totalW = numLogos * BADGE_SIZE + (numLogos - 1) * 30;
    const startX = Math.round((W - totalW) / 2);
    const badgeY = TEXT_ZONE_TOP - BADGE_SIZE - 40;
    for (let i = 0; i < numLogos; i++) {
      const badge = await makeCircularBadge(logos[i], BADGE_SIZE);
      composites.push({ input: badge, left: startX + i * (BADGE_SIZE + 30), top: Math.max(0, badgeY) });
    }
  }

  const textSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    ${buildTextZoneSvg(input.headline, TEXT_ZONE_TOP, WHITE, CYAN, true)}
  </svg>`;
  composites.push({ input: Buffer.from(textSvg), left: 0, top: 0 });

  return sharp(bg).composite(composites).png().toBuffer();
}

// ─── Template 3: solo_machine ─────────────────────────────────────────────────

async function renderSoloMachine(input: CoverTemplateInput): Promise<Buffer> {
  const bg = await buildDarkBg(input.backgroundBuffer);
  // Text zone only — no logos, no persons (the AI background IS the story)
  const textSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    ${buildTextZoneSvg(input.headline, TEXT_ZONE_TOP, WHITE, CYAN, false)}
  </svg>`;
  return sharp(bg)
    .composite([{ input: Buffer.from(textSvg), left: 0, top: 0 }])
    .png()
    .toBuffer();
}

// ─── Template 4: person_floating_orbs ────────────────────────────────────────

async function renderPersonFloatingOrbs(input: CoverTemplateInput): Promise<Buffer> {
  const bg = await buildDarkBg(input.backgroundBuffer);
  const composites: sharp.OverlayOptions[] = [];

  // Main person: center-lower frame
  if (input.mainPersonBuffer) {
    const maxH = Math.round(TEXT_ZONE_TOP * 0.80);
    const maxW = Math.round(W * 0.65);
    const { buf: personResized, w: pW, h: pH } = await resizeFit(
      await applyVignetteMask(input.mainPersonBuffer), maxW, maxH
    );
    composites.push({ input: personResized, left: Math.round((W - pW) / 2), top: Math.max(0, TEXT_ZONE_TOP - pH) });
  }

  // Logo orbs: scattered around head area (predefined positions)
  const logos = (input.logoBuffers ?? []).filter(Boolean) as Buffer[];
  const ORBS_SIZE = 90;
  const orbPositions = [
    { left: 40, top: 80 },
    { left: W - 40 - ORBS_SIZE, top: 60 },
    { left: 60, top: 320 },
    { left: W - 60 - ORBS_SIZE, top: 300 },
    { left: Math.round(W / 2 - ORBS_SIZE / 2), top: 40 },
  ];
  for (let i = 0; i < Math.min(logos.length, 5); i++) {
    const badge = await makeCircularBadge(logos[i], ORBS_SIZE);
    composites.push({ input: badge, left: Math.max(0, orbPositions[i].left), top: Math.max(0, orbPositions[i].top) });
  }

  const textSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    ${buildTextZoneSvg(input.headline, TEXT_ZONE_TOP, WHITE, CYAN, true)}
  </svg>`;
  composites.push({ input: Buffer.from(textSvg), left: 0, top: 0 });

  return sharp(bg).composite(composites).png().toBuffer();
}

// ─── Template 5: real_photo_corner_badges ────────────────────────────────────

async function renderRealPhotoCornerBadges(input: CoverTemplateInput): Promise<Buffer> {
  const bg = await buildDarkBg(input.backgroundBuffer);
  const composites: sharp.OverlayOptions[] = [];

  // 2 logos stacked top-right corner
  const logos = (input.logoBuffers ?? []).filter(Boolean) as Buffer[];
  const BADGE_SIZE = 120;
  const BADGE_MARGIN = 20;
  const BADGE_OVERLAP = 20;
  for (let i = 0; i < Math.min(logos.length, 2); i++) {
    const badge = await makeCircularBadge(logos[i], BADGE_SIZE);
    composites.push({ input: badge, left: W - BADGE_SIZE - BADGE_MARGIN, top: BADGE_MARGIN + i * (BADGE_SIZE - BADGE_OVERLAP) });
  }

  const textSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    ${buildTextZoneSvg(input.headline, TEXT_ZONE_TOP, WHITE, CYAN, true)}
  </svg>`;
  composites.push({ input: Buffer.from(textSvg), left: 0, top: 0 });

  return sharp(bg).composite(composites).png().toBuffer();
}

// ─── Template 6: left_column_logos ───────────────────────────────────────────

async function renderLeftColumnLogos(input: CoverTemplateInput): Promise<Buffer> {
  const bg = await buildDarkBg(input.backgroundBuffer);
  const composites: sharp.OverlayOptions[] = [];

  // Logos: stacked vertically on left edge, evenly distributed across image zone
  const logos = (input.logoBuffers ?? []).filter(Boolean) as Buffer[];
  const BADGE_SIZE = 110;
  const numLogos = Math.min(logos.length, 3);
  if (numLogos > 0) {
    const spacing = Math.round(TEXT_ZONE_TOP / (numLogos + 1));
    for (let i = 0; i < numLogos; i++) {
      const badge = await makeCircularBadge(logos[i], BADGE_SIZE);
      composites.push({ input: badge, left: 20, top: Math.max(0, spacing * (i + 1) - Math.round(BADGE_SIZE / 2)) });
    }
  }

  const textSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    ${buildTextZoneSvg(input.headline, TEXT_ZONE_TOP, WHITE, CYAN, true)}
  </svg>`;
  composites.push({ input: Buffer.from(textSvg), left: 0, top: 0 });

  return sharp(bg).composite(composites).png().toBuffer();
}

// ─── Template 7: duo_reaction ─────────────────────────────────────────────────

async function renderDuoReaction(input: CoverTemplateInput): Promise<Buffer> {
  const bg = await buildDarkBg(input.backgroundBuffer);
  const composites: sharp.OverlayOptions[] = [];

  // Person 1 (main): left side, slightly larger
  if (input.mainPersonBuffer) {
    const maxH = Math.round(TEXT_ZONE_TOP * 0.85);
    const maxW = Math.round(W * 0.52);
    const { buf: p1, w: p1W, h: p1H } = await resizeFit(
      await applyVignetteMask(input.mainPersonBuffer), maxW, maxH
    );
    composites.push({ input: p1, left: 0, top: Math.max(0, TEXT_ZONE_TOP - p1H) });
  }

  // Person 2 (supporting): right side, slightly smaller
  const supporting = (input.supportingPersonBuffers ?? []).filter(Boolean) as Buffer[];
  if (supporting.length > 0) {
    const maxH = Math.round(TEXT_ZONE_TOP * 0.75);
    const maxW = Math.round(W * 0.48);
    const { buf: p2, w: p2W, h: p2H } = await resizeFit(
      await applyVignetteMask(supporting[0]), maxW, maxH
    );
    composites.push({ input: p2, left: Math.max(0, W - p2W), top: Math.max(0, TEXT_ZONE_TOP - p2H) });
  }

  // 2 logos stacked top-left corner
  const logos = (input.logoBuffers ?? []).filter(Boolean) as Buffer[];
  const BADGE_SIZE = 120;
  const BADGE_MARGIN = 20;
  const BADGE_OVERLAP = 15;
  for (let i = 0; i < Math.min(logos.length, 2); i++) {
    const badge = await makeCircularBadge(logos[i], BADGE_SIZE);
    composites.push({ input: badge, left: BADGE_MARGIN, top: BADGE_MARGIN + i * (BADGE_SIZE - BADGE_OVERLAP) });
  }

  const textSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    ${buildTextZoneSvg(input.headline, TEXT_ZONE_TOP, WHITE, CYAN, true)}
  </svg>`;
  composites.push({ input: Buffer.from(textSvg), left: 0, top: 0 });

  return sharp(bg).composite(composites).png().toBuffer();
}

// ─── Template 8: screenshot_overlay ──────────────────────────────────────────

async function renderScreenshotOverlay(input: CoverTemplateInput): Promise<Buffer> {
  const screenshotH = Math.round(H * 0.55); // 742px

  // Build base: solid black canvas (the lower 45% is always black)
  const base = await sharp({
    create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } }
  }).png().toBuffer();

  const composites: sharp.OverlayOptions[] = [];

  // ── Upper 55%: real screenshot OR AI-generated product UI OR fallback to AI background ──
  if (input.screenshotBuffer) {
    // Real or AI-generated product screenshot — resize to exact 1080×742 and place at top
    const screenshotResized = await sharp(input.screenshotBuffer)
      .resize(W, screenshotH, { fit: "cover", position: "top" })
      .png()
      .toBuffer();
    composites.push({ input: screenshotResized, left: 0, top: 0 });
    console.log(`[CoverTemplateCompositor] screenshot_overlay: using ${input.screenshotBuffer.length} byte screenshot`);
  } else if (input.backgroundBuffer) {
    // Fallback: crop the AI background to the upper 55%
    const bgCropped = await sharp(input.backgroundBuffer)
      .resize(W, screenshotH, { fit: "cover", position: "top" })
      .png()
      .toBuffer();
    composites.push({ input: bgCropped, left: 0, top: 0 });
    console.log(`[CoverTemplateCompositor] screenshot_overlay: no screenshot — using AI background crop`);
  }

  // Dark vignette over screenshot area (bottom fade to black)
  const vignetteSvg = `<svg width="${W}" height="${screenshotH}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="vig" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="black" stop-opacity="0.15"/>
        <stop offset="70%" stop-color="black" stop-opacity="0.45"/>
        <stop offset="100%" stop-color="black" stop-opacity="0.85"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${screenshotH}" fill="url(#vig)"/>
  </svg>`;
  composites.push({ input: Buffer.from(vignetteSvg), left: 0, top: 0 });

  // 2 logos on screenshot: left-center and right-center
  const logos = (input.logoBuffers ?? []).filter(Boolean) as Buffer[];
  const BADGE_SIZE = 130;
  const badgeY = Math.round(screenshotH / 2) - Math.round(BADGE_SIZE / 2);
  if (logos.length >= 1) {
    const badge1 = await makeCircularBadge(logos[0], BADGE_SIZE);
    composites.push({ input: badge1, left: 60, top: badgeY });
  }
  if (logos.length >= 2) {
    const badge2 = await makeCircularBadge(logos[1], BADGE_SIZE);
    composites.push({ input: badge2, left: W - 60 - BADGE_SIZE, top: badgeY });
  }

  // Text zone with YELLOW headline (signature style for this template)
  const textZoneTop = screenshotH - 50;
  const textSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    ${buildTextZoneSvg(input.headline, textZoneTop, YELLOW, WHITE, false)}
  </svg>`;
  composites.push({ input: Buffer.from(textSvg), left: 0, top: 0 });

  return sharp(base).composite(composites).png().toBuffer();
}

// ─── Template 9: freeform_composition ─────────────────────────────────────────
//
// Movie-poster style composition with dynamic person placement, full-color logos,
// and scene-driven backgrounds. Two modes:
//   single_shot  — The mainPersonBuffer IS the complete scene (GPT Image 1 generated
//                  everyone in one pass). Use it as the full background canvas.
//   multi_layer  — Separate background + bg-removed person cutouts composited at
//                  specified placements and scales, then logos + text overlay.

/** Parse a placement string like "top-right" into pixel coordinates */
function parseFreeformPlacement(
  placement: string, itemW: number, itemH: number
): { left: number; top: number } {
  const margin = 30;
  const safeZoneBottom = TEXT_ZONE_TOP - 20; // Don't overlap text zone

  switch (placement) {
    case "top-left":      return { left: margin, top: margin };
    case "top-center":    return { left: Math.round((W - itemW) / 2), top: margin };
    case "top-right":     return { left: W - itemW - margin, top: margin };
    case "mid-left":      return { left: margin, top: Math.round((safeZoneBottom - itemH) / 2) };
    case "mid-right":     return { left: W - itemW - margin, top: Math.round((safeZoneBottom - itemH) / 2) };
    case "above-text-left":   return { left: margin, top: Math.max(0, safeZoneBottom - itemH - 20) };
    case "above-text-center": return { left: Math.round((W - itemW) / 2), top: Math.max(0, safeZoneBottom - itemH - 20) };
    case "above-text-right":  return { left: W - itemW - margin, top: Math.max(0, safeZoneBottom - itemH - 20) };
    case "bottom-left":       return { left: margin, top: Math.max(0, safeZoneBottom - itemH) };
    case "bottom-right":      return { left: W - itemW - margin, top: Math.max(0, safeZoneBottom - itemH) };
    case "bottom-center":     return { left: Math.round((W - itemW) / 2), top: Math.max(0, safeZoneBottom - itemH) };
    default:
      // Unknown placement — center horizontally, place above text
      return { left: Math.round((W - itemW) / 2), top: Math.max(margin, safeZoneBottom - itemH - 60) };
  }
}

async function renderFreeformComposition(input: CoverTemplateInput): Promise<Buffer> {
  const composition = input.coverComposition;
  const composites: sharp.OverlayOptions[] = [];

  const mode = composition?.compositionMode ?? "single_shot";

  let base: Buffer;

  if (mode === "single_shot" && input.mainPersonBuffer) {
    // ── Single-shot: mainPersonBuffer IS the complete scene ──
    // Nano Banana (Gemini) generated the person(s) naturally inside the scene.
    // Use the full image as the background canvas — no cutout compositing needed.
    base = await sharp(input.mainPersonBuffer)
      .resize(W, H, { fit: "cover", position: "center" })
      .png()
      .toBuffer();
    console.log(`[CoverTemplate] Freeform single_shot: using Nano Banana scene as full canvas`);
  } else if (mode === "multi_layer") {
    // ── Multi-layer: background + person cutouts composited ──
    base = await buildDarkBg(input.backgroundBuffer);
    console.log(`[CoverTemplate] Freeform multi_layer: compositing persons onto background`);

    // Gather all person buffers with their metadata
    const allPersons: Array<{ buffer: Buffer; subjectIdx: number }> = [];
    if (input.mainPersonBuffer) {
      allPersons.push({ buffer: input.mainPersonBuffer, subjectIdx: 0 });
    }
    const supporting = (input.supportingPersonBuffers ?? []).filter(Boolean) as Buffer[];
    for (let i = 0; i < supporting.length; i++) {
      allPersons.push({ buffer: supporting[i], subjectIdx: i + 1 });
    }

    // Sort by scale: background → supporting → dominant (render back-to-front)
    const scaleOrder: Record<string, number> = { background: 0, supporting: 1, dominant: 2 };
    const sortedPersons = allPersons
      .map(p => ({
        ...p,
        meta: composition?.subjects?.[p.subjectIdx],
      }))
      .sort((a, b) => {
        const aOrder = scaleOrder[a.meta?.scale ?? "supporting"] ?? 1;
        const bOrder = scaleOrder[b.meta?.scale ?? "supporting"] ?? 1;
        return aOrder - bOrder;
      });

    for (const person of sortedPersons) {
      const scale = person.meta?.scale ?? "supporting";
      const placement = person.meta?.placement ?? "center";

      // Scale factors: how much of the image zone each role occupies
      const scaleFactors: Record<string, { maxH: number; maxW: number }> = {
        dominant:   { maxH: 0.85, maxW: 0.65 },
        supporting: { maxH: 0.55, maxW: 0.40 },
        background: { maxH: 0.40, maxW: 0.30 },
      };
      const factors = scaleFactors[scale] ?? scaleFactors.supporting;
      const maxH = Math.round(TEXT_ZONE_TOP * factors.maxH);
      const maxW = Math.round(W * factors.maxW);

      const vignetted = await applyVignetteMask(person.buffer);
      const { buf: resized, w: rW, h: rH } = await resizeFit(vignetted, maxW, maxH);

      // Position based on placement keyword
      let left: number, top: number;
      switch (placement) {
        case "left":
          left = Math.round(W * 0.05);
          top = Math.max(0, TEXT_ZONE_TOP - rH);
          break;
        case "right":
          left = Math.max(0, W - rW - Math.round(W * 0.05));
          top = Math.max(0, TEXT_ZONE_TOP - rH);
          break;
        case "background-left":
          left = 0;
          top = Math.max(0, TEXT_ZONE_TOP - rH - 50);
          break;
        case "background-right":
          left = Math.max(0, W - rW);
          top = Math.max(0, TEXT_ZONE_TOP - rH - 50);
          break;
        case "center":
        default:
          left = Math.round((W - rW) / 2);
          top = Math.max(0, TEXT_ZONE_TOP - rH);
          break;
      }

      composites.push({ input: resized, left, top });
      console.log(`[CoverTemplate] Freeform: placed "${person.meta?.name ?? "person"}" (${scale}) at [${left},${top}] ${rW}×${rH}px`);
    }
  } else {
    // Fallback: just use background (single_shot without person buffer)
    base = await buildDarkBg(input.backgroundBuffer);
    console.log(`[CoverTemplate] Freeform fallback: background only (no person buffers)`);
  }

  // ── Logo layers (full-color with drop shadow, sized per logoTreatment) ──
  const logos = (input.logoBuffers ?? []).filter(Boolean) as Buffer[];
  if (logos.length > 0 && composition?.logoTreatment && composition.logoTreatment.length > 0) {
    const sizeMap: Record<string, number> = { small: 80, medium: 140, large: 200 };
    for (let i = 0; i < Math.min(logos.length, composition.logoTreatment.length); i++) {
      const treatment = composition.logoTreatment[i];
      const size = sizeMap[treatment.size] ?? 140;

      const logoResized = await sharp(logos[i])
        .resize(size, size, { fit: "inside" })
        .png()
        .toBuffer();
      const logoMeta = await sharp(logoResized).metadata();
      const lW = logoMeta.width ?? size;
      const lH = logoMeta.height ?? size;

      // Add drop shadow via SVG canvas
      const canvasW = lW + 20;
      const canvasH = lH + 20;
      const shadowSvg = `<svg width="${canvasW}" height="${canvasH}" xmlns="http://www.w3.org/2000/svg">
        <defs><filter id="logods${i}"><feDropShadow dx="0" dy="2" stdDeviation="5" flood-opacity="0.4"/></filter></defs>
        <rect width="${canvasW}" height="${canvasH}" fill="none" filter="url(#logods${i})" opacity="0"/>
      </svg>`;
      const logoWithShadow = await sharp(Buffer.from(shadowSvg))
        .composite([{ input: logoResized, left: 10, top: 10 }])
        .png()
        .toBuffer();

      const pos = parseFreeformPlacement(treatment.placement, canvasW, canvasH);
      composites.push({ input: logoWithShadow, left: Math.max(0, pos.left), top: Math.max(0, pos.top) });
      console.log(`[CoverTemplate] Freeform: logo "${treatment.logoKey}" (${treatment.size}) at ${treatment.placement}`);
    }
  } else if (logos.length > 0) {
    // No treatment specified — default: place logos top-right stacked
    const defaultPositions = [
      { left: W - 180, top: 30 },
      { left: W - 180, top: 180 },
      { left: W - 180, top: 330 },
    ];
    for (let i = 0; i < Math.min(logos.length, 3); i++) {
      const logoResized = await sharp(logos[i])
        .resize(140, 140, { fit: "inside" })
        .png()
        .toBuffer();
      composites.push({ input: logoResized, left: defaultPositions[i].left, top: defaultPositions[i].top });
    }
  }

  // ── Text overlay (gradient + headline) ──
  const textSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    ${buildTextZoneSvg(input.headline, TEXT_ZONE_TOP, WHITE, CYAN, true)}
  </svg>`;
  composites.push({ input: Buffer.from(textSvg), left: 0, top: 0 });

  return sharp(base).composite(composites).png().toBuffer();
}

// ─── Template 10: triangle_triptych ────────────────────────────────────────────
//
// Three triangular slivers fanning from a central apex point, each containing
// a separate independently-generated full-scene image. Movie-poster triptych:
// each panel is its own scene (person in environment), clipped to a triangle shape.
//
// Geometry: taller image zone (~900px) for proper sliver proportions on portrait canvas.
// Three triangles share apex at bottom-center of image zone.
// Text zone is compact (~450px) below the triangles.

/** Image zone height for triangle triptych — taller than standard (675) for sliver proportions */
const TRIPTYCH_IMAGE_H = 900;
/** Where the text zone begins for triptych */
const TRIPTYCH_TEXT_TOP = TRIPTYCH_IMAGE_H;
/** Apex point where all three triangles meet */
const TRIPTYCH_APEX = { x: W / 2, y: TRIPTYCH_IMAGE_H };

const TRIPTYCH_TRIANGLES = [
  { // Left panel
    vertices: [{ x: 0, y: 0 }, { x: Math.round(W / 3), y: 0 }, { x: W / 2, y: TRIPTYCH_IMAGE_H }],
    label: "left",
  },
  { // Center panel
    vertices: [{ x: Math.round(W / 3), y: 0 }, { x: Math.round(2 * W / 3), y: 0 }, { x: W / 2, y: TRIPTYCH_IMAGE_H }],
    label: "center",
  },
  { // Right panel
    vertices: [{ x: Math.round(2 * W / 3), y: 0 }, { x: W, y: 0 }, { x: W / 2, y: TRIPTYCH_IMAGE_H }],
    label: "right",
  },
];

async function renderTriangleTriptych(input: CoverTemplateInput): Promise<Buffer> {
  // ── Gather 3 image buffers: mainPerson + 2 supporting ──
  const images: Array<Buffer | null> = [
    input.mainPersonBuffer ?? null,
    ...(input.supportingPersonBuffers ?? []).slice(0, 2),
  ];
  while (images.length < 3) images.push(null);

  // ── Start with a black canvas ──
  const base = await sharp({
    create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  }).png().toBuffer();

  const composites: sharp.OverlayOptions[] = [];

  for (let i = 0; i < 3; i++) {
    const tri = TRIPTYCH_TRIANGLES[i];
    const imgBuf = images[i];

    // Calculate bounding box of this triangle
    const xs = tri.vertices.map(v => v.x);
    const ys = tri.vertices.map(v => v.y);
    const bboxLeft = Math.min(...xs);
    const bboxTop = Math.min(...ys);
    const bboxW = Math.max(...xs) - bboxLeft;
    const bboxH = Math.max(...ys) - bboxTop;

    if (!imgBuf) {
      // ── Fallback: dark gradient fill for missing image ──
      const fallbackSvg = `<svg width="${bboxW}" height="${bboxH}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <clipPath id="triClipFallback${i}">
            <polygon points="${tri.vertices.map(v => `${v.x - bboxLeft},${v.y - bboxTop}`).join(" ")}"/>
          </clipPath>
          <linearGradient id="triFallbackGrad${i}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#1a1a2e"/>
            <stop offset="100%" stop-color="#0a0a14"/>
          </linearGradient>
        </defs>
        <rect width="${bboxW}" height="${bboxH}" fill="url(#triFallbackGrad${i})" clip-path="url(#triClipFallback${i})"/>
      </svg>`;
      composites.push({ input: Buffer.from(fallbackSvg), left: bboxLeft, top: bboxTop });
      console.log(`[CoverTemplate] triangle_triptych: panel ${i} (${tri.label}) — no image, using dark gradient fallback`);
      continue;
    }

    // ── Resize image to COVER the bounding box (subject centered) ──
    const resized = await sharp(imgBuf)
      .resize(bboxW, bboxH, { fit: "cover", position: "centre" })
      .ensureAlpha()
      .png()
      .toBuffer();

    // ── Create SVG alpha mask: white polygon on transparent background ──
    // Triangle vertices offset to bounding box origin
    const offsetPoints = tri.vertices
      .map(v => `${v.x - bboxLeft},${v.y - bboxTop}`)
      .join(" ");
    const maskSvg = `<svg width="${bboxW}" height="${bboxH}" xmlns="http://www.w3.org/2000/svg">
      <polygon points="${offsetPoints}" fill="white"/>
    </svg>`;
    const mask = await sharp(Buffer.from(maskSvg))
      .greyscale()
      .png()
      .toBuffer();

    // ── Apply mask: clip image to triangle shape ──
    const clipped = await sharp(resized)
      .composite([{ input: mask, blend: "dest-in" }])
      .png()
      .toBuffer();

    composites.push({ input: clipped, left: bboxLeft, top: bboxTop });
    console.log(`[CoverTemplate] triangle_triptych: panel ${i} (${tri.label}) placed at [${bboxLeft},${bboxTop}] ${bboxW}×${bboxH}px`);
  }

  // ── White border lines between triangles (4px) ──
  const BORDER_W = 4;
  const thirdW = Math.round(W / 3);
  const twoThirdW = Math.round(2 * W / 3);
  const borderSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <line x1="${thirdW}" y1="0" x2="${TRIPTYCH_APEX.x}" y2="${TRIPTYCH_APEX.y}" stroke="white" stroke-width="${BORDER_W}" stroke-linecap="round"/>
    <line x1="${twoThirdW}" y1="0" x2="${TRIPTYCH_APEX.x}" y2="${TRIPTYCH_APEX.y}" stroke="white" stroke-width="${BORDER_W}" stroke-linecap="round"/>
  </svg>`;
  composites.push({ input: Buffer.from(borderSvg), left: 0, top: 0 });

  // ── Compact text zone (taller image zone = shorter text zone ~450px) ──
  // Use smaller font + wider lines to prevent headline overlapping "SWIPE FOR MORE"
  // Standard: 72px/82px/18chars → 5 lines can reach y=1308, overlapping swipe at 1295
  // Compact:  64px/74px/22chars → 4 lines max reach y=960+3×74=1182, well clear
  const textSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    ${buildTextZoneSvg(input.headline, TRIPTYCH_TEXT_TOP, WHITE, CYAN, true, {
      fontSize: 64, lineHeight: 74, maxChars: 22, startYOffset: 60,
    })}
  </svg>`;
  composites.push({ input: Buffer.from(textSvg), left: 0, top: 0 });

  return sharp(base).composite(composites).png().toBuffer();
}

// ─── Main router ──────────────────────────────────────────────────────────────

/**
 * Route to the correct template compositor based on the template name.
 * All templates output exactly 1080×1350 PNG.
 */
export async function composeCoverTemplate(input: CoverTemplateInput): Promise<Buffer> {
  switch (input.template) {
    case "council_of_players":      return renderCouncilOfPlayers(input);
    case "backs_to_the_storm":      return renderBacksToTheStorm(input);
    case "solo_machine":            return renderSoloMachine(input);
    case "person_floating_orbs":   return renderPersonFloatingOrbs(input);
    case "real_photo_corner_badges": return renderRealPhotoCornerBadges(input);
    case "left_column_logos":       return renderLeftColumnLogos(input);
    case "duo_reaction":            return renderDuoReaction(input);
    case "screenshot_overlay":      return renderScreenshotOverlay(input);
    case "freeform_composition":    return renderFreeformComposition(input);
    case "triangle_triptych":       return renderTriangleTriptych(input);
    default: {
      const _exhaustive: never = input.template;
      throw new Error(`Unknown cover template: ${_exhaustive}`);
    }
  }
}
