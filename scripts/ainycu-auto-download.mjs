#!/usr/bin/env node
// ============================================================
// AINYCU Auto-Downloader + Remotion Auto-Trigger
//
// Watches Railway for completed AINYCU pipeline runs.
// When one finishes:
//   1. Downloads all assets (b-roll, script, avatar video) to local folder
//   2. Opens a new Terminal with Claude Code to start assembling the Remotion video
//
// Usage: Double-click "Start AINYCU Downloader.command" on Desktop
// ============================================================

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { execFileSync, execFile } from "node:child_process";

// ─── Configuration ──────────────────────────────────────────

const RAILWAY_URL = "https://social-media-engin-production.up.railway.app";
const OUTPUT_BASE = "/Users/test/Documents/AVATAR PIPELINE/AI News You Can Use";
const REMOTION_PROJECT = "/Users/test/Documents/remotion-test";
const POLL_INTERVAL_MS = 30_000; // Check every 30 seconds
const STATE_FILE = join(OUTPUT_BASE, ".downloaded-runs.json");

// ─── State Management ───────────────────────────────────────

function loadDownloadedRuns() {
  try {
    if (existsSync(STATE_FILE)) {
      return new Set(JSON.parse(readFileSync(STATE_FILE, "utf-8")));
    }
  } catch { /* fresh start */ }
  return new Set();
}

function saveDownloadedRuns(downloaded) {
  mkdirSync(OUTPUT_BASE, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify([...downloaded]), "utf-8");
}

// ─── Main Loop ──────────────────────────────────────────────

