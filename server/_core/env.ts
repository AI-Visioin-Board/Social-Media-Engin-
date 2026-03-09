import "dotenv/config";

export const ENV = {
  // Auth
  cookieSecret: process.env.JWT_SECRET ?? "",
  adminEmail: process.env.ADMIN_EMAIL ?? "",
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH ?? "",

  // Database
  databaseUrl: process.env.DATABASE_URL ?? "",

  // OpenAI (LLM + Image Gen)
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: (process.env.OPENAI_MODEL ?? "gpt-4.1").toLowerCase(),

  // Storage
  uploadsDir: process.env.UPLOADS_DIR ?? "./public/uploads",

  // Kling Video
  klingAccessKey: process.env.KLING_ACCESS_KEY ?? "",
  klingSecretKey: process.env.KLING_SECRET_KEY ?? "",

  // Google Gemini (Nano Banana image generation — can render named public figures)
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",

  // Google CSE (person image search)
  googleCseApiKey: process.env.GOOGLE_CSE_API_KEY ?? "",
  googleCseId: process.env.GOOGLE_CSE_ID ?? "",

  // Replicate (Seedance video gen)
  replicateApiToken: process.env.REPLICATE_API_TOKEN ?? "",

  // External APIs
  newsApiKey: process.env.NEWS_API_KEY ?? "",
  serpApiKey: process.env.SERP_API_KEY ?? "",
  makeWebhookUrl: process.env.MAKE_WEBHOOK_URL ?? "",

  // Runtime
  isProduction: process.env.NODE_ENV === "production",
  port: parseInt(process.env.PORT ?? "3000", 10),
};
