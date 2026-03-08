/**
 * Image generation using OpenAI models
 *
 * - generateImage()           → DALL-E 3 for scenes/environments (no real people)
 * - generateImageWithPeople() → GPT Image 1 for photorealistic images of named public figures
 *
 * Example usage:
 *   const { url } = await generateImage({ prompt: "A serene landscape with mountains" });
 *   const { url } = await generateImageWithPeople({
 *     prompt: "Tim Cook standing in a boardroom, looking concerned",
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
 * Generate a photorealistic image using GPT Image 1 (gpt-image-1).
 * Can render named public figures with contextual expressions/poses.
 * Best for: person_composite strategy — the person is generated IN the scene naturally.
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