async function main() {
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   AINYCU Auto-Downloader + Remotion Assembly Trigger    ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("");
  console.log(`  Output folder : ${OUTPUT_BASE}`);
  console.log(`  Remotion proj : ${REMOTION_PROJECT}`);
  console.log(`  Railway server: ${RAILWAY_URL}`);
  console.log(`  Polling every : ${POLL_INTERVAL_MS / 1000}s`);
  console.log("");

  const downloaded = loadDownloadedRuns();
  if (downloaded.size > 0) {
    console.log(`  Previously downloaded: ${downloaded.size} runs (skipping those)`);
  }
  console.log("  Waiting for new completed runs...\n");

  while (true) {
    try {
      await checkForNewRuns(downloaded);
    } catch (err) {
      console.error(`[${ts()}] Poll error: ${err.message}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

async function checkForNewRuns(downloaded) {
  const res = await fetch(`${RAILWAY_URL}/api/ainycu/completed-runs`, {
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    console.error(`[${ts()}] Server returned ${res.status}`);
    return;
  }

  const { runs } = await res.json();
  const newRuns = runs.filter((r) => !downloaded.has(r.id));

  if (newRuns.length === 0) return;

  for (const run of newRuns) {
    console.log(`[${ts()}] ────────────────────────────────────────────`);
    console.log(`[${ts()}] NEW completed run #${run.id}`);
    console.log(`         Topic: "${run.topic}"`);
    console.log(`         Day: ${run.dayNumber}`);
    console.log(`         B-roll files: ${run.brollImageCount ?? "?"}`);
    console.log(`         Avatar video: ${run.finalVideoUrl ? "YES" : "NO (manual)"}`);

    try {
      const outputDir = await downloadRun(run);
      downloaded.add(run.id);
      saveDownloadedRuns(downloaded);
      console.log(`[${ts()}] Download complete!`);

      // macOS notification
      notify(`Day ${run.dayNumber} assets ready`, run.topic ?? "New reel");

      // Launch Claude Code in a new Terminal window to start Remotion assembly
      launchClaudeCode(run, outputDir);

    } catch (err) {
      console.error(`[${ts()}] Failed to download run #${run.id}: ${err.message}`);
    }
  }
}

async function downloadRun(run) {
  const folderName = sanitize(run.topic ?? `run-${run.id}`);
  const outputDir = join(OUTPUT_BASE, folderName);
  mkdirSync(outputDir, { recursive: true });

  console.log(`         Downloading ZIP from Railway...`);
  const zipUrl = `${RAILWAY_URL}/api/download-assets/ainycu/${run.id}`;
  const zipRes = await fetch(zipUrl, { signal: AbortSignal.timeout(300_000) });

  if (!zipRes.ok) {
    throw new Error(`ZIP download failed: HTTP ${zipRes.status}`);
  }

  const zipPath = join(outputDir, "__download.zip");
  const fileStream = createWriteStream(zipPath);
  await pipeline(Readable.fromWeb(zipRes.body), fileStream);

  const zipBytes = readFileSync(zipPath).length;
  console.log(`         ZIP: ${Math.round(zipBytes / 1024 / 1024)}MB — extracting...`);

  execFileSync("unzip", ["-o", "-j", zipPath, "-d", outputDir], { stdio: "pipe" });
  execFileSync("rm", ["-f", zipPath]);

  const listing = execFileSync("ls", ["-1", outputDir]).toString().trim().split("\n");
  console.log(`         ${listing.length} files:`);
  for (const f of listing) {
    if (!f.startsWith(".")) console.log(`           ${f}`);
  }

  return outputDir;
}

// ─── Launch Claude Code for Remotion Assembly ───────────────

function launchClaudeCode(run, outputDir) {
  const topicClean = (run.topic ?? "untitled").replace(/"/g, '\\"');
  const dayNum = run.dayNumber ?? "?";
  const hasAvatar = !!run.finalVideoUrl;

  // Build the prompt that Claude Code will receive
  const prompt = [
    `New AINYCU reel ready for Remotion assembly.`,
    ``,
    `Topic: "${topicClean}"`,
    `Day: ${dayNum}`,
    `Assets folder: ${outputDir}`,
    `Avatar video: ${hasAvatar ? "avatar-video.mp4 (in folder)" : "NOT YET — create in HeyGen UI first"}`,
    ``,
    `Steps:`,
    `1. Read script.json from the assets folder to understand the beat structure`,
    `2. Copy all b-roll assets into remotion-test/public/ with a short prefix`,
    `3. Create a new Remotion composition in remotion-test/src/ following the REEL_PRODUCTION_PROTOCOL.md`,
    `4. Register it in Root.tsx`,
    `5. Start Remotion Studio so I can preview`,
    ``,
    `Use the existing LayersReel or CanvaReel compositions as reference for the component structure.`,
    `The composition should use the standard AINYCU layout: avatar closeups, PIP scenes, device mockups, icon grids, and text cards.`,
  ].join("\n");

  console.log(`[${ts()}] Launching Claude Code for Remotion assembly...`);

  // Open a new Terminal window, cd to remotion project, and start Claude Code with the prompt
  const appleScript = `
tell application "Terminal"
  activate
  set newTab to do script "cd '${REMOTION_PROJECT}' && export PATH=\\"/usr/local/Cellar/node/25.6.1_1/bin:/usr/local/bin:/opt/homebrew/bin:$PATH\\" && echo 'Starting Claude Code for: ${topicClean.replace(/'/g, "")}...' && npx @anthropic-ai/claude-code --print '${prompt.replace(/'/g, "\\'")}'"
end tell
`;

  // Fire and forget — don't block the downloader
  execFile("osascript", ["-e", appleScript], (err) => {
    if (err) {
      console.error(`[${ts()}] Could not launch Claude Code: ${err.message}`);
      console.log(`[${ts()}] You can start it manually:`);
      console.log(`         cd ${REMOTION_PROJECT}`);
      console.log(`         npx @anthropic-ai/claude-code`);
    } else {
      console.log(`[${ts()}] Claude Code launched in new Terminal window!`);
    }
  });
}

// ─── Helpers ────────────────────────────────────────────────

function notify(title, body) {
  try {
    const bodyClean = (body ?? "").replace(/['"]/g, "");
    const titleClean = (title ?? "").replace(/['"]/g, "");
    execFileSync("osascript", [
      "-e",
      `display notification "${bodyClean}" with title "${titleClean}" sound name "Glass"`,
    ]);
  } catch { /* notification is optional */ }
}

function sanitize(topic) {
  return topic
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80)
    .replace(/^-|-$/g, "");
}

function ts() {
  return new Date().toLocaleTimeString("en-US", { hour12: true, hour: "numeric", minute: "2-digit" });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Start ──────────────────────────────────────────────────
main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
