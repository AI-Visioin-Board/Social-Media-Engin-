# SuggestedByGPT — Full Project Brief for Claude Handoff

**Prepared:** March 4, 2026  
**Project Owner:** Maximus (CEO)  
**Live URL:** https://gptservice-gydch5xs.manus.space  
**Codebase:** `/home/ubuntu/suggestedbygpt` (exported to GitHub: `social-media-engine`)

---

## 1. Project Vision & Goal

SuggestedByGPT is a **fully automated AI-powered social media content engine** built for Instagram. The core product is a twice-weekly (Monday and Friday) pipeline that:

1. Discovers the most trending AI news stories from across the web
2. Scores and selects the top 5 stories using a GPT scoring agent
3. Researches each story deeply using GPT-4o web search
4. Generates cinematic background images or videos for each story
5. Assembles fully-branded Instagram carousel slides (1080×1350, @evolving.ai / @airesearches style)
6. Presents the carousel to the admin for approval
7. Posts to Instagram via a Make.com webhook automation

The secondary product is a **client service management dashboard** for the SuggestedByGPT AI consulting business (AI Jumpstart and AI Dominator service tiers), including a client-facing portal with magic link authentication, Stripe payments, and file deliverables.

The business goal is to grow the @suggestedbygpt Instagram account to a large following by consistently publishing high-quality, viral AI news carousels, then monetize through consulting services sold to business owners who discover the brand via Instagram.

---

## 2. Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| **Frontend** | React 19, Tailwind CSS 4, shadcn/ui, Radix UI | Dark admin theme, DashboardLayout sidebar |
| **Backend** | Express 4, tRPC 11, Superjson | Type-safe end-to-end, no REST routes |
| **Database** | MySQL / TiDB (Drizzle ORM) | Schema-first, migrations via `pnpm db:push` |
| **File Storage** | AWS S3 (Manus managed) | All generated images/videos stored here |
| **Auth** | Manus OAuth (admin) + magic link JWT (clients) | Two separate auth flows |
| **Payments** | Stripe (Checkout Sessions + webhooks) | For client upsell from Jumpstart → Dominator |
| **Email** | Gmail MCP (via Manus) | Welcome emails, magic link delivery |
| **Image Generation** | Manus built-in `generateImage()` (Nano Banana Pro) | Fallback when Kling is unavailable |
| **Video Generation** | Kling 2.5 API (text-to-video, 5-second clips) | Primary video source, requires API keys |
| **Slide Assembly** | Sharp (Node.js image compositor) | Replaced FFmpeg and Canva; runs in <3s/slide |
| **Topic Discovery** | NewsAPI.org + Reddit JSON API + GPT-4o web search | 3 parallel sources, 30–50 raw candidates |
| **Deep Research** | GPT-4o Responses API (web search tool) | Per-topic research with recency enforcement |
| **Instagram Posting** | Make.com webhook | Admin approves → webhook fires with slides + caption |
| **Testing** | Vitest | 23 unit tests across all critical modules |
| **Runtime** | Node.js 22, pnpm, tsx (dev), esbuild (prod) | ESM throughout |

---

## 3. Repository & File Structure

```
suggestedbygpt/
├── client/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── ContentStudio.tsx      ← MAIN PAGE — entire pipeline UI
│   │   │   └── Home.tsx               ← Redirect to /content-studio
│   │   ├── components/
│   │   │   ├── DashboardLayout.tsx    ← Sidebar nav wrapper
│   │   │   └── ui/                    ← shadcn/ui components
│   │   ├── App.tsx                    ← Routes
│   │   └── index.css                  ← Global dark theme tokens
├── server/
│   ├── routers.ts                     ← ALL tRPC procedures
│   ├── contentPipeline.ts             ← The full 7-stage pipeline
│   ├── sharpCompositor.ts             ← Slide image assembly (Sharp)
│   ├── canvaCompositor.ts             ← Canva MCP compositor (unused, kept as fallback)
│   ├── db.ts                          ← Drizzle query helpers
│   ├── products.ts                    ← Stripe product/price definitions
│   ├── emailHelper.ts                 ← Welcome email HTML builder
│   ├── fonts/                         ← Anton-Regular.ttf, Oswald-Bold.ttf
│   ├── contentStudio.test.ts          ← 22 unit tests for pipeline + music
│   ├── sharpCompositor.test.ts        ← Compositor layout tests
│   └── _core/
│       ├── llm.ts                     ← invokeLLM() helper
│       ├── imageGeneration.ts         ← generateImage() helper
│       ├── env.ts                     ← ENV variable registry
│       ├── trpc.ts                    ← publicProcedure / protectedProcedure / adminProcedure
│       └── notification.ts            ← notifyOwner() helper
├── drizzle/
│   └── schema.ts                      ← All DB tables
├── storage/
│   └── index.ts                       ← storagePut() / storageGet() S3 helpers
└── todo.md                            ← Full feature history
```

