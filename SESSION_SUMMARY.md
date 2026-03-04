# Session Summary — March 4, 2026 (Claude Code Web Session)

## Project: SuggestedByGPT — AI-Powered Instagram Content Engine

**Repo:** `AI-Visioin-Board/Social-Media-Engin-`
**Full project brief:** `CLAUDE_HANDOFF.md` (450-line comprehensive doc — **read this first**)
**Feature backlog:** `todo.md` (full history of every feature, bug fix, upgrade)

---

## What This Project Is

SuggestedByGPT is a **fully automated AI content pipeline** that:
1. Discovers trending AI news from NewsAPI, Reddit, and GPT-4o web search
2. Scores and selects the top 5 stories using a GPT scoring agent
3. Researches each story with GPT-4o web search (15-day recency enforcement)
4. Generates cinematic background images (Nano Banana) or videos (Kling 2.5)
5. Assembles branded Instagram carousel slides (1080x1350, @evolving.ai style) using Sharp
6. Presents carousel to admin for approval with music recommendation
7. Posts to Instagram via Make.com webhook

Secondary product: client service management dashboard (AI Jumpstart / AI Dominator tiers) with Stripe payments, magic link auth, and client portal.

---

## Technology Stack

| Layer | Tool/Library |
|---|---|
| **Frontend** | React 19, Tailwind CSS 4, shadcn/ui, Radix UI, Vite |
| **Backend** | Express 4, tRPC 11, Superjson |
| **Database** | MySQL / TiDB via Drizzle ORM |
| **Image Compositor** | Sharp (Node.js) — replaced FFmpeg and Canva |
| **Video Generation** | Kling 2.5 API (JWT auth via `jose`) |
| **Image Generation** | Manus `generateImage()` (Nano Banana Pro) |
| **Real Image Sourcing** | Google Custom Search Engine API (new today) |
| **AI Research** | GPT-4o Responses API with web search tool |
| **AI Scoring** | GPT-4o (5-criteria scoring agent) |
| **Marketing Brain** | GPT-4o (dedicated "Head of Viral Marketing" LLM agent) |
| **Instagram Posting** | Make.com webhook automation |
| **Payments** | Stripe (Checkout Sessions + webhooks) |
| **Email** | Gmail MCP (magic links, welcome emails) |
| **Testing** | Vitest (23 unit tests) |
| **Auth** | Manus OAuth (admin) + magic link JWT (clients) |
| **Storage** | AWS S3 |
| **Runtime** | Node.js 22, pnpm, ESM throughout |
| **Fonts** | Anton Regular, Bebas Neue, Oswald Bold (bundled) |

---

## What Was Executed Today (This Session) — 5 Commits

### Commit 1: Virality Framework (`f5019f4`)
**New file created:** `server/viralityFramework.ts` (242 lines)
**Files modified:** `server/contentPipeline.ts`, `server/sharpCompositor.ts`

**What it does:**
- Data-backed Instagram growth strategy engine based on research from Buffer, Hootsuite, TrueFuture Media, Cliptics, and GitHub repos (Social-Media-Engagement-Forecasting, Creator Growth Navigator)
- Encodes the 2026 Instagram algorithm signal hierarchy: Shares > Saves > Comments > Dwell time > Likes
- **Cover headline hook templates** — curiosity-gap and FOMO formulas (e.g., "X JUST DID SOMETHING NOBODY EXPECTED", "RIP [Thing]", "THIS CHANGES EVERYTHING ABOUT [Topic]")
- **5-pillar carousel structure** enforced in GPT research prompts:
  - Slide 1: **Hook** — scroll-stopping contrarian or shocking claim
  - Slide 2: **Problem** — why this matters / what's at stake
  - Slide 3: **Solution** — what happened / who did it
  - Slide 4: **Proof** — data, citation, real example
  - Slide 5: **CTA** — save-worthy takeaway + engagement question
- Virality scoring added to topic selection (controversy score, information gap, emotional trigger)
- Slide text enforcement: max 10-15 words per slide, 1 idea per slide
- Wired into `contentPipeline.ts` Stage 4 deep research prompts

### Commit 2: Content Quality Fixes (`250422c`)
**Files modified:** `server/contentPipeline.ts`, `server/sharpCompositor.ts`, `server/viralityFramework.ts`

