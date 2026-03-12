/**
 * htmlCompositor.ts
 *
 * HTML/CSS slide template generator for Instagram carousel slides.
 * Replaces the Sharp SVG string approach with proper HTML/CSS rendered
 * via a headless browser (see screenshot.ts).
 *
 * Why HTML/CSS instead of SVG:
 * 1. Perfect typography — Google Fonts load natively, CSS handles kerning + wrapping
 * 2. Flexbox layouts — text auto-positions, no hardcoded Y coordinates
 * 3. CSS effects — gradients, shadows, border-radius are native properties
 * 4. Maintainable — HTML templates are readable, not 200-line SVG template strings
 * 5. No font hacks — no base64 embedding, no fontconfig workarounds
 *
 * Each function returns a complete HTML document string ready for Puppeteer capture.
 */

// ─── Shared Constants ────────────────────────────────────────────────────────

const SLIDE_W = 1080;
const SLIDE_H = 1350;
const CYAN = "#00E5FF";

// Power words that get highlighted in cyan
const POWER_WORDS = new Set([
  "ILLEGAL", "SECRET", "BANNED", "EXPOSED", "LEAKED", "SHOCKING",
  "INSANE", "WILD", "MASSIVE", "BIGGEST", "WORST", "BEST", "FIRST",
  "NEVER", "ALWAYS", "EVERY", "ALL", "ZERO", "100%", "99%", "95%",
  "DEAD", "ALIVE", "DANGEROUS", "POWERFUL", "REVOLUTIONARY", "HISTORIC",
  "UNPRECEDENTED", "BREAKING", "URGENT", "CRITICAL", "EXTREME",
  "DESTROYED", "REPLACED", "ELIMINATED", "SURPASSED", "DEFEATED",
  "GOD", "GENIUS", "PERFECT", "IMPOSSIBLE", "UNSTOPPABLE",
]);

// ─── Shared Helpers ──────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Build headline HTML with cyan highlighting on power words.
 * If no power words found, highlights the last 2 words (the "punchline").
 */
function buildHighlightedHeadline(headline: string): string {
  const upper = headline.toUpperCase().trim() || "BREAKING AI NEWS";
  const words = upper.split(/\s+/);

  // Determine which words to highlight
  const highlighted = new Set<number>();
  words.forEach((word, i) => {
    const clean = word.replace(/[^A-Z0-9%]/g, "");
    if (POWER_WORDS.has(clean)) highlighted.add(i);
    if (/^\d+(\.\d+)?%$/.test(clean) || /^\d{2,}$/.test(clean)) highlighted.add(i);
  });

  // If nothing highlighted, highlight the last 2 words
  if (highlighted.size === 0 && words.length >= 3) {
    highlighted.add(words.length - 1);
    highlighted.add(words.length - 2);
  }

  return words
    .map((word, i) =>
      highlighted.has(i)
        ? `<span style="color: ${CYAN};">${escapeHtml(word)}</span>`
        : escapeHtml(word)
    )
    .join(" ");
}

/**
 * Convert an image buffer to a base64 data URI for embedding in HTML.
 * This avoids the headless browser needing to make HTTP requests for images.
 */