---

## 4. Database Schema

### Content Studio Tables

**`content_runs`** — one row per pipeline execution (Monday or Friday run)

| Column | Type | Description |
|---|---|---|
| `id` | int PK | Auto-increment |
| `runSlot` | enum | `"monday"` or `"friday"` |
| `status` | enum | See pipeline stages below |
| `topicsRaw` | text | JSON array of raw discovered topics |
| `topicsShortlisted` | text | JSON array of 12 deduped candidates |
| `topicsSelected` | text | JSON array of 5 scored + approved topics |
| `adminApproved` | boolean | Whether admin approved topic selection |
| `instagramCaption` | text | GPT-generated caption with hashtags |
| `postApproved` | boolean | Whether admin approved the final post |
| `instagramPostId` | varchar | Make.com response / IG post ID |
| `errorMessage` | text | Set on failure |

**`generated_slides`** — one row per slide (6 slides per run: 1 cover + 5 content)

| Column | Type | Description |
|---|---|---|
| `id` | int PK | Auto-increment |
| `runId` | int FK | References content_runs.id |
| `slideIndex` | int | 0 = cover, 1–5 = content slides |
| `headline` | varchar | ALL-CAPS viral headline |
| `summary` | text | 2-sentence plain-English explanation |
| `insightLine` | varchar | Optional 1-sentence chat bubble context (null if self-explanatory) |
| `videoPrompt` | text | Marketing Brain prompt used for generation |
| `videoUrl` | varchar | S3 URL of raw Kling video or Nano Banana image |
| `assembledUrl` | varchar | S3 URL of final assembled slide (Sharp output) |
| `isVideoSlide` | int | 1 = video slide, 0 = image slide |
| `citations` | text | JSON array of {source, url} from research |
| `status` | enum | `pending / researching / generating_video / assembling / ready / failed` |

**`published_topics`** — no-repeat memory across runs

| Column | Description |
|---|---|
| `title` | Original topic title |
| `titleNormalized` | Lowercase, punctuation-stripped for fuzzy matching |
| `runId` | Which run published this topic |
| `publishedAt` | Timestamp for 14-day exclusion window |

**`app_settings`** — key-value store for sensitive config (Kling credentials)

### Service Business Tables

**`orders`** — client service orders (AI Jumpstart / AI Dominator)  
**`messages`** — admin ↔ client messaging per order  
**`phase_progress`** — 4-step QA verification per service phase  
**`deliverables`** — files uploaded per phase (S3 URLs)  
**`client_access_tokens`** — magic link JWT tokens for client portal  
**`client_uploads`** — documents uploaded by clients  
**`users`** — Manus OAuth users with role: `"admin"` | `"user"`

---

## 5. The Content Pipeline — 7 Stages

The pipeline is triggered manually from the Content Studio UI (Monday Run / Friday Run buttons) or can be scheduled. It runs asynchronously — the HTTP response returns immediately and the pipeline continues in the background, updating the DB at each stage.

### Stage 1: Topic Discovery

Three sources run in parallel via `Promise.allSettled`:

