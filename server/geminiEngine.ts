/**
 * geminiEngine.ts
 *
 * Gemini-powered Creative Director, image generation, and video generation.
 * Replaces the OpenAI-based Creative Director + DALL-E/Kling pipeline with
 * Google's Gemini API for all media generation after topic research.
 *
 * Uses: @google/genai SDK (v1.44+)
 * Models:
 *   - gemini-3.1-pro-preview: Creative Director (structured JSON output)
 *   - gemini-3.1-flash-image-preview: Image generation (Nano Banana)
 *   - veo-3.1-fast-generate-preview: Video generation (5s clip)
 *   - veo-3.1-generate-preview: Video extension (5s → 10s)
 */

import { GoogleGenAI, Type } from "@google/genai";
import { ENV } from "./_core/env";
import type { ResearchedTopic } from "./contentPipeline";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GeminiCreativeBrief {
  coverHeadline: string;
  coverImagePrompt: string;
  slides: Array<{
    headline: string;
    summary: string;
    imagePrompt: string;
  }>;
}

export interface VideoResult {
  type: "video" | "image";
  buffer: Buffer;
}

// ─── Shared Initialization ──────────────────────────────────────────────────

let _cachedClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (_cachedClient) return _cachedClient;
  const apiKey = ENV.geminiApiKey;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set — cannot run Gemini pipeline");
  }
  _cachedClient = new GoogleGenAI({ apiKey });
  return _cachedClient;
}

// ─── Creative Director ──────────────────────────────────────────────────────

/**
 * Run the Gemini Creative Director: takes researched topics and produces
 * a structured creative brief with cover headline, cover image prompt,
 * and per-slide headlines + summaries + image prompts.
 *
 * Uses the 10-Part PROMPTHIS Framework for maximum image quality.
 */
