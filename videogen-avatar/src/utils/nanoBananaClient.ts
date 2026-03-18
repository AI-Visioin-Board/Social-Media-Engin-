// ============================================================
// Nano Banana Client — Gemini Flash Image Preview
// Generates images of named people, logos, UIs, screenshots
// Model: gemini-3.1-flash-image-preview (same as parent repo)
// ============================================================

import { CONFIG } from "../config.js";

// Use the @google/genai SDK (already installed in parent repo)
// But we use REST API directly to avoid SDK version coupling

const MODEL = "gemini-3.1-flash-image-preview";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface NanoBananaResult {
  imageBase64: string;
  mimeType: string;
  width: number;
  height: number;
}

export async function generateImage(
  prompt: string,
  signal?: AbortSignal,
): Promise<NanoBananaResult> {
  if (!CONFIG.geminiApiKey) {
    throw new Error("[NanoBanana] GEMINI_API_KEY not configured");
  }

  const url = `${API_BASE}/${MODEL}:generateContent?key=${CONFIG.geminiApiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }],
      }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageSizeOptions: { aspectRatio: "3:4" },  // 3:4 close to 9:16
      },
    }),
    signal,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`[NanoBanana] Gemini API error (${response.status}): ${err}`);
  }

  const data = await response.json();

  // Extract image from response
  const parts = data.candidates?.[0]?.content?.parts;
  if (!parts || parts.length === 0) {
    const finishReason = data.candidates?.[0]?.finishReason ?? "unknown";
    throw new Error(`[NanoBanana] Gemini returned no content (finishReason: ${finishReason})`);
  }

  const imagePart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith("image/"));
  if (!imagePart) {
    const textParts = parts.filter((p: any) => p.text).map((p: any) => p.text).join(" ");
    throw new Error(`[NanoBanana] Gemini returned no image. Text response: "${textParts.slice(0, 200)}"`);
  }

  return {
    imageBase64: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType,
    width: 810,   // Nano Banana default for 3:4 aspect
    height: 1080,
  };
}

export function imageToDataUri(result: NanoBananaResult): string {
  return `data:${result.mimeType};base64,${result.imageBase64}`;
}

/**
 * Save image to local filesystem and return a file:// path.
 * For production, this would use storagePut() for a public URL.
 */
export async function saveImageToFile(
  result: NanoBananaResult,
  outputPath: string,
): Promise<string> {
  const { writeFile } = await import("node:fs/promises");
  const buffer = Buffer.from(result.imageBase64, "base64");
  await writeFile(outputPath, buffer);
  return outputPath;
}