- **NewsAPI.org** — queries `"artificial intelligence"`, `"AI model release"`, `"machine learning breakthrough"` with date filtering (7 days for Monday, 3 days for Friday)
- **Reddit JSON API** — scrapes r/artificial, r/MachineLearning, r/singularity, r/ChatGPT hot posts
- **GPT-4o web search** — 3 targeted queries with today's date injected, enforcing recency

If all sources fail (< 5 topics), a static fallback list of evergreen AI topics is used. Typically yields 30–50 raw candidates.

### Stage 2: No-Repeat Filter

Normalizes all topic titles (lowercase, strip punctuation) and compares against `published_topics` from the last 14 days using exact + substring matching. Filters to a shortlist of 12 unique candidates.

### Stage 3: GPT Scoring Agent

GPT-4o scores each of the 12 candidates on 5 criteria (1–10 each):
- `businessOwnerImpact` — how much does this affect small/medium business owners?
- `generalPublicRelevance` — is this something everyday people care about?
- `viralPotential` — would this make someone stop scrolling?
- `worldImportance` — is this a significant world event?
- `interestingness` — is this genuinely surprising or novel?

Top 5 by total score are selected. The admin is notified and must approve the topic selection before the pipeline continues (approval gate).

### Stage 4: Deep Research (GPT-4o Web Search)

For each of the 5 approved topics, GPT-4o with web search tool runs a structured research query. The prompt injects today's date and enforces a 15-day recency cutoff. Output per topic:

- `headline` — ALL-CAPS viral headline (max 12 words, @evolving.ai style)
- `summary` — 2-sentence plain-English explanation
- `insightLine` — optional 1-sentence chat bubble context (null if headline is self-explanatory)
- `videoPrompt` — Marketing Brain prompt (see Section 6)
- `citations` — array of {source, url} from web search

### Stage 5: Video / Image Generation

For each slide, the pipeline checks if Kling credentials are configured:

- **Kling 2.5 (primary):** Text-to-video API, 5-second vertical clips (1080×1920), signed JWT auth. Two slides per carousel are designated as video slides (`isVideoSlide = 1`).
- **Nano Banana (fallback):** Manus built-in `generateImage()` — generates a cinematic still image from the Marketing Brain prompt.

The cover slide always uses image generation with a dedicated `generateCoverImagePrompt()` function that synthesizes all 5 topic headlines into a single dramatic visual.

### Stage 6: Slide Assembly (Sharp Compositor)

`sharpCompositor.ts` assembles each slide entirely in Node.js using Sharp — no FFmpeg, no external API calls, runs in under 3 seconds per slide.