**What was fixed:**
- **Headline variety** — all 5 slides were using the same hook style. Added diversity enforcement so each slide uses a different approach (question, statistic, bold claim, "RIP" pattern, contrarian take)
- **Summary text rendering** — Sharp compositor now renders a 2-sentence plain-English summary below the headline on content slides, giving viewers actual context (not just a clickbait headline with no info)
- **Realistic images** — Marketing Brain prompts updated to ban generic AI cliches ("glowing circuits", "data streams", "futuristic server rooms"). Must use photorealistic, story-specific imagery naming real people/companies/events
- Updated `viralityFramework.ts` with refined hook templates and scoring weights

### Commit 3: Layout Overflow Fix (`54bcc29`)
**File modified:** `server/sharpCompositor.ts`

**What was fixed:**
- When both summary text AND insight bubble (chat bubble) were present on a slide, they overlapped or overflowed the 1080x1350 canvas
- Added dynamic Y-position spacing logic that measures available vertical space and stacks elements correctly regardless of text length
- Summary text now wraps and truncates gracefully within the dark gradient zone

### Commit 4: Real Image Sourcing + Video Summary Text (`555225a`)
**New file created:** `server/assetLibrary.ts` (396 lines)
**Files modified:** `server/contentPipeline.ts`, `server/sharpCompositor.ts`, `server/videoCompositor.ts`

**What it does:**
- **Curated logo library** — hardcoded map of 50+ top AI/tech company names → transparent PNG URLs from stable public sources (GitHub, Wikimedia, official CDNs). Free, instant, no API calls.
- **Google Custom Search Engine integration** — dynamic image search for people, products, events. 100 free queries/day (plenty for 2 posts/week x 4 slides). The Marketing Brain decides per-slide whether to `"fetch_logo"`, `"search_image"`, or `"generate"` (AI-generated).
- Pipeline now tries real photos first → falls back to AI generation
- `server/videoCompositor.ts` updated to overlay the 2-sentence summary text on video slides (previously video slides had no text overlay)

### Commit 5: Google CSE Credentials UI (`3b3543c`)
**Files modified:** `client/src/pages/ContentStudio.tsx`, `server/routers.ts`, `server/_core/env.ts`, `server/assetLibrary.ts`

**What it does:**
- **Setup Guide UI** — added Google CSE credentials section in Content Studio with:
  - API Key input (masked password field)
  - Search Engine ID input
  - Save button with loading state
  - Active/inactive status indicator
- **New tRPC procedures:** `saveGoogleCseCredentials` (mutation) and `getGoogleCseStatus` (query)
- Keys persisted in `app_settings` DB table (same upsert pattern as Kling credentials)
- **New env vars registered:** `GOOGLE_CSE_API_KEY`, `GOOGLE_CSE_ENGINE_ID`

---

## Complete File Map — What's Important

### Core Pipeline (read these first)
| File | Lines | Purpose |
|---|---|---|
| `server/contentPipeline.ts` | ~500 | **The main 7-stage pipeline orchestrator** — discovery → scoring → approval → research → generation → assembly → posting |
| `server/viralityFramework.ts` | 242 | **NEW** — Virality rules, hook templates, 5-pillar carousel structure |
| `server/sharpCompositor.ts` | ~400 | Slide image assembly — Sharp SVG overlay on background, gradient, headline, summary, insight bubble, watermark |
| `server/assetLibrary.ts` | 396 | **NEW** — Real image sourcing (curated logos + Google CSE search) |
| `server/videoCompositor.ts` | ~150 | Video slide assembly — summary text overlay on Kling MP4 clips |
| `server/routers.ts` | ~800 | **All tRPC procedures** — pipeline triggers, approval gates, credentials, slides |
| `server/canvaCompositor.ts` | ~200 | Dead code — Canva MCP integration (kept as reference, not used) |
| `server/ffmpegCompositor.ts` | ~300 | Dead code — FFmpeg compositor (replaced by Sharp) |

### Frontend
| File | Purpose |
|---|---|
| `client/src/pages/ContentStudio.tsx` | **The entire admin UI** — pipeline controls, topic review, carousel preview, approval, setup guide |
| `client/src/pages/ClientPortal.tsx` | Client-facing portal (magic link auth) |
| `client/src/components/DashboardLayout.tsx` | Sidebar navigation wrapper |
| `client/src/App.tsx` | Routes |

