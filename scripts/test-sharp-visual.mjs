/**
 * Quick visual test: assemble one slide and open the result URL.
 * Run: node scripts/test-sharp-visual.mjs
 */
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";
import http from "http";
import os from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SLIDE_W = 1080;
const SLIDE_H = 1350;
const CYAN = "#00E5FF";

function wrapText(text, maxCharsPerLine) {
  const words = text.split(" ");
  const lines = [];
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
  return lines;
}

function escapeXml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function getHighlightedWords(headline) {
  const words = headline.split(" ");
  const highlighted = new Set();
  const powerWords = new Set(["ILLEGAL","SECRET","BANNED","EXPOSED","LEAKED","SHOCKING","INSANE","WILD","MASSIVE","BIGGEST","WORST","BEST","FIRST","NEVER","ALWAYS","EVERY","ALL","ZERO","DEAD","ALIVE","DANGEROUS","POWERFUL","REVOLUTIONARY","HISTORIC","UNPRECEDENTED","BREAKING","URGENT","CRITICAL","EXTREME","DESTROYED","REPLACED","ELIMINATED","SURPASSED","DEFEATED","UNSTOPPABLE","ACHIEVE","SUCCESS","FACTORY"]);
  for (const word of words) {
    const clean = word.replace(/[^A-Z0-9%]/g, "");
    if (powerWords.has(clean)) highlighted.add(word);
    if (/^\d+(\.\d+)?%$/.test(clean) || /^\d{2,}$/.test(clean)) highlighted.add(word);
  }
  if (highlighted.size === 0 && words.length >= 3) {
    highlighted.add(words[words.length - 1]);
    highlighted.add(words[words.length - 2]);
  }
  return highlighted;
}

function buildOverlaySvg(headline) {
  const upper = headline.toUpperCase();
  const lines = wrapText(upper, 16);
  const fontSize = lines.length <= 2 ? 108 : lines.length <= 3 ? 90 : 76;
  const lineHeight = fontSize * 1.15;
  const totalTextHeight = lines.length * lineHeight;
  const textBlockBottom = SLIDE_H - 160;
  const textStartY = textBlockBottom - totalTextHeight;
  const highlightedWords = getHighlightedWords(upper);
  const fontFamily = "Impact, 'Arial Black', sans-serif";

  const textLines = lines.map((line, i) => {
    const y = textStartY + i * lineHeight + fontSize;
    const words = line.split(" ");
    const hasHighlight = words.some(w => highlightedWords.has(w));
    if (!hasHighlight) {
      return `<tspan x="${SLIDE_W / 2}" y="${y}" fill="white">${escapeXml(line)}</tspan>`;
    }
    const parts = [];
    words.forEach((word, wi) => {
      const color = highlightedWords.has(word) ? CYAN : "white";
      if (wi === 0) {
        parts.push(`<tspan fill="${color}">${escapeXml(word)}</tspan>`);
      } else {
        parts.push(`<tspan fill="white">&#x20;</tspan><tspan fill="${color}">${escapeXml(word)}</tspan>`);
      }
    });
    return `<tspan x="${SLIDE_W / 2}" y="${y}" xml:space="preserve">${parts.join("")}</tspan>`;
  }).join("\n    ");

  const shadowLines = lines.map((line, i) => {
    const y = textStartY + i * lineHeight + fontSize;
    return `<tspan x="${SLIDE_W / 2}" y="${y}">${escapeXml(line)}</tspan>`;
  }).join("\n    ");

  return `<svg width="${SLIDE_W}" height="${SLIDE_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="black" stop-opacity="0"/>
      <stop offset="30%"  stop-color="black" stop-opacity="0"/>
      <stop offset="48%"  stop-color="black" stop-opacity="0.6"/>
      <stop offset="62%"  stop-color="black" stop-opacity="0.88"/>
      <stop offset="100%" stop-color="black" stop-opacity="0.98"/>
    </linearGradient>
  </defs>
  <rect x="0" y="${SLIDE_H * 0.30}" width="${SLIDE_W}" height="${SLIDE_H * 0.70}" fill="url(#grad)"/>
  <text font-family="${fontFamily}" font-size="${fontSize}" font-weight="bold" fill="black" fill-opacity="0.5" text-anchor="middle" letter-spacing="1" transform="translate(4,4)">
    ${shadowLines}
  </text>
  <text font-family="${fontFamily}" font-size="${fontSize}" font-weight="bold" text-anchor="middle" letter-spacing="1">
    ${textLines}
  </text>
  <text x="52" y="${SLIDE_H - 58}" font-family="'Arial', sans-serif" font-size="26" fill="white" fill-opacity="0.6" font-weight="bold" letter-spacing="1">SuggestedByGPT</text>
  <text x="${SLIDE_W / 2}" y="${SLIDE_H - 52}" font-family="'Arial', sans-serif" font-size="30" fill="white" fill-opacity="0.75" text-anchor="middle" letter-spacing="5">SWIPE FOR MORE →</text>
</svg>`;
}

async function downloadToTemp(url, ext) {
  const tmpPath = path.join(os.tmpdir(), `sbgpt-test-${Date.now()}.${ext}`);
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(tmpPath);
    const protocol = url.startsWith("https") ? https : http;
    protocol.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const proto2 = res.headers.location.startsWith("https") ? https : http;
        proto2.get(res.headers.location, (res2) => {
          res2.pipe(file);
          file.on("finish", () => { file.close(); resolve(tmpPath); });
          file.on("error", reject);
        }).on("error", reject);
      } else {
        res.pipe(file);
        file.on("finish", () => { file.close(); resolve(tmpPath); });
        file.on("error", reject);
      }
    }).on("error", reject);
  });
}

// Test with a real AI image
const testImageUrl = "https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=1080&h=1350&fit=crop&auto=format";
const headline = "XIAOMI HUMANOID ROBOTS ACHIEVE 90.2% SUCCESS IN EV FACTORY";

console.log("Downloading background image...");
const tmpFile = await downloadToTemp(testImageUrl, "jpg");
const bgBuffer = fs.readFileSync(tmpFile);
fs.unlinkSync(tmpFile);
console.log(`Background downloaded: ${bgBuffer.length} bytes`);

const svg = buildOverlaySvg(headline);
const outPath = path.join(os.tmpdir(), "test-slide-output.png");

await sharp(bgBuffer)
  .resize(SLIDE_W, SLIDE_H, { fit: "cover", position: "center" })
  .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
  .png({ quality: 92, compressionLevel: 5 })
  .toFile(outPath);

console.log(`\n✅ Test slide saved to: ${outPath}`);
console.log("File size:", fs.statSync(outPath).size, "bytes");