**Design spec (matching @airesearches / @evolving.ai):**
- 1080×1350 pixels (4:5 Instagram portrait ratio)
- Full-bleed background image
- Heavy dark gradient: starts at 45% height, fully black at bottom 30%
- Anton Bold font (bundled in `server/fonts/`)
- ALL-CAPS white headline, 1–2 key words highlighted in cyan (`#00E5FF`)
- Insight bubble (white speech-bubble box) positioned **below** the headline with tail pointing upward
- "SWIPE FOR MORE →" call-to-action at bottom
- "SuggestedByGPT" watermark bottom-left
- Content slides: headline wraps at 20 chars/line (wider than cover's 16)

For video slides, the raw Kling MP4 is used directly — Instagram plays video natively in carousels.

### Stage 7: Admin Approval Gate → Instagram Post

After assembly, the run enters `pending_post` status. The admin reviews the full carousel in the approval UI (swipeable lightbox, thumbnail strip, Re-roll button per slide), edits the GPT-generated caption if needed, and clicks "Approve & Post." This fires the Make.com webhook with all slide URLs and the caption, which posts to Instagram.

---

## 6. The Marketing Brain

The Marketing Brain is a dedicated LLM agent that generates hyper-specific, visually compelling image/video prompts. It replaced the original generic prompt generator.

**System persona:** "You are the Head of Viral Marketing at a top social media agency. Your job is to create the single most compelling, specific, and visually striking image or video prompt for a given AI news story."

**3-step chain-of-thought reasoning:**
1. Identify the specific subject (who/what/which company/product/event)
2. Find the most obvious, dramatic visual representation
3. Write the final prompt

**Hard rules enforced in all 4 prompt paths:**
- ABSOLUTELY NO readable text, letters, words, or numbers in the image
- For document/resume stories: show the emotional scene (stressed person, robot reviewing papers from a distance), NOT the document itself
- Must name real people/companies/events (e.g., "Alex Karp, Palantir CEO" not "a tech CEO")
- Generic prompt detection guard: if the output contains "server room", "data streams", "glowing circuits", or similar clichés, the agent is forced to re-run

---

## 7. Key Features — Content Studio UI

The Content Studio page (`client/src/pages/ContentStudio.tsx`) is the entire admin interface. It contains:

**Pipeline Command Center**
- Monday Run / Friday Run trigger buttons
- Live pipeline progress steps (Topic Discovery → AI Scoring → Your Review → Deep Research → Video Generation → Slide Assembly → Your Approval → Instagram Post)
- Stats cards: Total Runs, Completed, Needs Review, In Progress
- Run history list with status badges and timestamps

**Topic Review Panel** (appears when run reaches `review` status)
- Shows all 12 shortlisted topics with scores
- Admin selects/deselects topics, can swap individual topics
- "Approve All" sticky button triggers Stage 4 deep research

**Carousel Approval View** (appears when run reaches `pending_post` status)
- Instagram phone mockup frame with swipeable carousel
- Prev/next arrows, dot indicators, thumbnail strip
- Click-to-enlarge lightbox with video playback controls
- **Re-roll button** on each slide thumbnail — re-generates just that slide's media without re-running the whole pipeline
- **Recommended Track card** — GPT picks the best-matching epic/cinematic royalty-free track from an 8-track curated library based on the run's topics (shown because Instagram API doesn't support programmatic audio)
- Caption editor with inline editing
- Approve & Post button

**Setup Guide tab**
- Kling API credentials input (masked, stored encrypted in DB)
- Make.com webhook URL configuration
- API status indicators

**Published Topics tab**
- Full history of all published topics with dates
- Used to visualize the no-repeat exclusion list

---

## 8. Key Decisions & Architectural Choices

### Why Sharp instead of FFmpeg or Canva?

The pipeline went through three compositor iterations:

1. **FFmpeg** (original) — crashed repeatedly with filter chain escaping issues, `line_spacing not supported` errors in FFmpeg 4.4, and was slow (5–10s per slide). Abandoned after multiple failed fixes.

2. **Canva MCP** (second attempt) — integrated Canva's `generate-design` API to produce @evolving.ai-style slides. Worked visually but had critical problems: Canva's `generate-design` tool requires a Pro plan, has rate limits, takes 30–60 seconds per slide, and the MCP connection times out in production. Kept as dead code fallback.

3. **Sharp** (current) — pure Node.js image compositor. Runs in under 3 seconds per slide, zero external dependencies, zero rate limits, fully deterministic output. The design is hand-coded SVG overlaid on the background image. This is the correct long-term solution.

### Why tRPC instead of REST?

Type safety end-to-end — the frontend and backend share the same TypeScript types with zero manual contract files. All procedures are defined in `server/routers.ts` and consumed via `trpc.*.useQuery/useMutation` hooks on the frontend. This eliminates an entire class of bugs (mismatched field names, wrong types) and makes refactoring safe.

### Why two auth flows?

The admin (Maximus) authenticates via Manus OAuth — secure, no password management needed. Clients authenticate via magic links (JWT tokens sent by email) — no account creation required, which reduces friction for clients who just need to check their project status.

### Why Make.com for Instagram posting instead of direct API?

Instagram's Graph API requires a Facebook Business account, app review, and has strict rate limits. Make.com handles the OAuth flow, token refresh, and carousel upload complexity. The webhook integration is a single HTTP POST from the app — Make.com handles everything else. This was the fastest path to production.

### Why Kling 2.5 for video?

