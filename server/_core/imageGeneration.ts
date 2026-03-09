/**
 * Image generation — multi-model pipeline
 *
 * - generateImage()              → DALL-E 3 for scenes/environments (ZERO people)
 * - generateImageWithPeople()    → GPT Image 1 fallback (kept for backward compat)
 * - generateImageWithNanoBanana() → Nano Banana (Gemini) for named public figures ★ PRIMARY
 *
 * ★ KEY RULE: Named public figures MUST use Nano Banana (Gemini).
 *   GPT Image 1 REFUSES to generate recognizable people.
 *   DALL-E 3 produces bad faces. Neither works for our use case.
 *   Nano Banana is the ONLY model that reliably generates named people (confirmed by Maximus).
 *
 * Example usage:
 *   const { url } = await generateImage({ prompt: "A futuristic city at sunset" });
 *   const { url } = await generateImageWithNanoBanana({
 *     prompt: "Elon Musk and Tim Cook boxing in a ring, dramatic sports lighting",
 *   });
 */
import { storagePut } from "../storage";
import { ENV } from "./env";

export type GenerateImageOptions = {
  prompt: string;
  originalImages?: Array<{
    url?: string;
    b64Json?: string;
    mimeType?: string;
  }>;
};

export type GenerateImageResponse = {
  url?: string;
};

/**
 * Generate an image using DALL-E 3.
 * Best for: environments, scenes, abstract visuals (cannot generate named real people).
 */
export async function generateImage(
  options: GenerateImageOptions
): Promise<GenerateImageResponse> {
  if (!ENV.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  // 60-second timeout — image generation should not hang indefinitely
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ENV.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: "dall-e-3",
      prompt: options.prompt,
      n: 1,
      size: "1024x1792",
      response_format: "b64_json",
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Image generation failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
    );
  }

  const result = (await response.json()) as {
    data: Array<{ b64_json: string; revised_prompt?: string }>;
  };

  const base64Data = result.data[0].b64_json;
  const buffer = Buffer.from(base64Data, "base64");

  // Save to local storage
  const { url } = await storagePut(
    `generated/${Date.now()}.png`,
    buffer,
    "image/png"
  );

  return { url };
}

/**
 * Generate a photorealistic image of named public figures using Nano Banana (Gemini).
 *
 * ★ This is the PRIMARY model for generating recognizable people.
 * Uses Gemini 3 Pro Image Preview (Nano Banana Pro) — confirmed by Maximus to
 * reliably render named public figures like Elon Musk, Tim Cook, Sam Altman, etc.
 *
 * Falls back to GPT Image 1 if GEMINI_API_KEY is not set.
 *
 * Model priority: gemini-3-pro-image-preview (Nano Banana Pro, highest quality)
 * Fallback model: gemini-3.1-flash-image-preview (Nano Banana 2, faster)
 */
export async function generateImageWithNanoBanana(
  options: GenerateImageOptions
): Promise<GenerateImageResponse> {
  if (!ENV.geminiApiKey) {
    console.warn("[ImageGen] GEMINI_API_KEY not set — falling back to GPT Image 1");
    return generateImageWithPeople(options);
  }

  // Try Nano Banana Pro first, then Nano Banana 2 (faster) as fallback
  const models = [
    "gemini-3-pro-image-preview",
    "gemini-3.1-flash-image-preview",
  ];

  for (const model of models) {
    try {
      console.log(`[ImageGen] Generating Nano Banana (${model}): "${options.prompt.slice(0, 100)}..."`);

      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${ENV.geminiApiKey}`;

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: options.prompt }],
          }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
          },
        }),
        signal: AbortSignal.timeout(90_000),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        console.warn(`[ImageGen] Nano Banana ${model} failed (${response.status}): ${detail.slice(0, 200)}`);
        continue; // Try next model
      }

      const result = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              text?: string;
              inlineData?: { mimeType: string; data: string };
            }>;
          };
        }>;
      };

      // Extract image from response parts
      const parts = result.candidates?.[0]?.content?.parts ?? [];
      const imagePart = parts.find(p => p.inlineData?.data);

      if (!imagePart?.inlineData) {
        console.warn(`[ImageGen] Nano Banana ${model} returned no image data — trying next model`);
        continue;
      }

      const buffer = Buffer.from(imagePart.inlineData.data, "base64");
      if (buffer.length === 0) {
        console.warn(`[ImageGen] Nano Banana ${model} returned empty image — trying next model`);
        continue;
      }

      // Determine file extension from mime type
      const mime = imagePart.inlineData.mimeType ?? "image/png";
      const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "png";

      const { url } = await storagePut(
        `generated/${Date.now()}-nanobana.${ext}`,
        buffer,
        mime
      );

      console.log(`[ImageGen] Nano Banana (${model}) saved: ${url} (${(buffer.length / 1024).toFixed(0)} KB)`);
      return { url };
    } catch (err: any) {
      console.warn(`[ImageGen] Nano Banana ${model} error: ${err?.message} — trying next model`);
      continue;
    }
  }

  // All Gemini models failed — fall back to GPT Image 1
  console.warn(`[ImageGen] All Nano Banana models failed — falling back to GPT Image 1`);
  return generateImageWithPeople(options);
}

/**
 * Generate a photorealistic image using GPT Image 1 (gpt-image-1).
 * ⚠️ DEPRECATED for named people — GPT Image 1 refuses to generate recognizable public figures.
 * Kept as fallback when GEMINI_API_KEY is not configured.
 * Use generateImageWithNanoBanana() instead for named people.
 *
 * Uses 1024×1536 (portrait, close to Instagram 4:5) at high quality.
 */
export async function generateImageWithPeople(
  options: GenerateImageOptions
): Promise<GenerateImageResponse> {
  if (!ENV.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  console.log(`[ImageGen] Generating GPT Image 1 (person scene): "${options.prompt.slice(0, 100)}..."`);

  // 90-second timeout — gpt-image-1 can be slower for complex scenes
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ENV.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt: options.prompt,
      n: 1,
      size: "1024x1536",
      quality: "high",
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `GPT Image 1 generation failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
    );
  }

  const result = (await response.json()) as {
    data: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  };

  // gpt-image-1 returns b64_json by default
  const imgData = result.data[0];
  let buffer: Buffer;

  if (imgData.b64_json) {
    buffer = Buffer.from(imgData.b64_json, "base64");
  } else if (imgData.url) {
    // Fallback: download from URL if b64 not provided
    const dlResponse = await fetch(imgData.url, { signal: AbortSignal.timeout(30_000) });
    if (!dlResponse.ok) throw new Error(`Failed to download generated image from URL`);
    buffer = Buffer.from(await dlResponse.arrayBuffer());
  } else {
    throw new Error("GPT Image 1 returned no image data");
  }

  // Save to local storage
  const { url } = await storagePut(
    `generated/${Date.now()}-person.png`,
    buffer,
    "image/png"
  );

  console.log(`[ImageGen] GPT Image 1 person scene saved: ${url}`);
  return { url };
}
