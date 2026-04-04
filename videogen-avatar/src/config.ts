// ============================================================
// videogen-avatar — Configuration
// Loads env vars, extending the parent repo's .env
// ============================================================

import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// .env lives in the parent repo root (two levels up from videogen-avatar/src/)
loadEnv({ path: resolve(__dirname, "../../.env") });

export const CONFIG = {
  // --- Inherited from parent repo .env ---
  openaiApiKey: requireEnv("OPENAI_API_KEY"),
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4.1",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  klingAccessKey: process.env.KLING_ACCESS_KEY ?? "",
  klingSecretKey: process.env.KLING_SECRET_KEY ?? "",
  uploadsDir: process.env.UPLOADS_DIR ?? "./public/uploads",

  // --- New: Avatar pipeline keys ---
  heygenApiKey: process.env.HEYGEN_API_KEY ?? "",
  heygenAvatarId: process.env.HEYGEN_AVATAR_ID ?? "",
  heygenLookId: process.env.HEYGEN_LOOK_ID ?? "",    // specific look/outfit for the avatar
  heygenVoiceId: process.env.HEYGEN_VOICE_ID ?? "",
  heygenTemplateId: process.env.HEYGEN_TEMPLATE_ID ?? "",
  shotstackApiKey: process.env.SHOTSTACK_API_KEY ?? "",
  shotstackEnv: (process.env.SHOTSTACK_ENV ?? "v1") as "stage" | "v1",
  pexelsApiKey: process.env.PEXELS_API_KEY ?? "",
  creatomateApiKey: process.env.CREATOMATE_API_KEY ?? "",

  // --- Pipeline defaults ---
  defaultTargetDuration: 60,
  defaultAvatarPosition: "bottomLeft" as const,
  defaultAvatarScale: 0.28,
  maxRetries: 3,
  retryBaseDelaySec: 1,

  // --- Polling intervals ---
  heygenPollIntervalMs: 10_000,
  heygenTimeoutMs: 600_000,     // 10 min
  klingPollIntervalMs: 10_000,
  klingTimeoutMs: 600_000,      // 10 min
  shotstackPollIntervalMs: 15_000,
  shotstackTimeoutMs: 300_000,  // 5 min

  // --- Pexels ---
  pexelsMaxPerVideo: 6,
  pexelsMinDuration: 3,

  // --- Concurrency ---
  nanoBananaConcurrency: 5,
  klingConcurrency: 3,
  pexelsConcurrency: 10,
};

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return val;
}

export function hasKey(service: "heygen" | "shotstack" | "pexels" | "kling" | "gemini" | "creatomate"): boolean {
  switch (service) {
    case "heygen": return CONFIG.heygenApiKey.length > 0;
    case "shotstack": return CONFIG.shotstackApiKey.length > 0;
    case "pexels": return CONFIG.pexelsApiKey.length > 0;
    case "kling": return CONFIG.klingAccessKey.length > 0 && CONFIG.klingSecretKey.length > 0;
    case "gemini": return CONFIG.geminiApiKey.length > 0;
    case "creatomate": return CONFIG.creatomateApiKey.length > 0;
  }
}