Kling 2.5 produces the highest-quality short-form vertical video of any text-to-video API available at this price point. The 5-second clips are ideal for Instagram carousel slides. The JWT signing approach (HMAC-SHA256, not Bearer token) was a significant implementation hurdle — solved by switching from `jsonwebtoken` (CommonJS) to `jose` (ESM-native) to avoid ESM/CJS module conflicts.

---

## 9. Hurdles Encountered & How They Were Solved

### Hurdle 1: FFmpeg filter chain crashes

**Problem:** The FFmpeg compositor crashed with `"line_spacing not supported"` (FFmpeg 4.4 doesn't support that drawtext parameter) and `"Error initializing complex filters"` (filter chain node naming was broken).

**Solution:** Abandoned FFmpeg entirely. Rewrote the compositor in Sharp (pure Node.js). Sharp uses SVG for text rendering which is fully cross-platform and version-independent.

### Hurdle 2: Kling ESM/CJS module conflict

**Problem:** `jsonwebtoken` is a CommonJS module. When imported in an ESM project (`"type": "module"` in package.json), the JWT signing for Kling API authentication crashed at runtime with `ERR_REQUIRE_ESM`.

**Solution:** Replaced `jsonwebtoken` with `jose` (ESM-native JWT library). Same API surface, zero compatibility issues.

### Hurdle 3: Topic discovery returning 0 results

**Problem:** The pipeline failed with `"Only 0 topics passed verification (need at least 3)"` because all social API scrapers (YouTube, TikTok) required API keys that weren't configured.

**Solution:** Added a multi-source fallback chain: NewsAPI.org (real-time headlines) → Reddit JSON API (no auth required) → GPT-4o web search (3 targeted queries) → static fallback topics. The pipeline now reliably produces 30–50 candidates even with zero external API keys.

### Hurdle 4: Canva generate-design timeout in production

**Problem:** Canva's `generate-design` MCP tool takes 30–60 seconds and times out in the production environment. The integration test also consistently times out.

**Solution:** Replaced Canva with the Sharp compositor for production. The Canva code is kept in `canvaCompositor.ts` as dead code for reference but is not used in the pipeline.

### Hurdle 5: Garbled text in generated images

**Problem:** Nano Banana / Google Imagen generated images with garbled lorem-ipsum text overlaid on document mockups when the Marketing Brain prompt described a resume or paper.

**Solution:** Added a hard NO-TEXT rule to all 4 prompt paths: "ABSOLUTELY NO TEXT in the image — no letters, no words, no numbers, no readable characters of any kind." Added a document-avoidance rule: for resume/paper/document stories, the prompt must show the emotional scene (stressed person, robot reviewing papers from a distance), NOT the document itself.

### Hurdle 6: Kling API key persistence

**Problem:** Kling API keys disappeared after saving in the Setup Guide — they were being stored in a server-side in-memory object that reset on server restart.

**Solution:** Moved Kling credentials to the `app_settings` database table (key-value store). Credentials now persist across restarts and deployments.

### Hurdle 7: Run stuck in `generating_video` status permanently

**Problem:** If Kling video generation threw an unhandled exception mid-flight, the slide's status was left as `generating_video` permanently with no way to recover.

**Solution:** Wrapped the entire media generation + assembly block in a `try/catch` that resets the slide status to `"failed"` on any unhandled exception. Added the same guard to the `regenerateSlide` procedure.

---

## 10. Environment Variables Required

All secrets are managed via the Manus platform (Settings → Secrets). The following are required for full functionality:

| Variable | Purpose | Required? |
|---|---|---|
| `OPENAI_API_KEY` | GPT-4o for scoring, research, captions, Marketing Brain | **Critical** |
| `NEWS_API_KEY` | NewsAPI.org for real-time AI headlines | Recommended |
| `KLING_ACCESS_KEY` | Kling 2.5 video generation | Optional (Nano Banana fallback) |
| `KLING_SECRET_KEY` | Kling 2.5 JWT signing | Optional (Nano Banana fallback) |
| `MAKE_WEBHOOK_URL` | Make.com webhook for Instagram posting | Required for posting |
| `STRIPE_SECRET_KEY` | Stripe payments (client upsell) | Required for payments |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook verification | Required for payments |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Stripe frontend key | Required for payments |
| `DATABASE_URL` | MySQL/TiDB connection | Auto-injected by Manus |
| `JWT_SECRET` | Session cookie signing | Auto-injected by Manus |
| `BUILT_IN_FORGE_API_KEY` | Manus built-in APIs (image gen, LLM) | Auto-injected by Manus |

---

## 11. tRPC Procedure Reference

All procedures are in `server/routers.ts`. The `contentStudio` router contains the pipeline procedures:

| Procedure | Type | Auth | Description |
|---|---|---|---|
| `contentStudio.triggerRun` | mutation | admin | Start a Monday or Friday pipeline run |
| `contentStudio.getRuns` | query | admin | List all runs (paginated) |
| `contentStudio.getRun` | query | admin | Get single run with all slides |
| `contentStudio.getRunPreview` | query | admin | Get slides + caption for approval view |
| `contentStudio.approveTopics` | mutation | admin | Approve topic selection, continue pipeline |
| `contentStudio.swapTopic` | mutation | admin | Replace one topic with an alternative |
| `contentStudio.approvePost` | mutation | admin | Approve final post, fire Make.com webhook |
| `contentStudio.regenerateSlide` | mutation | admin | Re-generate media for a single slide |
| `contentStudio.getMusicSuggestion` | query | admin | GPT picks best-matching epic track from library |
| `contentStudio.getPublishedTopics` | query | admin | List all published topics (no-repeat history) |
| `contentStudio.getKlingStatus` | query | admin | Check if Kling credentials are configured |
| `contentStudio.saveKlingCredentials` | mutation | admin | Save Kling API keys to DB |

---

## 12. Current State & What's Next

The pipeline is **fully functional end-to-end**. Runs complete in approximately 8–15 minutes depending on Kling video generation time. The following features are implemented and working:

- Full 7-stage pipeline with admin approval gates
- Sharp compositor producing @airesearches-style slides
- Marketing Brain for hyper-specific image/video prompts
- Re-roll button for per-slide regeneration
- Music recommendation card in approval view
- Insight bubble (chat bubble context below headline)
- No-repeat topic memory (14-day window)
- Kling credentials management
- Make.com webhook posting

**Highest-priority next items (from todo.md):**

1. **Virality framework** — enforce the 5-pillar carousel structure (Hook → Problem → Solution → Proof → CTA) in the slide generation prompt so every carousel has a deliberate narrative arc
2. **Sharp compositor quality pass** — heavier bottom gradient, yellow/orange accent on 1–2 key words per headline
3. **Posting time badge** — show optimal IG posting window (Tue–Fri 9–11am or 6–8pm) in approval view
4. **Caption optimizer** — open-loop hook + surprising stat + CTA question in every caption
5. **Hashtag strategy engine** — 5–10 niche-specific tags, mix of large/medium/small reach

---

## 13. How to Run Locally

```bash
# Install dependencies
pnpm install

# Push schema to database
pnpm db:push

# Start dev server (frontend + backend on port 3000)
pnpm dev
```

The app runs on `http://localhost:3000`. Admin login requires a Manus OAuth account with `role = "admin"` in the `users` table.

---

## 14. Testing

```bash
# Run all unit tests
pnpm test

# Run specific test file
npx vitest run server/contentStudio.test.ts
```

**Test coverage:**
- `server/contentStudio.test.ts` — 22 tests: regenerateSlide input validation, slide status transitions, getMusicSuggestion track selection, Marketing Brain generic prompt detection
- `server/sharpCompositor.test.ts` — compositor layout constants and text wrapping
- `server/auth.logout.test.ts` — auth logout procedure
- `server/orders.test.ts` — order CRUD procedures
- `server/api-keys.test.ts` — API key management

**Note:** `server/canvaCompositor.test.ts` is an integration test that makes live Canva MCP calls — it will time out in environments without an active Canva MCP connection. This is expected and not a regression.

---

*This document was generated on March 4, 2026. For the latest state of the codebase, refer to the GitHub repository and `todo.md` at the project root.*