export async function geminiCreativeDirector(
  topics: ResearchedTopic[],
  log: (msg: string, data?: any) => void,
  checkAbort: () => void,
): Promise<GeminiCreativeBrief> {
  checkAbort();
  const ai = getGeminiClient();

  log("Gemini Creative Director: Analyzing stories and writing prompts...");

  const topicSummary = topics.map((t, i) => ({
    index: i + 1,
    title: t.title,
    headline: t.headline,
    summary: t.summary,
    insightLine: t.insightLine ?? null,
  }));

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: `You are the Creative Director and lead gossip columnist for a highly viral, salacious AI news Instagram page called SuggestedByGPT. You deliver news with a punchy, dramatic, and emotion-evoking tone.

I will give you ${topics.length} news stories.

Task 1: Write a SCROLL-STOPPING, ALL-CAPS cover headline (max 12 words) that synthesizes these stories. Use curiosity gaps, FOMO, or disbelief hooks.

Task 2: Write an image prompt for the COVER SLIDE. This MUST be a comical, salacious, eye-capturing composite featuring the main subjects (CEOs, politicians, AI entities) from the stories interacting in a dramatic or absurd way. Include relevant company logos if applicable.

Task 3: For EACH of the ${topics.length} stories, write:
- A punchy ALL-CAPS headline (max 10 words)
- A 1-2 sentence summary for the slide text
- An image prompt for that slide

CRITICAL REQUIREMENT — The 10-Part PROMPTHIS Framework:
EVERY single image prompt (Cover + Content slides) MUST be written as a single cohesive paragraph that explicitly includes ALL 10 of these elements:
1. SUBJECT — Main focus, specific and named (e.g., "Sam Altman, CEO of OpenAI, in his signature grey crewneck")
2. ACTION & CONTEXT — What is happening, the narrative moment (e.g., "leaning forward mid-argument")
3. ENVIRONMENT — Specific location (e.g., "a glass-walled boardroom overlooking a neon-lit Tokyo skyline at night")
4. MOOD & STORY — Emotional tone tied to the story (e.g., "corporate thriller tension, billion-dollar gamble")
5. VISUAL STYLE — Artistic reference (e.g., "Christopher Nolan cinematography", "Blade Runner 2049 aesthetic")
6. LIGHTING & COLOR — 2+ light sources with colors (e.g., "warm Rembrandt lighting from left, soft cyan rim light on shoulders")
7. CAMERA & COMPOSITION — Shot type + lens + angle (e.g., "three-quarter shot, 85mm f/1.8, low angle looking up")
8. DETAIL & TEXTURE — Materials, surfaces, fabrics (e.g., "rain-slicked concrete, brushed steel desk, crisp wool suit")
9. QUALITY & REALISM — "ultra-photorealistic, editorial quality, 8K detail, RAW photograph look"
10. NEGATIVE CONSTRAINTS — What to exclude (e.g., "no messy text, no blurry elements. Company logos ARE allowed.")

Stories:
${JSON.stringify(topicSummary, null, 2)}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          coverHeadline: { type: Type.STRING },
          coverImagePrompt: { type: Type.STRING },
          slides: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                headline: { type: Type.STRING },
                summary: { type: Type.STRING },
                imagePrompt: { type: Type.STRING },
              },
              required: ["headline", "summary", "imagePrompt"],
            },
          },
        },
        required: ["coverHeadline", "coverImagePrompt", "slides"],
      },
    },
  });

  const brief: GeminiCreativeBrief = JSON.parse(response.text || "{}");

  // Validate
  if (!brief.coverHeadline || !brief.coverImagePrompt || !brief.slides?.length) {
    throw new Error("Gemini CD returned incomplete brief — missing coverHeadline, coverImagePrompt, or slides");
  }

  log("Gemini Creative Director: Brief generated.", {
    coverHeadline: brief.coverHeadline,
    slideCount: brief.slides.length,
  });

  return brief;
}

// ─── Image Generation ───────────────────────────────────────────────────────

/**
 * Generate a single image using Gemini's Nano Banana (flash-image-preview).
 * Returns a base64 data URI string.
 */
export async function geminiGenerateImage(
  prompt: string,
  log: (msg: string, data?: any) => void,
): Promise<string> {
  const ai = getGeminiClient();

  const res = await ai.models.generateContent({
    model: "gemini-3.1-flash-image-preview",
    contents: {
      parts: [{ text: prompt }],
    },
    config: {
      imageConfig: { aspectRatio: "3:4" },
    },
  });

  // Find the image part in the response
  for (const part of res.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
  }

  throw new Error("No image returned from Gemini flash-image-preview");
}

// ─── Video Generation ───────────────────────────────────────────────────────

/**
 * Generate a video using Veo 3.1 (fast 5s → extend to 10s).
 * Falls back to image generation if video fails.
 *
 * Returns { type, buffer } where type is 'video' or 'image' (fallback).
 */
export async function geminiGenerateVideo(
  prompt: string,
  log: (msg: string, data?: any) => void,
  checkAbort: () => void,
): Promise<VideoResult> {
  const ai = getGeminiClient();
  const apiKey = ENV.geminiApiKey;

  try {
    // Step 1: Generate initial 5s clip
    log("Gemini Video: Generating initial 5s clip (Veo 3.1 Fast)...");
    let operation = await ai.models.generateVideos({
      model: "veo-3.1-fast-generate-preview",
      prompt,
      config: {
        numberOfVideos: 1,
        resolution: "720p",
        aspectRatio: "9:16",
      },
    });

    // Poll until done
    while (!operation.done) {
      checkAbort();
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      operation = await ai.operations.getVideosOperation({ operation });
    }

    if (operation.error) {
      throw new Error(`Video generation failed: ${operation.error.message || JSON.stringify(operation.error)}`);
    }

    const firstVideo = operation.response?.generatedVideos?.[0]?.video;
    if (!firstVideo) {
      throw new Error("No video returned from Veo API");
    }

    // Step 2: Extend to 10s
    log("Gemini Video: Extending video to 10s (Veo 3.1)...");
    let extendOp = await ai.models.generateVideos({
      model: "veo-3.1-generate-preview",
      prompt,
      video: firstVideo,
      config: {
        numberOfVideos: 1,
        resolution: "720p",
        aspectRatio: "9:16",
      },
    });

    while (!extendOp.done) {
      checkAbort();
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      extendOp = await ai.operations.getVideosOperation({ operation: extendOp });
    }

    if (extendOp.error) {
      throw new Error(`Video extension failed: ${extendOp.error.message || JSON.stringify(extendOp.error)}`);
    }

    const downloadLink = extendOp.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) {
      throw new Error("No video URI returned from Veo API extension");
    }

    // Download the video
    const response = await fetch(downloadLink, {
      headers: { "x-goog-api-key": apiKey },
    });
    if (!response.ok) {
      throw new Error(`Video download failed: HTTP ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    log("Gemini Video: 10s video generated successfully.");
    return { type: "video", buffer: Buffer.from(arrayBuffer) };
  } catch (err: any) {
    console.error("[GeminiEngine] Veo video generation failed:", err?.message);
    log(`Gemini Video: Veo failed (${err?.message}), trying Kling fallback...`);

    // Fallback 1: Try Kling 2.5 Turbo
    try {
      const { generateKlingVideo } = await import("./contentPipeline");
      const klingAccessKey = ENV.klingAccessKey;
      const klingSecretKey = ENV.klingSecretKey;

      if (klingAccessKey && klingSecretKey) {
        log("Gemini Video: Attempting Kling 2.5 Turbo fallback...");
        const klingUrl = await generateKlingVideo(prompt, klingAccessKey, klingSecretKey);

        if (klingUrl) {
          log("Gemini Video: Kling video generated, downloading...");
          const response = await fetch(klingUrl, { signal: AbortSignal.timeout(30_000) });
          if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            log("Gemini Video: Kling fallback successful.");
            return { type: "video", buffer: Buffer.from(arrayBuffer) };
          }
        }
        log("Gemini Video: Kling returned no video, falling back to image...");
      } else {
        log("Gemini Video: No Kling API keys configured, falling back to image...");
      }
    } catch (klingErr: any) {
      console.error("[GeminiEngine] Kling fallback also failed:", klingErr?.message);
      log(`Gemini Video: Kling fallback failed (${klingErr?.message}), falling back to image...`);
    }

    // Fallback 2: Still image as last resort
    const imageBase64 = await geminiGenerateImage(prompt, log);
    const base64Data = imageBase64.split(",")[1];
    return { type: "image", buffer: Buffer.from(base64Data, "base64") };
  }
}
