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
 *   - veo-3.1-generate-preview: Video generation + extension (Gemini API)
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
    cinematicScore: number;
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
- A cinematicScore (1-10) rating how cinematic the image would look as a slow-motion video. Score HIGH (8-10) for: action shots, dramatic confrontations, physical movement, crowds, weather/particles, dynamic lighting. Score LOW (1-4) for: static portraits, logos, text-heavy concepts, abstract ideas.

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
                cinematicScore: { type: Type.NUMBER },
              },
              required: ["headline", "summary", "imagePrompt", "cinematicScore"],
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
  maxRetries = 2,
): Promise<string> {
  const ai = getGeminiClient();

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
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
    const parts = res.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData) {
        if (attempt > 1) log(`[Nano Banana] Succeeded on retry ${attempt}/${maxRetries}`);
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }

    // Log why Gemini refused
    const finishReason = res.candidates?.[0]?.finishReason ?? "unknown";
    const textParts = parts.filter((p) => p.text).map((p) => p.text).join(" ");
    const safetyRatings = JSON.stringify(res.candidates?.[0]?.safetyRatings ?? []);
    log(`[Nano Banana] Attempt ${attempt}/${maxRetries} — no image. finishReason=${finishReason}, text="${textParts.slice(0, 200)}", safety=${safetyRatings}`);

    if (attempt < maxRetries) {
      log(`[Nano Banana] Retrying in 3s...`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  throw new Error(`No image returned from Gemini flash-image-preview after ${maxRetries} attempts`);
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
    // Step 1: Generate initial 6s clip
    log("Gemini Video: Generating 6s clip (Veo 3.1)...");
    let operation = await ai.models.generateVideos({
      model: "veo-3.1-generate-preview",
      prompt,
      config: {
        numberOfVideos: 1,
        durationSeconds: 6,
        aspectRatio: "9:16",
      },
    });

    // Poll until done (max ~5 min)
    let genPolls = 0;
    while (!operation.done) {
      checkAbort();
      if (++genPolls > 30) throw new Error("Veo text2vid timed out after 5 min");
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      operation = await ai.operations.getVideosOperation({ operation });
    }

    if (operation.error) {
      throw new Error(`Video generation failed: ${operation.error.message || JSON.stringify(operation.error)}`);
    }

    // Diagnostic: log what Veo actually returned
    const generatedVideos = operation.response?.generatedVideos ?? [];
    log(`[Veo] Operation complete. generatedVideos count: ${generatedVideos.length}`);
    if (generatedVideos.length > 0) {
      const first = generatedVideos[0];
      log(`[Veo] First entry — hasVideo: ${!!first?.video}, uri: ${first?.video?.uri?.slice(0, 80) ?? "none"}`);
    } else {
      log(`[Veo] Full operation.response keys: ${JSON.stringify(Object.keys(operation.response ?? {}))}`);
      log(`[Veo] Full operation metadata: ${JSON.stringify(operation.metadata ?? {})}`);
    }

    const firstVideo = generatedVideos[0]?.video;
    if (!firstVideo) {
      throw new Error("No video returned from Veo API");
    }

    // Step 2: Extend via Veo
    log("Gemini Video: Extending video (Veo 3.1)...");
    let extendOp = await ai.models.generateVideos({
      model: "veo-3.1-generate-preview",
      prompt,
      video: firstVideo,
      config: {
        numberOfVideos: 1,
        durationSeconds: 8,
        aspectRatio: "9:16",
      },
    });

    let extPolls = 0;
    while (!extendOp.done) {
      checkAbort();
      if (++extPolls > 30) throw new Error("Veo extension timed out after 5 min");
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

/**
 * Generate a 5s video from an existing image using Veo 3.1 image-to-video.
 * The image provides the first frame; Veo adds cinematic motion.
 * Returns the video as a Buffer on success, null on failure.
 */
export async function geminiImageToVideo(
  prompt: string,
  imageBase64: string,
  log: (msg: string) => void,
  checkAbort: () => void,
): Promise<Buffer | null> {
  const ai = getGeminiClient();
  const apiKey = ENV.geminiApiKey;

  try {
    // Strip data URI prefix if present
    const raw = imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64;

    log("Veo img2vid: Generating 6s video from image...");
    let operation = await ai.models.generateVideos({
      model: "veo-3.1-generate-preview",
      prompt: `Subtle cinematic motion, slow zoom and gentle parallax. ${prompt}`,
      image: {
        imageBytes: raw,
        mimeType: "image/png",
      },
      config: {
        numberOfVideos: 1,
        durationSeconds: 6,
        aspectRatio: "9:16",
      },
    });

    // Poll until done (max ~5 min)
    let polls = 0;
    while (!operation.done) {
      checkAbort();
      if (++polls > 30) throw new Error("Veo img2vid timed out after 5 min");
      await new Promise((r) => setTimeout(r, 10_000));
      operation = await ai.operations.getVideosOperation({ operation });
    }

    if (operation.error) {
      throw new Error(`Veo img2vid failed: ${operation.error.message || JSON.stringify(operation.error)}`);
    }

    const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!videoUri) throw new Error("No video URI returned from Veo img2vid");

    const response = await fetch(videoUri, {
      headers: { "x-goog-api-key": apiKey },
    });
    if (!response.ok) throw new Error(`Video download failed: HTTP ${response.status}`);

    const arrayBuffer = await response.arrayBuffer();
    log("Veo img2vid: Video generated successfully.");
    return Buffer.from(arrayBuffer);
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    console.error("[GeminiEngine] Veo image-to-video failed:", msg);
    console.error("[GeminiEngine] Veo error stack:", err?.stack);
    console.error("[GeminiEngine] Veo error details:", JSON.stringify({
      name: err?.name,
      status: err?.status,
      code: err?.code,
      cause: err?.cause?.message,
    }));
    log(`Veo img2vid failed: ${msg}`);
    return null;
  }
}