function bufferToDataUri(buffer: Buffer, mimeType = "image/png"): string {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

/**
 * Common HTML head with Google Fonts.
 * No Tailwind CDN — all styling is inline. This avoids a network dependency
 * that could timeout in containerized environments (Railway, Docker).
 * Only Google Fonts is loaded via CDN (needed for Anton + Inter typography).
 */
function htmlHead(): string {
  return `
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        width: ${SLIDE_W}px;
        height: ${SLIDE_H}px;
        overflow: hidden;
        font-family: 'Inter', sans-serif;
      }
      .font-anton { font-family: 'Anton', sans-serif; }
      .font-inter { font-family: 'Inter', sans-serif; }
    </style>`;
}

// ─── Logo Badge HTML ─────────────────────────────────────────────────────────

interface LogoBadgeInput {
  dataUri: string;
  size: number;
  style: "full_color" | "badge";
}

function renderLogoBadgeHtml(logo: LogoBadgeInput): string {
  const bgColor = logo.style === "full_color"
    ? "rgba(25, 25, 55, 0.85)"
    : "rgba(20, 20, 45, 0.88)";
  const logoAreaPct = logo.style === "full_color" ? 70 : 65;

  return `
    <div style="
      width: ${logo.size}px;
      height: ${logo.size}px;
      border-radius: 50%;
      background: ${bgColor};
      border: 5px solid rgba(255,255,255,0.85);
      box-shadow: 0 0 16px rgba(255,255,255,0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    ">
      <img src="${logo.dataUri}" style="
        width: ${logoAreaPct}%;
        height: ${logoAreaPct}%;
        object-fit: contain;
      " />
    </div>`;
}

// ─── Content Slide Template ──────────────────────────────────────────────────
// Standard image + text slide (slides 1-4)
// Layout: top 50% = hero image, bottom 50% = dark zone with headline + summary

export interface ContentSlideInput {
  /** Background image as a Buffer (will be base64-encoded) or an S3 URL */
  backgroundBuffer?: Buffer | null;
  backgroundUrl?: string;
  headline: string;
  summary?: string;
  insightLine?: string;
  /** Logo buffers to render as circular badges in the image zone */
  logoBuffers?: Array<Buffer | null>;
  logoStyle?: "full_color" | "badge" | "none";
  logoSize?: number;
}

export function generateContentSlideHtml(input: ContentSlideInput): string {
  const bgSrc = input.backgroundBuffer
    ? bufferToDataUri(input.backgroundBuffer)
    : input.backgroundUrl || "";

  const headlineHtml = buildHighlightedHeadline(input.headline);
  const effectiveLogoStyle = input.logoStyle ?? "full_color";
  const logoSizeDefault = effectiveLogoStyle === "full_color" ? 120 : 90;
  const logoSize = input.logoSize ?? logoSizeDefault;

  // Build logo badges HTML
  let logosHtml = "";
  if (effectiveLogoStyle !== "none" && input.logoBuffers) {
    const validLogos = input.logoBuffers.filter((b): b is Buffer => b !== null).slice(0, 3);
    if (validLogos.length > 0) {
      const badgesHtml = validLogos
        .map((buf) => renderLogoBadgeHtml({
          dataUri: bufferToDataUri(buf),
          size: logoSize,
          style: effectiveLogoStyle,
        }))
        .join("");

      // Position logos in the image zone (absolute, top-right area)
      const positions = [
        { right: 24, top: 24 },
        { right: 24, top: 24 + logoSize + 16 },
        { left: 24, top: 24 },
      ];

      logosHtml = validLogos
        .map((buf, i) => {
          const pos = positions[i];
          const posStyle = "right" in pos
            ? `right: ${pos.right}px; top: ${pos.top}px;`
            : `left: ${pos.left}px; top: ${pos.top}px;`;
          return `
            <div style="position: absolute; ${posStyle} z-index: 10;">
              ${renderLogoBadgeHtml({
                dataUri: bufferToDataUri(buf),
                size: logoSize,
                style: effectiveLogoStyle,
              })}
            </div>`;
        })
        .join("");
    }
  }

  // Summary HTML
  let summaryHtml = "";
  if (input.summary && input.summary.trim().length > 10) {
    summaryHtml = `
      <p style="
        color: rgba(255,255,255,0.80);
        font-family: 'Inter', Arial, sans-serif;
        font-size: 28px;
        line-height: 1.35;
        text-align: center;
        margin-top: 16px;
        max-width: 920px;
      ">${escapeHtml(input.summary.trim())}</p>`;
  }

  // Insight bubble HTML
  let insightHtml = "";
  if (input.insightLine && input.insightLine.trim().length > 3) {
    insightHtml = `
      <div style="
        position: relative;
        background: rgba(255,255,255,0.92);
        border-radius: 12px;
        padding: 14px 24px;
        margin-top: 20px;
        max-width: 680px;
      ">
        <!-- Upward-pointing tail -->
        <div style="
          position: absolute;
          top: -10px;
          left: 50%;
          transform: translateX(-50%);
          width: 0; height: 0;
          border-left: 10px solid transparent;
          border-right: 10px solid transparent;
          border-bottom: 10px solid rgba(255,255,255,0.92);
        "></div>
        <p style="
          color: #0a0a0a;
          font-family: 'Inter', Arial, sans-serif;
          font-size: 26px;
          font-weight: 600;
          text-align: center;
          line-height: 1.35;
          margin: 0;
        ">${escapeHtml(input.insightLine.trim())}</p>
      </div>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  ${htmlHead()}
  <style>
    body { background: black; }
  </style>
</head>
<body>
  <div style="position: relative; width: ${SLIDE_W}px; height: ${SLIDE_H}px; display: flex; flex-direction: column;">

    <!-- Layer 1: Hero image zone (top 50%) -->
    <div style="position: absolute; top: 0; left: 0; right: 0; height: 675px; overflow: hidden;">
      ${bgSrc ? `<img src="${bgSrc}" style="width: 100%; height: 100%; object-fit: cover; object-position: center top;" />` : ""}
    </div>

    <!-- Layer 2: Logo badges (positioned in image zone) -->
    ${logosHtml}

    <!-- Layer 3: Gradient transition (image zone into dark zone) -->
    <div style="
      position: absolute;
      left: 0; right: 0;
      top: 515px;
      height: 160px;
      background: linear-gradient(to bottom, transparent, black);
      z-index: 15;
    "></div>

    <!-- Layer 4: Solid dark zone (bottom 50%) -->
    <div style="
      position: absolute;
      left: 0; right: 0;
      top: 675px;
      bottom: 0;
      background: black;
      z-index: 15;
    "></div>

    <!-- Layer 5: Text content (over the dark zone) -->
    <div style="
      position: absolute;
      left: 0; right: 0;
      top: 675px;
      bottom: 0;
      z-index: 20;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 15px 48px 0 48px;
    ">
      <!-- Thin divider line -->
      <div style="width: calc(100% - 60px); height: 1px; background: rgba(255,255,255,0.25);"></div>

      <!-- Brand mark -->
      <div style="
        color: rgba(255,255,255,0.50);
        font-family: 'Inter', Arial, sans-serif;
        font-size: 20px;
        font-weight: 700;
        letter-spacing: 3px;
        margin-top: 12px;
      ">SUGGESTEDBYGPT</div>

      <!-- Headline -->
      <h1 class="font-anton" style="
        color: white;
        font-size: 76px;
        line-height: 1.08;
        letter-spacing: 1px;
        text-transform: uppercase;
        text-align: center;
        width: 100%;
        margin-top: 20px;
        text-shadow: 3px 3px 6px rgba(0,0,0,0.5);
      ">${headlineHtml}</h1>

      ${summaryHtml}
      ${insightHtml}
    </div>

    <!-- Layer 6: Swipe hint (absolute bottom) -->
    <div style="
      position: absolute;
      bottom: 45px;
      left: 0; right: 0;
      z-index: 25;
      text-align: center;
    ">
      <span style="
        color: rgba(255,255,255,0.70);
        font-family: 'Inter', Arial, sans-serif;
        font-size: 26px;
        font-weight: 700;
        letter-spacing: 4px;
      ">SWIPE FOR MORE &#x203A;</span>
    </div>

  </div>
</body>
</html>`;
}

// ─── Cover Slide Template ────────────────────────────────────────────────────
// The cover slide (slide 0) — scroll-stopping hero with full-bleed image,
// large headline, optional badges, and watermark/CTA bar.

export interface CoverSlideInput {
  backgroundBuffer?: Buffer | null;
  backgroundUrl?: string;
  headline: string;
  /** Circular badge inputs: people cutouts or logo images */
  badges?: Array<{
    buffer: Buffer;
    isLogo: boolean;
    /** Percentage from left edge (0-100) */
    x: number;
    /** Percentage from top edge (0-100) */
    y: number;
    /** Badge diameter in pixels */
    size: number;
  }>;
  /** Logo buffers for the footer badge row */
  logoBuffers?: Array<Buffer | null>;
  logoStyle?: "full_color" | "badge" | "none";
  logoSize?: number;
}

export function generateCoverSlideHtml(input: CoverSlideInput): string {
  const bgSrc = input.backgroundBuffer
    ? bufferToDataUri(input.backgroundBuffer)
    : input.backgroundUrl || "";

  const headlineHtml = buildHighlightedHeadline(input.headline);

  // Build badges HTML (positioned absolutely by percentage)
  let badgesHtml = "";
  if (input.badges && input.badges.length > 0) {
    badgesHtml = input.badges
      .map((badge) => {
        const bgColor = badge.isLogo ? "rgba(25,25,55,0.85)" : "black";
        return `
          <div style="
            position: absolute;
            left: ${badge.x}%;
            top: ${badge.y}%;
            width: ${badge.size}px;
            height: ${badge.size}px;
            transform: translate(-50%, -50%);
            border-radius: 50%;
            overflow: hidden;
            background: ${bgColor};
            border: 5px solid rgba(255,255,255,0.85);
            box-shadow: 0 0 24px rgba(255,255,255,0.25);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10;
          ">
            <img src="${bufferToDataUri(badge.buffer)}"
              style="width: ${badge.isLogo ? "70%" : "100%"}; height: ${badge.isLogo ? "70%" : "100%"}; object-fit: ${badge.isLogo ? "contain" : "cover"};"
            />
          </div>`;
      })
      .join("");
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  ${htmlHead()}
  <style>
    body { background: black; }
  </style>
</head>
<body>
  <div style="position: relative; width: ${SLIDE_W}px; height: ${SLIDE_H}px; display: flex; flex-direction: column; justify-content: flex-end;">

    <!-- Layer 1: Full-bleed background image -->
    <div style="position: absolute; inset: 0; z-index: 0;">
      ${bgSrc ? `<img src="${bgSrc}" style="width: 100%; height: 100%; object-fit: cover;" />` : ""}
    </div>

    <!-- Layer 2: Circular badges / cutouts -->
    ${badgesHtml}

    <!-- Layer 3: Heavy gradient overlay -->
    <div style="
      position: absolute;
      inset: 0;
      z-index: 20;
      background: linear-gradient(to top,
        rgba(0,0,0,0.98) 0%,
        rgba(0,0,0,0.92) 15%,
        rgba(0,0,0,0.78) 30%,
        rgba(0,0,0,0.45) 45%,
        rgba(0,0,0,0) 65%
      );
    "></div>

    <!-- Layer 4: Text + UI -->
    <div style="
      position: relative;
      z-index: 30;
      padding: 0 56px 56px 56px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      width: 100%;
    ">
      <!-- Subtle divider -->
      <div style="position: relative; width: 100%; height: 2px; background: rgba(255,255,255,0.30); margin-bottom: 32px;">
        <div style="
          position: absolute;
          left: 50%; top: 50%;
          transform: translate(-50%, -50%);
          background: black;
          padding: 0 12px;
          color: rgba(255,255,255,0.50);
          font-size: 18px;
          font-family: 'Inter', sans-serif;
          letter-spacing: 3px;
          font-weight: 700;
        ">AI</div>
      </div>

      <!-- Headline -->
      <h1 class="font-anton" style="
        color: white;
        font-size: 90px;
        line-height: 1.05;
        letter-spacing: 1px;
        text-transform: uppercase;
        width: 100%;
        text-shadow: 4px 4px 8px rgba(0,0,0,0.6);
      ">${headlineHtml}</h1>

      <!-- Footer bar: watermark + CTA -->
      <div style="
        width: 100%;
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 40px;
      ">
        <!-- Watermark pill -->
        <div style="
          display: flex;
          align-items: center;
          gap: 10px;
          background: rgba(0,0,0,0.40);
          backdrop-filter: blur(8px);
          border-radius: 999px;
          padding: 8px 20px 8px 8px;
          border: 1px solid rgba(255,255,255,0.10);
        ">
          <div style="
            width: 40px; height: 40px;
            border-radius: 50%;
            background: #10b981;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            font-weight: 700;
            color: white;
            font-family: 'Inter', sans-serif;
          ">AI</div>
          <span style="
            color: rgba(255,255,255,0.90);
            font-size: 22px;
            font-family: 'Inter', sans-serif;
            font-weight: 500;
            letter-spacing: 0.5px;
          ">suggestedbygpt</span>
        </div>

        <!-- Swipe CTA pill -->
        <div style="
          display: flex;
          align-items: center;
          gap: 10px;
          background: rgba(0,0,0,0.40);
          backdrop-filter: blur(8px);
          border-radius: 999px;
          padding: 8px 8px 8px 20px;
          border: 1px solid rgba(255,255,255,0.10);
        ">
          <span style="
            color: white;
            font-size: 18px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 2px;
            font-family: 'Inter', sans-serif;
          ">Swipe For More</span>
          <div style="
            width: 40px; height: 40px;
            border-radius: 50%;
            background: white;
            display: flex;
            align-items: center;
            justify-content: center;
          ">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 5l7 7-7 7"/>
            </svg>
          </div>
        </div>
      </div>
    </div>

  </div>
</body>
</html>`;
}

// ─── Triangle Triptych Cover Template ────────────────────────────────────────
// 3 diagonal slivers side by side using CSS clip-path instead of Sharp polygon math.
// Each sliver contains an independently generated image.

export interface TriptychCoverInput {
  /** Three image buffers for the three slivers (left, center, right) */
  sliverBuffers: [Buffer, Buffer, Buffer];
  headline: string;
  /** Logo buffers for badges above the text zone */
  logoBuffers?: Array<Buffer | null>;
}

export function generateTriptychCoverHtml(input: TriptychCoverInput): string {
  const headlineHtml = buildHighlightedHeadline(input.headline);

  // Sliver dimensions — matches the Sharp triptych geometry
  const IMAGE_ZONE_H = 900; // tall image zone
  const SLANT = 40; // diagonal slant in pixels
  const W = SLIDE_W;

  // CSS clip-path polygons for 3 diagonal slivers
  // These replicate the exact same geometry as the Sharp TRIPTYCH_SLIVERS constant
  const sliverClips = [
    // Left sliver
    `polygon(0 0, ${Math.round(W / 3) + SLANT}px 0, ${Math.round(W / 3) - SLANT}px ${IMAGE_ZONE_H}px, 0 ${IMAGE_ZONE_H}px)`,
    // Center sliver
    `polygon(${Math.round(W / 3) + SLANT}px 0, ${Math.round(2 * W / 3) + SLANT}px 0, ${Math.round(2 * W / 3) - SLANT}px ${IMAGE_ZONE_H}px, ${Math.round(W / 3) - SLANT}px ${IMAGE_ZONE_H}px)`,
    // Right sliver
    `polygon(${Math.round(2 * W / 3) + SLANT}px 0, ${W}px 0, ${W}px ${IMAGE_ZONE_H}px, ${Math.round(2 * W / 3) - SLANT}px ${IMAGE_ZONE_H}px)`,
  ];

  const sliversHtml = input.sliverBuffers
    .map((buf, i) => `
      <div style="
        position: absolute;
        top: 0; left: 0;
        width: ${W}px;
        height: ${IMAGE_ZONE_H}px;
        clip-path: ${sliverClips[i]};
      ">
        <img src="${bufferToDataUri(buf)}" style="
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center top;
        " />
      </div>`)
    .join("");

  // 2px white separator lines between slivers (aesthetic touch)
  const separatorLines = [1, 2].map((i) => {
    const topX = Math.round((i * W) / 3) + SLANT;
    const botX = Math.round((i * W) / 3) - SLANT;
    return `
      <svg style="position: absolute; top: 0; left: 0; z-index: 5; pointer-events: none;"
           width="${W}" height="${IMAGE_ZONE_H}">
        <line x1="${topX}" y1="0" x2="${botX}" y2="${IMAGE_ZONE_H}"
              stroke="rgba(255,255,255,0.15)" stroke-width="2"/>
      </svg>`;
  }).join("");

  // Logo badges above text zone
  let logosHtml = "";
  if (input.logoBuffers) {
    const validLogos = input.logoBuffers.filter((b): b is Buffer => b !== null).slice(0, 3);
    if (validLogos.length > 0) {
      const BADGE_SIZE = 100;
      const BADGE_GAP = 16;
      logosHtml = `
        <div style="
          position: absolute;
          top: ${IMAGE_ZONE_H - BADGE_SIZE - 20}px;
          left: 0; right: 0;
          display: flex;
          justify-content: center;
          gap: ${BADGE_GAP}px;
          z-index: 30;
        ">
          ${validLogos.map((buf) => renderLogoBadgeHtml({
            dataUri: bufferToDataUri(buf),
            size: BADGE_SIZE,
            style: "full_color",
          })).join("")}
        </div>`;
    }
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  ${htmlHead()}
  <style>
    body { background: black; }
  </style>
</head>
<body>
  <div style="position: relative; width: ${W}px; height: ${SLIDE_H}px;">

    <!-- Image zone: 3 diagonal slivers -->
    <div style="position: relative; width: ${W}px; height: ${IMAGE_ZONE_H}px; overflow: hidden;">
      ${sliversHtml}
      ${separatorLines}
    </div>

    <!-- Gradient overlay on image zone bottom -->
    <div style="
      position: absolute;
      top: ${IMAGE_ZONE_H - 120}px;
      left: 0; right: 0;
      height: 120px;
      background: linear-gradient(to bottom, transparent, black);
      z-index: 10;
    "></div>

    <!-- Logo badges (rendered AFTER gradient so they're on top) -->
    ${logosHtml}

    <!-- Text zone (below image zone) -->
    <div style="
      position: absolute;
      top: ${IMAGE_ZONE_H}px;
      left: 0; right: 0;
      bottom: 0;
      background: black;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 0 48px;
      z-index: 20;
    ">
      <h1 class="font-anton" style="
        color: white;
        font-size: 64px;
        line-height: 1.08;
        letter-spacing: 1px;
        text-transform: uppercase;
        text-align: center;
        width: 100%;
        text-shadow: 3px 3px 6px rgba(0,0,0,0.5);
      ">${headlineHtml}</h1>

      <!-- Footer -->
      <div style="
        margin-top: 24px;
        display: flex;
        align-items: center;
        gap: 8px;
      ">
        <div style="
          width: 28px; height: 28px;
          border-radius: 50%;
          background: #10b981;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 700;
          color: white;
          font-family: 'Inter', sans-serif;
        ">AI</div>
        <span style="
          color: rgba(255,255,255,0.60);
          font-size: 18px;
          font-family: 'Inter', sans-serif;
          font-weight: 500;
        ">suggestedbygpt</span>
      </div>
    </div>

  </div>
</body>
</html>`;
}

// ─── Video Overlay Template ──────────────────────────────────────────────────
// Transparent PNG overlay for video slides.
// Top 70% is transparent (video shows through), bottom 30% is black with text.
// Captured with omitBackground: true for alpha transparency.

export interface VideoOverlayInput {
  headline: string;
  summary?: string;
  insightLine?: string;
}

export function generateVideoOverlayHtml(input: VideoOverlayInput): string {
  const headlineHtml = buildHighlightedHeadline(input.headline);

  // Summary HTML
  let summaryHtml = "";
  if (input.summary && input.summary.trim().length > 10) {
    summaryHtml = `
      <p style="
        color: rgba(255,255,255,0.85);
        font-family: 'Inter', Arial, sans-serif;
        font-size: 26px;
        line-height: 1.35;
        text-align: center;
        margin-top: 16px;
        max-width: 920px;
      ">${escapeHtml(input.summary.trim())}</p>`;
  }

  // Insight bubble
  let insightHtml = "";
  if (input.insightLine && input.insightLine.trim().length > 3) {
    insightHtml = `
      <div style="
        position: relative;
        background: rgba(255,255,255,0.92);
        border-radius: 12px;
        padding: 14px 24px;
        margin-top: 20px;
        max-width: 680px;
      ">
        <div style="
          position: absolute;
          top: -10px; left: 50%;
          transform: translateX(-50%);
          width: 0; height: 0;
          border-left: 10px solid transparent;
          border-right: 10px solid transparent;
          border-bottom: 10px solid rgba(255,255,255,0.92);
        "></div>
        <p style="
          color: #0a0a0a;
          font-family: 'Inter', Arial, sans-serif;
          font-size: 26px;
          font-weight: 600;
          text-align: center;
          line-height: 1.35;
          margin: 0;
        ">${escapeHtml(input.insightLine.trim())}</p>
      </div>`;
  }

  // The VIDEO_ZONE_H = 945px (70% of 1350)
  const VIDEO_ZONE_H = Math.round(SLIDE_H * 0.70);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  ${htmlHead()}
  <style>
    body { background: transparent; }
  </style>
</head>
<body>
  <div style="position: relative; width: ${SLIDE_W}px; height: ${SLIDE_H}px;">

    <!-- Top 70%: fully transparent (video shows through) -->

    <!-- Gradient transition: transparent to black (52% → 70%) -->
    <div style="
      position: absolute;
      top: 0; left: 0; right: 0;
      height: ${SLIDE_H}px;
      background: linear-gradient(to bottom,
        transparent 0%,
        transparent 52%,
        rgba(0,0,0,0.7) 62%,
        black 70%,
        black 100%
      );
    "></div>

    <!-- Text zone: bottom 30% -->
    <div style="
      position: absolute;
      top: ${VIDEO_ZONE_H + 20}px;
      left: 0; right: 0;
      bottom: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 0 48px;
      padding-bottom: 100px;
    ">
      <!-- Headline -->
      <h1 class="font-anton" style="
        color: white;
        font-size: 76px;
        line-height: 1.08;
        letter-spacing: 1px;
        text-transform: uppercase;
        text-align: center;
        width: 100%;
        text-shadow: 4px 4px 8px rgba(0,0,0,0.5);
      ">${headlineHtml}</h1>

      ${summaryHtml}
      ${insightHtml}
    </div>

    <!-- Watermark -->
    <div style="
      position: absolute;
      bottom: 88px; left: 52px;
      z-index: 10;
    ">
      <span style="
        color: rgba(255,255,255,0.60);
        font-family: 'Inter', Arial, sans-serif;
        font-size: 26px;
        font-weight: 700;
        letter-spacing: 1px;
      ">SuggestedByGPT</span>
    </div>

    <!-- Swipe hint -->
    <div style="
      position: absolute;
      bottom: 55px;
      left: 0; right: 0;
      text-align: center;
    ">
      <span style="
        color: rgba(255,255,255,0.75);
        font-family: 'Inter', Arial, sans-serif;
        font-size: 28px;
        font-weight: 700;
        letter-spacing: 5px;
      ">SWIPE FOR MORE &#x2192;</span>
    </div>

  </div>
</body>
</html>`;
}
