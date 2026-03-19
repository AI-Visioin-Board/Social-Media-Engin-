/**
 * Programmatic database migration — creates all Postgres tables and enums.
 * Runs at server startup BEFORE anything else touches the database.
 * Uses CREATE ... IF NOT EXISTS so it's safe to run on every boot.
 */
import postgresDriver from "postgres";

export async function migrateDatabase(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("[Migrate] DATABASE_URL not set — skipping migration");
    return;
  }

  console.log("[Migrate] Running database migration...");
  const sql = postgresDriver(url);

  try {
    // ── Enum types ──────────────────────────────
    await sql.unsafe(`
      DO $$ BEGIN
        CREATE TYPE role AS ENUM ('user', 'admin');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE service_tier AS ENUM ('ai_jumpstart', 'ai_dominator');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE order_status AS ENUM ('pending', 'processing', 'completed', 'cancelled');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE service_phase AS ENUM (
          'onboarding', 'ai_audit', 'gbp_optimization', 'schema_markup',
          'citation_audit', 'review_strategy', 'content_optimization',
          'competitor_analysis', 'final_report', 'follow_up'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE message_sender AS ENUM ('client', 'admin');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE run_slot AS ENUM ('monday', 'friday');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE content_run_status AS ENUM (
          'pending', 'discovering', 'scoring', 'researching',
          'generating', 'assembling', 'review', 'pending_post',
          'posting', 'completed', 'failed'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE slide_status AS ENUM (
          'pending', 'researching', 'generating_video', 'assembling', 'ready', 'failed'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    // ── Tables ───────────────────────────────────

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        "openId" VARCHAR(64) NOT NULL UNIQUE,
        name TEXT,
        email VARCHAR(320),
        "loginMethod" VARCHAR(64),
        role role NOT NULL DEFAULT 'user',
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "lastSignedIn" TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        "clientName" VARCHAR(255) NOT NULL,
        "clientEmail" VARCHAR(320) NOT NULL,
        "businessName" VARCHAR(255) NOT NULL,
        "websiteUrl" VARCHAR(500),
        "businessAddress" VARCHAR(500),
        "businessPhone" VARCHAR(50),
        "businessCategory" VARCHAR(255),
        "targetArea" VARCHAR(255),
        "serviceTier" service_tier NOT NULL,
        status order_status NOT NULL DEFAULT 'pending',
        "currentPhase" service_phase NOT NULL DEFAULT 'onboarding',
        "welcomeEmailSent" BOOLEAN NOT NULL DEFAULT FALSE,
        notes TEXT,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        "orderId" INTEGER NOT NULL,
        sender message_sender NOT NULL,
        content TEXT NOT NULL,
        "isProcessed" BOOLEAN NOT NULL DEFAULT FALSE,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS phase_progress (
        id SERIAL PRIMARY KEY,
        "orderId" INTEGER NOT NULL,
        phase service_phase NOT NULL,
        "qaExecute" BOOLEAN NOT NULL DEFAULT FALSE,
        "qaVerify" BOOLEAN NOT NULL DEFAULT FALSE,
        "qaTest" BOOLEAN NOT NULL DEFAULT FALSE,
        "qaDocument" BOOLEAN NOT NULL DEFAULT FALSE,
        notes TEXT,
        "completedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS deliverables (
        id SERIAL PRIMARY KEY,
        "orderId" INTEGER NOT NULL,
        phase service_phase NOT NULL,
        name VARCHAR(255) NOT NULL,
        "fileUrl" VARCHAR(1000) NOT NULL,
        "fileKey" VARCHAR(500) NOT NULL,
        "mimeType" VARCHAR(100),
        "fileSize" INTEGER,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS client_access_tokens (
        id SERIAL PRIMARY KEY,
        "orderId" INTEGER NOT NULL,
        email VARCHAR(320) NOT NULL,
        token VARCHAR(128) NOT NULL UNIQUE,
        "expiresAt" TIMESTAMP NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS client_uploads (
        id SERIAL PRIMARY KEY,
        "orderId" INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        "fileUrl" VARCHAR(1000) NOT NULL,
        "fileKey" VARCHAR(500) NOT NULL,
        "mimeType" VARCHAR(100),
        "fileSize" INTEGER,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS content_runs (
        id SERIAL PRIMARY KEY,
        "runSlot" run_slot NOT NULL,
        status content_run_status NOT NULL DEFAULT 'pending',
        "topicsRaw" TEXT,
        "topicsShortlisted" TEXT,
        "topicsSelected" TEXT,
        "errorMessage" TEXT,
        "adminApproved" BOOLEAN NOT NULL DEFAULT FALSE,
        "instagramCaption" TEXT,
        "postApproved" BOOLEAN NOT NULL DEFAULT FALSE,
        "instagramPostId" VARCHAR(255),
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS published_topics (
        id SERIAL PRIMARY KEY,
        "runId" INTEGER NOT NULL,
        title VARCHAR(500) NOT NULL,
        summary TEXT,
        "titleNormalized" VARCHAR(500) NOT NULL,
        "publishedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS generated_slides (
        id SERIAL PRIMARY KEY,
        "runId" INTEGER NOT NULL,
        "slideIndex" INTEGER NOT NULL,
        headline VARCHAR(500),
        summary TEXT,
        citations TEXT,
        "videoUrl" VARCHAR(1000),
        "assembledUrl" VARCHAR(1000),
        "videoPrompt" TEXT,
        "isVideoSlide" INTEGER NOT NULL DEFAULT 0,
        "insightLine" VARCHAR(200),
        status slide_status NOT NULL DEFAULT 'pending',
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS "appSettings" (
        key VARCHAR(128) PRIMARY KEY,
        value TEXT NOT NULL,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // ── Schema evolution (safe additions) ──────
    // ADD COLUMN IF NOT EXISTS requires a DO block in Postgres
    await sql.unsafe(`
      DO $$ BEGIN
        ALTER TABLE content_runs ADD COLUMN "statusDetail" TEXT;
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);

    await sql.unsafe(`
      DO $$ BEGIN
        ALTER TABLE content_runs ADD COLUMN "creativeBrief" TEXT;
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);

    // ── Seed CTA slide URL if not set ──────────
    await sql.unsafe(`
      INSERT INTO "appSettings" (key, value, "updatedAt")
      VALUES ('cta_slide_url', '/uploads/cta/sales-slide.png', NOW())
      ON CONFLICT (key) DO NOTHING;
    `);

    // ── Avatar Reels pipeline ──────────────────
    await sql.unsafe(`
      DO $$ BEGIN
        CREATE TYPE avatar_run_status AS ENUM (
          'pending', 'topic_discovery', 'topic_review',
          'scripting', 'generating_assets', 'generating_avatar',
          'assembling', 'video_review', 'revision',
          'posting', 'completed', 'failed', 'cancelled'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS avatar_runs (
        id SERIAL PRIMARY KEY,
        status avatar_run_status NOT NULL DEFAULT 'pending',
        "statusDetail" TEXT,
        topic TEXT,
        "topicCandidates" TEXT,
        "sourceArticles" TEXT,
        "extractedFacts" TEXT,
        "verificationStatus" VARCHAR(32),
        "viralityScore" INTEGER,
        "scriptJson" TEXT,
        "assetMap" TEXT,
        "shotstackEditJson" TEXT,
        "avatarVideoUrl" VARCHAR(1000),
        "avatarDurationSec" INTEGER,
        "assembledVideoUrl" VARCHAR(1000),
        "finalVideoUrl" VARCHAR(1000),
        "instagramCaption" TEXT,
        "feedbackHistory" TEXT,
        "revisionCount" INTEGER NOT NULL DEFAULT 0,
        "dayNumber" INTEGER,
        "contentBucket" VARCHAR(32),
        "outfitId" VARCHAR(128),
        "instagramPostId" VARCHAR(255),
        "errorMessage" TEXT,
        "heygenCreditsUsed" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // ── Suggested Topics bank ──────────────────
    await sql.unsafe(`
      DO $$ BEGIN
        CREATE TYPE suggested_topic_status AS ENUM ('pending', 'running', 'used', 'skipped');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS suggested_topics (
        id SERIAL PRIMARY KEY,
        topic TEXT NOT NULL,
        notes TEXT,
        status suggested_topic_status NOT NULL DEFAULT 'pending',
        avatar_run_id INTEGER,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // Add columns to avatar_runs that may not exist from earlier CREATE TABLE (idempotent)
    await sql.unsafe(`
      DO $$ BEGIN
        ALTER TABLE avatar_runs ADD COLUMN "shotstackEditJson" TEXT;
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);
    await sql.unsafe(`
      DO $$ BEGIN
        ALTER TABLE avatar_runs ADD COLUMN "avatarVideoUrl" VARCHAR(1000);
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);
    await sql.unsafe(`
      DO $$ BEGIN
        ALTER TABLE avatar_runs ADD COLUMN "avatarDurationSec" INTEGER;
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);
    await sql.unsafe(`
      DO $$ BEGIN
        ALTER TABLE avatar_runs ADD COLUMN "outfitId" VARCHAR(128);
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);
    await sql.unsafe(`
      DO $$ BEGIN
        ALTER TABLE avatar_runs ADD COLUMN suggested_topic_id INTEGER;
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);
    await sql.unsafe(`
      DO $$ BEGIN
        ALTER TABLE avatar_runs ADD COLUMN "multiAssetMap" TEXT;
      EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);

    // ── Editorial Calendar ────────────────────────
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS calendar_entries (
        id SERIAL PRIMARY KEY,
        scheduled_date DATE NOT NULL,
        content_type VARCHAR(20) NOT NULL,
        topic_title TEXT,
        topic_context TEXT,
        status VARCHAR(30) NOT NULL DEFAULT 'planned',
        pipeline_run_id INTEGER,
        pipeline_type VARCHAR(20),
        notes TEXT,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    console.log("[Migrate] All tables created successfully");
  } catch (error) {
    console.error("[Migrate] Migration failed:", error);
    throw error;
  } finally {
    await sql.end();
  }
}
