/**
 * canvaCompositor.test.ts
 * Integration tests for the Canva-based slide assembly pipeline.
 *
 * Tests:
 * 1. Canva MCP CLI is reachable
 * 2. upload-asset-from-url works with a real image URL
 * 3. generate-design produces candidates
 * 4. create-design-from-candidate converts to editable design
 * 5. export-design (PNG) returns a valid URL
 * 6. assembleSlideWithCanva() full end-to-end returns an S3 URL
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// ─── Helper: call Canva MCP tool ──────────────────────────────────────────────
async function callCanvaTool(toolName: string, input: Record<string, unknown>): Promise<unknown> {
  const inputJson = JSON.stringify(input).replace(/'/g, "'\\''");
  const cmd = `manus-mcp-cli tool call ${toolName} --server canva --input '${inputJson}'`;
  const { stdout, stderr } = await execAsync(cmd, { timeout: 120_000 });
  const match = stdout.match(/Tool execution result:\s*\n([\s\S]+)/);
  if (!match) throw new Error(`No result in output. stderr: ${stderr}`);
  const resultText = match[1].trim();
  if (resultText.startsWith("Error:")) throw new Error(`Canva MCP error: ${resultText}`);
  return JSON.parse(resultText);
}

// ─── Test image URL (public, stable, direct HTTP 200 — no redirects) ─────────────────
// Unsplash CDN with auto=format returns HTTP 200 directly (no redirect).
// Append a unique cache-buster so Canva never rejects it as "already exists".
const TEST_IMAGE_URL =
  `https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=1080&h=1350&fit=crop&auto=format&t=${Date.now()}`;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Canva MCP CLI availability", () => {
  it("manus-mcp-cli is on PATH and responds", async () => {
    const { stdout } = await execAsync("manus-mcp-cli --help 2>&1 || true");
    expect(stdout.length).toBeGreaterThan(0);
  }, 15_000);

  it("canva server tool list is accessible", async () => {
    const { stdout } = await execAsync("manus-mcp-cli tool list --server canva 2>&1");
    expect(stdout).toContain("upload-asset-from-url");
    expect(stdout).toContain("generate-design");
    expect(stdout).toContain("export-design");
  }, 30_000);
});

describe("Canva MCP: upload-asset-from-url", () => {
  it("uploads a public image URL and returns an asset ID", async () => {
    const result = await callCanvaTool("upload-asset-from-url", {
      name: `test-asset-${Date.now()}`,
      url: TEST_IMAGE_URL,
      user_intent: "Test upload for canvaCompositor integration test",
    }) as any;

    expect(result?.job?.status).toBe("success");
    expect(result?.job?.asset?.id).toBeTruthy();
    console.log("✅ Upload asset ID:", result.job.asset.id);
  }, 60_000);
});

describe("Canva MCP: generate-design → create-from-candidate → export", () => {
  // Wait 10s before this suite to avoid Canva rate limiting from the previous upload test
  beforeAll(() => new Promise((r) => setTimeout(r, 10_000)));

  it("generates a design, converts candidate, and exports as PNG", async () => {
    // Step 1: Upload asset
    const uploadResult = await callCanvaTool("upload-asset-from-url", {
      name: `test-slide-${Date.now()}`,
      url: TEST_IMAGE_URL,
      user_intent: "Test slide generation for canvaCompositor",
    }) as any;

    expect(uploadResult?.job?.status).toBe("success");
    const assetId = uploadResult.job.asset.id;

    // Step 2: Generate design
    const generateResult = await callCanvaTool("generate-design", {
      design_type: "instagram_post",
      query: "OPENAI JUST RELEASED A MODEL THAT CODES BETTER THAN 99% OF ENGINEERS — full bleed background image, bold ALL CAPS white headline, dark gradient overlay, @evolving.ai style, cinematic, dramatic",
      asset_ids: [assetId],
      user_intent: "Generate @evolving.ai-style Instagram slide for SuggestedByGPT",
    }) as any;

    expect(generateResult?.job?.status).toBe("success");
    const candidates = generateResult?.job?.result?.generated_designs ?? [];
    expect(candidates.length).toBeGreaterThan(0);
    console.log(`✅ Generated ${candidates.length} design candidates`);

    const jobId = generateResult.job.id;
    const bestCandidate = candidates[0];

    // Step 3: Create editable design from candidate
    const createResult = await callCanvaTool("create-design-from-candidate", {
      job_id: jobId,
      candidate_id: bestCandidate.candidate_id,
      user_intent: "Convert to editable design for export",
    }) as any;

    const designId = createResult?.design_summary?.id;
    expect(designId).toBeTruthy();
    console.log("✅ Design ID:", designId);

    // Step 4: Export as PNG
    const exportResult = await callCanvaTool("export-design", {
      design_id: designId,
      format: { type: "png" },
      user_intent: "Export Instagram slide as PNG",
    }) as any;

    expect(exportResult?.job?.status).toBe("success");
    const exportUrls: string[] = exportResult?.job?.urls ?? [];
    expect(exportUrls.length).toBeGreaterThan(0);
    expect(exportUrls[0]).toMatch(/^https?:\/\//);
    console.log("✅ Export URL:", exportUrls[0].slice(0, 80) + "...");
  }, 180_000); // 3 min timeout for full Canva flow
});

// NOTE: assembleSlideWithCanva() end-to-end test removed — Sharp compositor is now primary.
// Canva MCP is kept as an optional integration but not used in the production pipeline.
