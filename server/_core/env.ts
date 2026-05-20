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

  // HeyGen (Avatar video generation)
  heygenApiKey: process.env.HEYGEN_API_KEY ?? "",
  heygenAvatarId: process.env.HEYGEN_AVATAR_ID ?? "",
  heygenLookId: process.env.HEYGEN_LOOK_ID ?? "",
  heygenVoiceId: process.env.HEYGEN_VOICE_ID ?? "",

  // Shotstack (Cloud video assembly)
  shotstackApiKey: process.env.SHOTSTACK_API_KEY ?? "",
  shotstackEnv: (process.env.SHOTSTACK_ENV ?? "v1") as "stage" | "v1",

  // Pexels (Stock B-roll fallback)
  pexelsApiKey: process.env.PEXELS_API_KEY ?? "",

  // Twitter/X API (direct posting)
  twitterApiKey: process.env.TWITTER_API_KEY ?? "",
  twitterApiSecret: process.env.TWITTER_API_SECRET ?? "",
  twitterAccessToken: process.env.TWITTER_ACCESS_TOKEN ?? "",
  twitterAccessSecret: process.env.TWITTER_ACCESS_SECRET ?? "",

  // External APIs
  newsApiKey: process.env.NEWS_API_KEY ?? "",
  serpApiKey: process.env.SERP_API_KEY ?? "",
  makeWebhookUrl: process.env.MAKE_WEBHOOK_URL ?? "",

  // Zernio (formerly Late) — unified social-media-posting API.
  // Replaces Make.com because Make's Instagram Business module mangled
  // mixed-media carousels on the Graph API. Zernio handles them natively.
  // Reference: https://docs.zernio.com/llms-full.txt
  zernioApiKey: process.env.ZERNIO_API_KEY ?? "",
  /** Zernio account `_id` for the @suggestedbygpt Instagram channel. Pulled
   *  via GET /api/v1/accounts after the IG OAuth in Zernio dashboard. */
  zernioInstagramAccountId: process.env.ZERNIO_INSTAGRAM_ACCOUNT_ID ?? "",
  /** Which publisher fires when triggerCarouselPost runs.
   *  - "make"   : legacy path only (Make.com webhook)
   *  - "zernio" : Zernio REST API only
   *  - "both"   : dual-write — Zernio publishes, Make.com fires for comparison
   *  Defaults to "make" so deploying this code without setting ZERNIO_* is a no-op.
   */
  publisher: (process.env.PUBLISHER ?? "make").toLowerCase() as
    | "make"
    | "zernio"
    | "both",

  // Runtime
  isProduction: process.env.NODE_ENV === "production",
  port: parseInt(process.env.PORT ?? "3000", 10),
};