### Database & Config
| File | Purpose |
|---|---|
| `drizzle/schema.ts` | All DB tables (content_runs, generated_slides, published_topics, app_settings, orders, messages, etc.) |
| `server/db.ts` | Drizzle query helpers |
| `server/_core/env.ts` | Environment variable registry |
| `server/storage.ts` | S3 `storagePut()` / `storageGet()` helpers |

### Tests
| File | Tests |
|---|---|
| `server/contentStudio.test.ts` | 22 tests — regenerateSlide, music suggestion, Marketing Brain |
| `server/sharpCompositor.test.ts` | Compositor layout constants and text wrapping |
| `server/canvaCompositor.test.ts` | Integration test (Canva MCP — will timeout without connection, expected) |
| `server/orders.test.ts` | Order CRUD |
| `server/api-keys.test.ts` | API key management |
| `server/auth.logout.test.ts` | Auth logout |

### Reference Docs
| File | Purpose |
|---|---|
| `CLAUDE_HANDOFF.md` | **450-line comprehensive project brief** — architecture, pipeline stages, DB schema, decisions, hurdles |
| `SuggestedByGPT_Client_Service_Protocol.md` | 10-phase client service execution protocol |
| `todo.md` | Full feature history and remaining backlog |

---

## What's NOT Done Yet (Next Steps — Priority Order)

### High Priority
1. **Sharp compositor quality pass** — heavier bottom gradient (darker, taller), highlight 1-2 key words per headline in yellow/orange accent color (currently only cyan)
2. **Fix carousel preview** — show full 1080x1350 image without edge cropping in phone mockup; fix cover photo `[object Object]` display bug
3. **Posting time badge** — display optimal Instagram posting window (Tue-Fri 9-11am or 6-8pm) in the approval view
4. **Caption optimizer** — enforce open-loop hook + surprising stat + CTA question in every GPT-generated caption
5. **Hashtag strategy engine** — 5-10 niche-specific tags per post, mix of large/medium/small reach volumes

### Medium Priority
6. **Mobile hamburger menu fixes** — icon color too light, right-edge spacing off, dropdown not opening
7. **Replace GPT-4o with Claude Opus for Stage 2 topic scoring** — noted in todo.md but not yet implemented
8. **Analytics dashboard** — track follower growth, engagement rates, best-performing topics
9. **Scheduled runs** — auto-trigger Monday/Friday pipeline runs instead of manual button press

### Low Priority / Stretch
10. **A/B testing framework** — test different hook styles, gradient weights, accent colors
11. **Multi-platform support** — extend beyond Instagram to TikTok, LinkedIn, X/Twitter
12. **Client portal improvements** — real-time progress updates via WebSocket

---

## Environment Variables Needed

| Variable | Purpose | Status |
|---|---|---|
| `OPENAI_API_KEY` | GPT-4o for everything | **Critical** |
| `NEWS_API_KEY` | NewsAPI.org headlines | Recommended |
| `GOOGLE_CSE_API_KEY` | Real image search | **New today** |
| `GOOGLE_CSE_ENGINE_ID` | Google search engine ID | **New today** |
| `KLING_ACCESS_KEY` | Kling 2.5 video | Optional (fallback to Nano Banana) |
| `KLING_SECRET_KEY` | Kling 2.5 JWT signing | Optional |
| `MAKE_WEBHOOK_URL` | Instagram posting | Required for posting |
| `STRIPE_SECRET_KEY` | Payments | Required for payments |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhooks | Required for payments |
| `DATABASE_URL` | MySQL/TiDB | Auto-injected by platform |

---

## How to Continue Locally

```bash
git clone https://github.com/AI-Visioin-Board/Social-Media-Engin-.git
cd Social-Media-Engin-
pnpm install
pnpm db:push
pnpm dev          # frontend + backend on port 3000
claude            # launch Claude Code locally
```

Start by telling Claude to read `CLAUDE_HANDOFF.md` and `SESSION_SUMMARY.md`.

---

*Generated: March 4, 2026 — Claude Code Web Session*
