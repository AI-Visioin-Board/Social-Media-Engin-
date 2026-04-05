#!/usr/bin/env node
// ============================================================
// AINYCU Auto-Downloader + Remotion Assembly Trigger
//
// Watches Railway for completed AINYCU pipeline runs.
// When a NEW one finishes:
//   1. Downloads all assets (b-roll, script, avatar video) to local folder
//   2. Opens Claude Code in a new Terminal to assemble the Remotion video
//
// First launch: seeds state with all existing runs so only FUTURE
// completions trigger downloads. No historical backfill.
//
// Usage: Double-click "Start AINYCU Downloader.command" on Desktop
// ============================================================

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { execFileSync, execFile } from "node:child_process";

// ─── Configuration ──────────────────────────────────────────

const RAILWAY_URL = "https://social-media-engin-production.up.railway.app";
const OUTPUT_BASE = "/Users/test/Documents/Social-Media-Engin-/AVATAR PIPELINE/AI News You Can Use";
const REMOTION_PROJECT = "/Users/test/Documents/remotion-test";
const POLL_INTERVAL_MS = 30_000;
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

  let downloaded = loadDownloadedRuns();

  // On first launch (no state file), seed with ALL existing completed runs
  // so we only download truly new ones going forward.
  if (downloaded.size === 0) {
    console.log("  First launch — checking existing runs to skip...");
    try {
      const res = await fetch(`${RAILWAY_URL}/api/ainycu/completed-runs`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const { runs } = await res.json();
        for (const r of runs) downloaded.add(r.id);
        saveDownloadedRuns(downloaded);
        console.log(`  Seeded ${downloaded.size} existing runs (will NOT re-download these)`);
      }
    } catch (err) {
      console.error(`  Could not seed existing runs: ${err.message}`);
    }
  } else {
    console.log(`  Previously seen: ${downloaded.size} runs (skipping those)`);
  }

  console.log("  Watching for new completed runs...\n");

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

  // Only download the latest new run (not a batch of old ones)
  const latest = newRuns[newRuns.length - 1];

  // Mark all others as seen without downloading
  for (const r of newRuns) {
    if (r.id !== latest.id) {
      downloaded.add(r.id);
    }
  }

  console.log(`[${ts()}] ────────────────────────────────────────────`);
  console.log(`[${ts()}] NEW completed run #${latest.id}`);
  console.log(`         Topic: "${latest.topic}"`);
  console.log(`         Day: ${latest.dayNumber}`);
  console.log(`         B-roll files: ${latest.brollImageCount ?? "?"}`);
  console.log(`         Avatar video: ${latest.finalVideoUrl ? "YES" : "NO (manual)"}`);

  try {
    const outputDir = await downloadRun(latest);
    downloaded.add(latest.id);
    saveDownloadedRuns(downloaded);
    console.log(`[${ts()}] Download complete!`);

    notify(`Day ${latest.dayNumber} assets ready`, latest.topic ?? "New reel");
    launchClaudeCode(latest, outputDir);
  } catch (err) {
    console.error(`[${ts()}] Failed to download run #${latest.id}: ${err.message}`);
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
  const topicClean = (run.topic ?? "untitled").replace(/[^a-zA-Z0-9 ]/g, "");
  const dayNum = run.dayNumber ?? "?";
  const hasAvatar = !!run.finalVideoUrl;

  // ASCII-only prompt -- no em-dashes, arrows, or special chars that break osascript/Terminal
  const prompt = [
    `New AINYCU reel ready for Remotion assembly.`,
    ``,
    `Topic: "${topicClean}"`,
    `Day: ${dayNum}`,
    `Assets folder: ${outputDir}`,
    `Avatar video: ${hasAvatar ? "avatar-video.mp4 is in the assets folder" : "NOT YET -- needs green screen processing or HeyGen generation first"}`,
    ``,
    `IMPORTANT: Read these files first before doing anything:`,
    `  1. ${outputDir}/script.json -- the beat structure (layouts, narration, visual prompts, durations)`,
    `  2. ${REMOTION_PROJECT}/REEL_PRODUCTION_PROTOCOL.md -- the single source of truth for ALL reel creation rules`,
    ``,
    `Then execute the protocol IN ORDER:`,
    `  1. Copy all b-roll assets from the assets folder into remotion-test/public/ with a short topic prefix`,
    `  2. Visually inspect every b-roll image (Section 4) -- reject captcha pages, blank images, error pages`,
    `  3. If avatar-video.mp4 exists, run the 3-step green screen pipeline (Section 2): ffmpeg chromakey -> Python edge despill -> VP8 WebM encode`,
    `  4. Extract audio from avatar video -> WAV, then run Whisper for word-level captions JSON (Section 3)`,
    `  5. MANDATORY: Execute Creative Director visual planning (Section 6) BEFORE writing any code:`,
    `     a. Extract Power Noun from each beat (the single most important word)`,
    `     b. Look up each Power Noun exact startMs in the captions JSON`,
    `     c. Assign visual triggers using the decision tree (Section 6.4)`,
    `     d. Run asset gap analysis -- can existing b-roll serve each trigger?`,
    `     e. Negative space check -- max 2 visual layers at once`,
    `     f. Output the Visual Trigger Schema as a SCENES array`,
    `  6. Create a new Remotion composition in remotion-test/src/ following the protocol exactly`,
    `     - Use shared components: GlassTVFrame.tsx, DeviceMockup.tsx, IconGrid.tsx, AinycuIntro.tsx`,
    `     - Use brand constants from brand.ts and spring presets`,
    `     - Use useVisualTrigger hook for syllabic sync -- animations fire on Power Noun startMs, NOT scene boundaries`,
    `     - Layout sequence from script.json beats (avatar_closeup, pip, device_mockup, icon_grid, text_card, motion_graphic)`,
    `  7. Register the new composition in Root.tsx (1080x1920, 30fps)`,
    `  8. Type-check: npx tsc --noEmit`,
    `  9. Start Remotion Studio for preview: npx remotion studio`,
  ].join("\n");

  console.log(`[${ts()}] Launching Claude Code for Remotion assembly...`);

  // Write prompt file
  const promptFile = join(outputDir, ".claude-prompt.txt");
  writeFileSync(promptFile, prompt, "utf-8");

  // Step 1: Copy all assets into the Remotion project so Claude Code can access them
  //         (Claude Code's working dir is remotion-test -- it can't read outside it)
  const topicPrefix = sanitize(run.topic ?? "reel").slice(0, 30).toLowerCase();
  const assetsInProject = join(REMOTION_PROJECT, "assets-input");
  mkdirSync(assetsInProject, { recursive: true });
  // Copy every file from outputDir into remotion-test/assets-input/
  const assetFiles = execFileSync("ls", ["-1", outputDir]).toString().trim().split("\n")
    .filter(f => !f.startsWith("."));
  for (const f of assetFiles) {
    execFileSync("cp", ["-f", join(outputDir, f), join(assetsInProject, f)]);
  }
  console.log(`[${ts()}] Copied ${assetFiles.length} assets to ${assetsInProject}`);

  // Rewrite prompt to reference the local assets-input folder
  const localPrompt = prompt
    .replace(new RegExp(outputDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "g"), assetsInProject);
  const promptFile2 = join(REMOTION_PROJECT, ".claude-prompt.txt");
  writeFileSync(promptFile2, localPrompt, "utf-8");

  // Write a self-contained shell script that:
  //   1. Sets PATH so node/npx are found
  //   2. cd to the Remotion project
  //   3. Pipes the prompt into Claude Code in non-interactive mode
  //   4. Logs output to a file AND to the terminal
  const logFile = join(outputDir, ".claude-output.log");
  const launchScript = join(REMOTION_PROJECT, ".run-claude.sh");
  writeFileSync(launchScript, [
    `#!/bin/bash`,
    `export PATH="/usr/local/Cellar/node/25.6.1_1/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"`,
    `cd "${REMOTION_PROJECT}"`,
    `echo "============================================"`,
    `echo "  AINYCU Remotion Assembly"`,
    `echo "  Topic: ${topicClean}"`,
    `echo "  Assets: ${assetsInProject}"`,
    `echo "  Log: ${logFile}"`,
    `echo "============================================"`,
    `echo ""`,
    `echo "Starting Claude Code (fully automated)..."`,
    `echo ""`,
    `cat "${promptFile2}" | npx -y @anthropic-ai/claude-code -- -p --dangerously-skip-permissions 2>&1 | tee "${logFile}"`,
    `echo ""`,
    `echo "============================================"`,
    `echo "  Claude Code finished. Check output above."`,
    `echo "  Log saved to: ${logFile}"`,
    `echo "============================================"`,
  ].join("\n"), "utf-8");
  chmodSync(launchScript, 0o755);

  // Launch in a new Terminal window via osascript
  // Launch script is now inside remotion-test (no spaces in path)
  const appleScript = `tell application "Terminal"
  activate
  do script "bash ${launchScript}"
end tell`;

  execFile("osascript", ["-e", appleScript], (err) => {
    if (err) {
      console.error(`[${ts()}] Could not launch Claude Code: ${err.message}`);
      console.log(`[${ts()}] Run manually:`);
      console.log(`         ${launchScript}`);
    } else {
      console.log(`[${ts()}] Claude Code launched in new Terminal window!`);
      console.log(`         Prompt: ${promptFile}`);
      console.log(`         Log:    ${logFile}`);
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
