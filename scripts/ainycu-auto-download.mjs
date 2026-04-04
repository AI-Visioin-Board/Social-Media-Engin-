#!/usr/bin/env node
// ============================================================
// AINYCU Auto-Downloader
//
// Watches Railway for completed AINYCU pipeline runs and
// automatically downloads all assets (b-roll, script, avatar
// video) to the local Avatar Pipeline folder.
//
// Usage: Double-click "Start AINYCU Downloader.command" on Desktop
// Or run: node scripts/ainycu-auto-download.mjs
// ============================================================

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { execFileSync } from "node:child_process";

// ─── Configuration ──────────────────────────────────────────

const RAILWAY_URL = "https://social-media-engin-production.up.railway.app";
const OUTPUT_BASE = "/Users/test/Documents/AVATAR PIPELINE/AI News You Can Use";
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
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   AINYCU Auto-Downloader — Watching Railway...  ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`  Output: ${OUTPUT_BASE}`);
  console.log(`  Server: ${RAILWAY_URL}`);
  console.log(`  Polling every ${POLL_INTERVAL_MS / 1000}s\n`);

  const downloaded = loadDownloadedRuns();
  console.log(`  Already downloaded: ${downloaded.size} runs\n`);

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

  if (newRuns.length === 0) {
    return;
  }

  for (const run of newRuns) {
    console.log(`\n[${ts()}] NEW completed run #${run.id}: "${run.topic}" (Day ${run.dayNumber})`);
    console.log(`  B-roll files: ${run.brollImageCount ?? "?"}`);
    console.log(`  Avatar video: ${run.finalVideoUrl ? "YES" : "NO (manual)"}`);

    try {
      await downloadRun(run);
      downloaded.add(run.id);
      saveDownloadedRuns(downloaded);
      console.log(`[${ts()}] Run #${run.id} downloaded successfully!`);

      // macOS notification
      try {
        const topicClean = (run.topic ?? "").replace(/['"]/g, "");
        execFileSync("osascript", [
          "-e",
          `display notification "Day ${run.dayNumber}: ${topicClean}" with title "AINYCU Download Complete" sound name "Glass"`,
        ]);
      } catch { /* notification is optional */ }
    } catch (err) {
      console.error(`[${ts()}] Failed to download run #${run.id}: ${err.message}`);
    }
  }
}

async function downloadRun(run) {
  const folderName = sanitize(run.topic ?? `run-${run.id}`);
  const outputDir = join(OUTPUT_BASE, folderName);
  mkdirSync(outputDir, { recursive: true });

  // Download the ZIP (contains b-roll + script + avatar video if available)
  console.log(`  Downloading ZIP from Railway...`);
  const zipUrl = `${RAILWAY_URL}/api/download-assets/ainycu/${run.id}`;
  const zipRes = await fetch(zipUrl, { signal: AbortSignal.timeout(300_000) }); // 5 min timeout

  if (!zipRes.ok) {
    throw new Error(`ZIP download failed: HTTP ${zipRes.status}`);
  }

  const zipPath = join(outputDir, "__download.zip");
  const fileStream = createWriteStream(zipPath);
  await pipeline(Readable.fromWeb(zipRes.body), fileStream);

  const zipBytes = readFileSync(zipPath).length;
  const zipSize = Math.round(zipBytes / 1024 / 1024);
  console.log(`  ZIP downloaded: ${zipSize}MB`);

  // Unzip — flatten into outputDir (ZIP contains a subfolder)
  console.log(`  Extracting to ${outputDir}...`);
  execFileSync("unzip", ["-o", "-j", zipPath, "-d", outputDir], { stdio: "pipe" });

  // Clean up ZIP file
  execFileSync("rm", ["-f", zipPath]);

  // List what we got
  const listing = execFileSync("ls", ["-1", outputDir]).toString().trim().split("\n");
  console.log(`  ${listing.length} files extracted:`);
  for (const f of listing) {
    if (!f.startsWith(".")) console.log(`     ${f}`);
  }
}

// ─── Helpers ────────────────────────────────────────────────

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
