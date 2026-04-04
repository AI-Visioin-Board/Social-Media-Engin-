// ============================================================
// Asset Download Endpoint
//
// Fetches b-roll assets from their original URLs (stored in DB)
// and streams a zip file containing all assets + script.
//
// Works regardless of Railway filesystem state because it
// re-downloads from the source URLs (Pexels, Nano Banana, etc.)
//
// Endpoints:
//   GET /api/download-assets/avatar/:runId   → zip of captions pipeline run
//   GET /api/download-assets/ainycu/:runId   → zip of AINYCU pipeline run
// ============================================================

import type { Express, Request, Response } from "express";
import archiver from "archiver";
import { eq } from "drizzle-orm";
import { getDb } from "./db.js";
import { avatarRuns, ainycuRuns } from "../drizzle/schema.js";

interface AssetEntry {
  url: string;
  source: string;
  mediaType: string;
}

async function streamRunAssets(
  res: Response,
  script: any,
  assets: Record<string, AssetEntry>,
  folderName: string,
  pipelineType: "captions" | "ainycu",
  avatarVideoUrl?: string | null,
) {
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${folderName}.zip"`);

  const archive = archiver("zip", { zlib: { level: 5 } });
  archive.pipe(res);

  // Add script files
  const narrationText = script.beats.map((b: any) => b.narration).join("\n\n");
  archive.append(narrationText, { name: `${folderName}/script.txt` });
  archive.append(JSON.stringify(script, null, 2), { name: `${folderName}/script.json` });

  // Download and add each b-roll asset
  let imageNumber = 1;
  for (const beat of script.beats) {
    if (beat.layout === "avatar_closeup" || beat.layout === "text_card") continue;
    const asset = assets[beat.id];
    if (!asset?.url) continue;

    try {
      const response = await fetch(asset.url);
      if (!response.ok) {
        console.warn(`[AssetDownload] Beat ${beat.id}: HTTP ${response.status} from ${asset.url}`);
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const ext = asset.mediaType === "video" ? "mp4"
        : asset.url.includes(".jpg") || asset.url.includes(".jpeg") ? "jpg" : "png";

      let filename: string;
      if (pipelineType === "ainycu") {
        // Descriptive naming for AINYCU
        const markerMatch = beat.narration?.match(/\[(HOOK|DAYTAG|BRIDGE|STEP\d|SOWHAT|SIGNOFF)\]/i);
        const section = markerMatch?.[1]?.toLowerCase() ?? `beat${beat.id}`;
        const desc = (beat.visualPrompt ?? "")
          .replace(/https?:\/\/[^\s]+/g, "")
          .replace(/[^a-zA-Z0-9\s-]/g, "")
          .replace(/\s+/g, "-")
          .toLowerCase()
          .slice(0, 40)
          .replace(/-+$/, "");
        const duration = `${Math.round(beat.durationSec)}s`;
        filename = desc
          ? `${imageNumber}--${section}--${desc}--${duration}.${ext}`
          : `${imageNumber}.${ext}`;
      } else {
        // Simple numbered naming for captions
        filename = `${imageNumber}.${ext}`;
      }

      archive.append(buffer, { name: `${folderName}/${filename}` });
      imageNumber++;
    } catch (err: any) {
      console.error(`[AssetDownload] Beat ${beat.id}: download failed: ${err.message}`);
    }
  }

  // Include avatar video if available (HeyGen template output)
  if (avatarVideoUrl) {
    try {
      console.log(`[AssetDownload] Downloading avatar video from HeyGen...`);
      const avResponse = await fetch(avatarVideoUrl);
      if (avResponse.ok) {
        const avBuffer = Buffer.from(await avResponse.arrayBuffer());
        archive.append(avBuffer, { name: `${folderName}/avatar-video.mp4` });
        console.log(`[AssetDownload] Avatar video added to ZIP (${Math.round(avBuffer.length / 1024 / 1024)}MB)`);
      }
    } catch (err: any) {
      console.error(`[AssetDownload] Avatar video download failed: ${err.message}`);
    }
  }

  await archive.finalize();
}

function sanitizeTopicName(title: string): string {
  return title
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80)
    .replace(/-+$/, "");
}

export function registerAssetDownloadEndpoints(app: Express) {
  // ─── Captions pipeline (avatar_runs table) ──────────────────
  app.get("/api/download-assets/avatar/:runId", async (req: Request, res: Response) => {
    try {
      const runId = parseInt(req.params.runId);
      if (isNaN(runId)) { res.status(400).json({ error: "Invalid runId" }); return; }

      const db = await getDb();
      if (!db) { res.status(500).json({ error: "Database unavailable" }); return; }

      const rows = await db.select().from(avatarRuns).where(eq(avatarRuns.id, runId)).limit(1);
      const run = rows[0];
      if (!run) { res.status(404).json({ error: "Run not found" }); return; }
      if (!run.scriptJson || !run.assetMap) {
        res.status(400).json({ error: "Run has no script or assets yet" });
        return;
      }

      const script = JSON.parse(run.scriptJson);
      const assets = JSON.parse(run.assetMap);
      const folderName = sanitizeTopicName(run.topic ?? `run-${runId}`);

      await streamRunAssets(res, script, assets, folderName, "captions");
    } catch (err: any) {
      console.error("[AssetDownload] Avatar download failed:", err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });

  // ─── AINYCU pipeline (ainycu_runs table) ────────────────────
  app.get("/api/download-assets/ainycu/:runId", async (req: Request, res: Response) => {
    try {
      const runId = parseInt(req.params.runId);
      if (isNaN(runId)) { res.status(400).json({ error: "Invalid runId" }); return; }

      const db = await getDb();
      if (!db) { res.status(500).json({ error: "Database unavailable" }); return; }

      const rows = await db.select().from(ainycuRuns).where(eq(ainycuRuns.id, runId)).limit(1);
      const run = rows[0];
      if (!run) { res.status(404).json({ error: "Run not found" }); return; }
      if (!run.scriptJson || !run.assetMap) {
        res.status(400).json({ error: "Run has no script or assets yet" });
        return;
      }

      const script = JSON.parse(run.scriptJson);
      const assets = JSON.parse(run.assetMap);
      const folderName = sanitizeTopicName(run.topic ?? `run-${runId}`);

      await streamRunAssets(res, script, assets, folderName, "ainycu", run.finalVideoUrl);
    } catch (err: any) {
      console.error("[AssetDownload] AINYCU download failed:", err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });

  // ─── AINYCU completed runs status (for local auto-downloader) ──
  // Returns recently completed runs so the local script knows what to download.
  app.get("/api/ainycu/completed-runs", async (_req: Request, res: Response) => {
    try {
      const db = await getDb();
      if (!db) { res.status(500).json({ error: "Database unavailable" }); return; }

      const rows = await db.select({
        id: ainycuRuns.id,
        status: ainycuRuns.status,
        topic: ainycuRuns.topic,
        dayNumber: ainycuRuns.dayNumber,
        finalVideoUrl: ainycuRuns.finalVideoUrl,
        brollImageCount: ainycuRuns.brollImageCount,
        updatedAt: ainycuRuns.updatedAt,
      })
        .from(ainycuRuns)
        .where(eq(ainycuRuns.status, "completed"))
        .orderBy(ainycuRuns.id)
        .limit(50);

      res.json({ runs: rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  console.log("[AssetDownload] Download endpoints registered: /api/download-assets/avatar/:runId, /api/download-assets/ainycu/:runId, /api/ainycu/completed-runs");
}
