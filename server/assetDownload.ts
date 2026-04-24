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
  shotIdx?: number;
}

function extFor(asset: { mediaType: string; url: string }): string {
  if (asset.mediaType === "video") {
    if (asset.url.includes(".webm")) return "webm";
    if (asset.url.includes(".mov")) return "mov";
    return "mp4";
  }
  if (asset.url.includes(".jpg") || asset.url.includes(".jpeg")) return "jpg";
  return "png";
}

function sectionOf(beat: any): string {
  if (beat.section) return String(beat.section).toLowerCase();
  const markerMatch = beat.narration?.match(/\[(HOOK|DAYTAG|BRIDGE|STEP\d|SOWHAT|SIGNOFF)\]/i);
  return markerMatch?.[1]?.toLowerCase() ?? `beat${beat.id}`;
}

function descOf(text: string | undefined): string {
  return (text ?? "")
    .replace(/https?:\/\/[^\s]+/g, "")
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 40)
    .replace(/-+$/, "");
}

async function streamRunAssets(
  res: Response,
  script: any,
  assets: Record<string, AssetEntry>,
  folderName: string,
  pipelineType: "captions" | "ainycu",
  avatarVideoUrl?: string | null,
  multiAssets?: Record<string, AssetEntry[]>,
) {
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${folderName}.zip"`);

  const archive = archiver("zip", { zlib: { level: 5 } });
  archive.pipe(res);

  // Add script files
  const narrationText = script.beats.map((b: any) => b.narration).join("\n\n");
  archive.append(narrationText, { name: `${folderName}/script.txt` });
  archive.append(JSON.stringify(script, null, 2), { name: `${folderName}/script.json` });

  let imageNumber = 1;

  // Helper: append one asset with the correct naming scheme (captions vs ainycu).
  // When shotIdx is provided, we also emit a per-shot tag so the Remotion
  // generator can wire assets to beat.shots[]. Names used by the generator:
  //   captions:  {beatId}.ext   or   {beatId}-{shotIdx}.ext
  //   ainycu:    {seq}--{section}[.s{shotIdx}]--{desc}--{dur}.ext
  //              (still parseable by generator's rich-name regex)
  const appendAsset = async (
    beat: any,
    asset: AssetEntry,
    shotIdx?: number,
    shotDurSec?: number,
  ): Promise<void> => {
    try {
      const response = await fetch(asset.url);
      if (!response.ok) {
        console.warn(`[AssetDownload] Beat ${beat.id}${shotIdx ? `/shot ${shotIdx}` : ""}: HTTP ${response.status}`);
        return;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const ext = extFor(asset);
      let filename: string;

      if (pipelineType === "ainycu") {
        const section = sectionOf(beat);
        const desc = descOf(beat.visualPrompt);
        const dur = `${Math.round(shotDurSec ?? beat.durationSec)}s`;
        const shotTag = shotIdx !== undefined ? `.s${shotIdx}` : "";
        filename = desc
          ? `${imageNumber}--${section}${shotTag}--${desc}--${dur}.${ext}`
          : `${beat.id}${shotIdx !== undefined ? `-${shotIdx}` : ""}.${ext}`;
      } else {
        // Captions pipeline: plain {beatId}[-{shotIdx}].ext for direct
        // consumption by generate-composition.ts.
        filename = shotIdx !== undefined
          ? `${beat.id}-${shotIdx}.${ext}`
          : `${imageNumber}.${ext}`;
      }

      archive.append(buffer, { name: `${folderName}/${filename}` });
      imageNumber++;
    } catch (err: any) {
      console.error(`[AssetDownload] Beat ${beat.id}${shotIdx ? `/shot ${shotIdx}` : ""}: download failed: ${err.message}`);
    }
  };

  // Download and add each b-roll asset — per-shot when available, else beat-level.
  for (const beat of script.beats) {
    if (beat.layout === "avatar_closeup" || beat.layout === "text_card") continue;
    if (beat.remotionOnly) continue;

    const hasShots = Array.isArray(beat.shots) && beat.shots.length > 0;
    const shotAssetsArr: AssetEntry[] | undefined = multiAssets?.[beat.id];

    if (hasShots && shotAssetsArr && shotAssetsArr.length > 0) {
      // Per-shot branch — one file per shot, tagged with shotIdx.
      // Match assets → shots by shotIdx (populated by the generator during
      // asset generation). Fall back to positional order when not available.
      const byIdx = new Map<number, AssetEntry>();
      for (const a of shotAssetsArr) {
        if (typeof a?.shotIdx === "number") byIdx.set(a.shotIdx, a);
      }
      let orderCursor = 0;
      for (const shot of beat.shots) {
        const asset =
          byIdx.get(shot.idx) ??
          shotAssetsArr[orderCursor] ??
          shotAssetsArr[shotAssetsArr.length - 1];
        orderCursor++;
        if (!asset?.url) continue;
        await appendAsset(beat, asset, shot.idx, shot.durationSec);
      }
      continue;
    }

    // Legacy beat-level branch
    const asset = assets[beat.id];
    if (!asset?.url) continue;
    await appendAsset(beat, asset);
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
      const multiAssets = run.multiAssetMap ? JSON.parse(run.multiAssetMap) : undefined;
      const folderName = sanitizeTopicName(run.topic ?? `run-${runId}`);

      await streamRunAssets(res, script, assets, folderName, "captions", undefined, multiAssets);
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
      const multiAssets = run.multiAssetMap ? JSON.parse(run.multiAssetMap) : undefined;
      const folderName = sanitizeTopicName(run.topic ?? `run-${runId}`);

      await streamRunAssets(res, script, assets, folderName, "ainycu", run.finalVideoUrl, multiAssets);
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
