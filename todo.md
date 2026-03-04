# SuggestedByGPT - Project TODO

- [x] Database schema: orders table (id, clientName, clientEmail, businessName, websiteUrl, serviceTier, status, welcomeEmailSent, currentPhase, createdAt, updatedAt)
- [x] Database schema: messages table (id, orderId, sender, content, isProcessed, createdAt)
- [x] Database schema: deliverables table (id, orderId, phase, name, fileUrl, fileKey, createdAt)
- [x] Database schema: phaseProgress table (id, orderId, phase, qaExecute, qaVerify, qaTest, qaDocument, completedAt)
- [x] Server: query helpers for orders CRUD
- [x] Server: query helpers for messages CRUD
- [x] Server: query helpers for deliverables CRUD
- [x] Server: query helpers for phase progress CRUD
- [x] Server: tRPC routers for order management (list, get, create, update status)
- [x] Server: tRPC routers for messages (list by order, create, mark processed)
- [x] Server: tRPC routers for deliverables (list by order, upload, delete)
- [x] Server: tRPC routers for phase progress (get by order, update QA steps, complete phase)
- [x] Server: owner notification on new orders and client messages
- [x] Vitest tests for backend procedures
- [x] UI: Admin dashboard with order list, status filtering, stats cards
- [x] UI: Order detail page with tabs (Overview, Phases, Messages, Deliverables)
- [x] UI: Phase tracking with 10-phase protocol and 4-step QA verification
- [x] UI: Client messaging interface with reply capability
- [x] UI: Deliverables upload and management per phase
- [x] UI: New order creation form
- [x] UI: DashboardLayout with sidebar navigation
- [x] Design: Clean functional admin theme with dark sidebar
- [ ] Fix: Mobile hamburger menu icon color (make darker)
- [ ] Fix: Mobile hamburger menu right-edge spacing (shift 1px left / add right padding)
- [ ] Fix: Mobile hamburger dropdown not opening/working
- [x] DB: clientAccessTokens table (id, orderId, token, email, expiresAt, usedAt)
- [x] DB: clientUploads table (id, orderId, name, fileUrl, fileKey, mimeType, fileSize, createdAt)
- [x] Server: magic link generation procedure (admin sends link to client email)
- [x] Server: magic link validation + session cookie for client
- [x] Server: client portal procedures (get own order, phases, deliverables, messages, uploads)
- [x] Server: client upload procedure
- [x] Server: upsell/upgrade request procedure
- [x] UI: Client portal login page (/portal/login)
- [x] UI: Client portal dashboard (/portal/:token) - progress timeline, status
- [x] UI: Client portal deliverables tab - download files
- [x] UI: Client portal messaging tab - send/receive messages
- [x] UI: Client portal uploads tab - upload intake documents
- [x] UI: Client portal upsell section - upgrade from Jumpstart to Dominator
- [x] Admin: Send magic link button on order detail page
- [x] Stripe: Add stripe feature scaffold
- [x] Stripe: Server procedure to create Stripe payment link for AI Dominator upgrade
- [x] Stripe: Stripe webhook to confirm payment and auto-upgrade order tier
- [x] Stripe: Client portal upsell section shows real Stripe payment button
- [x] Gmail: Auto-send portal magic link email when new order is created
- [x] Gmail: Welcome email includes portal link, order summary, and next steps

## Content Studio - Social Media Automation Pipeline
- [x] DB: contentRuns table (id, runType, status, topicsRaw, topicsSelected, createdAt)
- [x] DB: publishedTopics table (id, title, summary, publishedAt, runId) - no-repeat logic
- [x] DB: generatedSlides table (id, runId, slideIndex, headline, summary, videoUrl, status)
- [x] Server: topic discovery - YouTube API, TikTok API, Reddit API scrapers
- [x] Server: GPT scoring agent - score 12 topics on 5 criteria, pick top 5
- [x] Server: no-repeat logic - exclude topics published in last 14 days
- [x] Server: Perplexity Sonar deep research stub (API key placeholder)
- [x] Server: Seedance video generation stub (API key placeholder)
- [x] Server: FFmpeg split-screen compositor (text card top + video bottom)
- [x] Server: Make.com webhook trigger for Instagram posting
- [x] Server: tRPC procedures for content studio (triggerRun, getRun, getRuns, approveTopics, swapTopic, getPublishedTopics)
- [x] UI: Content Studio page in admin dashboard sidebar
- [x] UI: Pipeline command center - trigger run, live status, progress steps
- [x] UI: Topic review panel - approve/swap topics before video generation
- [x] UI: Run history table with status and slide previews
- [x] UI: Post calendar showing Mon/Fri schedule
- [x] UI: Published topics exclusion list viewer
- [x] Vitest: tests for scoring agent and no-repeat logic

## API & Pipeline Improvements
- [ ] Secrets: Add OPENAI_API_KEY and ANTHROPIC_API_KEY
- [ ] Pipeline: Replace Perplexity with GPT-4o web search tool for Stage 4 deep research
- [ ] Pipeline: Use Claude Opus (Anthropic) for Stage 2 topic scoring instead of GPT-4o
- [ ] Pipeline: Set Instagram page name to "suggestedbygpt" in Make.com webhook payload
- [ ] Setup Guide: Update UI to show OpenAI/Anthropic keys instead of Perplexity

## Bug Fixes
- [x] Fix: pipeline fails with "Only 0 topics passed verification (need at least 3)" — added GPT-4o web search fallback for topic discovery when all social APIs are unavailable
- [x] Fix: topic review panel shows "Needs Review" status but no topics are visible in the UI — added empty state message and guard in continueAfterApproval to load topics from DB
- [x] Fix: Remove orders/client/portal dashboard — Content Studio is now the only page, all old routes removed from App.tsx and DashboardLayout nav
- [x] Fix: review dialog panel content overflows off screen — fixed with h-[90vh] + min-h-0 on ScrollArea
- [x] Fix: Approve All button not visible — moved to sticky header at top of review panel, always visible
- [x] Fix: removed duplicate DialogFooter approve button
- [x] Upgrade: multi-query GPT-4o web search (6 targeted queries) for 30-50 topic candidates
- [x] Upgrade: Reddit JSON API scraper (r/artificial, r/MachineLearning, r/singularity, r/ChatGPT)
- [x] Upgrade: improved scoring agent prompt with audience profile and variety rules for larger candidate pool
- [x] Upgrade: Add NewsAPI.org for real-time AI headlines with strict date filtering (last 7 days Monday, 3 days Friday)
- [x] Upgrade: Reduce GPT-4o queries from 6 to 3 with explicit current date injection and recency enforcement
- [x] Upgrade: Monday run = "this week in AI" (7-day window), Friday run = "last 48-72 hours in AI" (3-day window)
- [x] Upgrade: Pass runSlot to discoverTopics so correct recency window is applied per run type
- [x] Upgrade: Stage 4 deep research prompt — inject today's date + 15-day cutoff to enforce recency bias
- [x] UX: Swap topic dialog — add clarification text that research runs after Approve All

## Stage 5 Visual Generation — Nano Banana Images
- [ ] Stage 5: Replace Seedance video stub with Manus built-in generateImage() (Nano Banana Pro)
- [ ] Stage 5: Update image prompts to be cinematic still-image prompts (not video prompts)
- [ ] Stage 6: Update FFmpeg compositor to accept image input for bottom half of slide (instead of video)
- [ ] Stage 4: Update research prompt to generate "imagePrompt" instead of "videoPrompt"

## Stage 5 — Kling 2.5 Video Generation
- [ ] Stage 5: Add Kling 2.5 API integration (text-to-video, 5-second clips, 1080x1920 vertical)
- [ ] Stage 5: Use Kling as primary, Nano Banana image as fallback if Kling fails/no key
- [ ] Secrets: Add KLING_API_KEY and KLING_API_SECRET environment variables
- [ ] UI: Update Setup Guide to show Kling API key status (active/inactive)
- [ ] FFmpeg: Update compositor to handle both video (Kling) and image (Nano Banana) in bottom panel

## Kling API Credentials UI
- [ ] Add KLING_ACCESS_KEY and KLING_SECRET_KEY to server env and pipeline options
- [ ] Add tRPC mutation to save/update Kling credentials securely (stored in DB, not exposed to frontend)
- [ ] Add tRPC query to check if Kling credentials are configured (returns boolean only)
- [ ] Add Kling credentials input section in Content Studio setup UI (masked password fields)

## FFmpeg Assembly Fixes
- [x] Fix: Cover slide crashes with "line_spacing not supported" in FFmpeg 4.4 — removed line_spacing, switched to sequential numbered node chain
- [x] Fix: Content slides crash with "Error initializing complex filters" — fixed filter chain escaping and node naming
- [x] Fix: Cover slide node renaming logic produced broken [withhl] node — rewrote with explicit n0/n1/n2... sequential nodes
- [x] Add: KlingCredentialsCard component in Setup Guide tab with masked input fields, pricing info, and active/inactive status
- [x] Add: getKlingStatus and saveKlingCredentials tRPC procedures

## Stage 7 — Instagram Preview & Approval Gate
- [ ] Pipeline: Add Stage 7 caption generation (GPT-4o writes Instagram caption with hashtags from the 5 topics)
- [ ] DB: Add caption and postApproved columns to content_runs table
- [ ] Pipeline: Gate Make.com webhook — only fire after admin approves post (not automatically after assembly)
- [ ] Server: tRPC getRunPreview procedure — returns slides (videoUrl array) + caption + status
- [ ] Server: tRPC approvePost procedure — marks approved, fires Make.com webhook with slides + caption
- [ ] UI: Instagram-style carousel preview panel in run detail view (swipeable slides, phone mockup frame)
- [ ] UI: Caption display with hashtags below the carousel preview
- [ ] UI: Approve to Post button (green) + Edit Caption inline before approving
- [ ] UI: Show "Pending Your Approval" badge on runs that are assembled but not yet posted

## Pipeline Timeout
- [x] Force-fail stuck runs #30001 and #60001
- [x] Add 30-minute timeout: auto-fail runs stuck in assembling/generating stage
- [x] Add timeout check on pipeline start and via periodic DB check

## Interactive Carousel Preview
- [x] Prev/next arrow navigation buttons
- [x] Active slide dot indicator
- [x] Click-to-enlarge lightbox with video playback controls
- [x] Thumbnail strip navigation with active highlight
- [x] Visible scrollbar / swipe support

## Canva Pipeline Integration (evolving.ai style)
- [x] Build canvaCompositor.ts (upload asset to Canva → generate-design → create-from-candidate → export PNG)
- [x] Replace Stage 6 FFmpeg assembly with canvaCompositor in contentPipeline.ts
- [x] Update GPT prompts to generate provocative ALL-CAPS evolving.ai-style headlines
- [x] Handle video slides: upload Kling MP4 to Canva, export as MP4
- [x] Graceful fallback to FFmpeg if Canva MCP call fails

## Sharp Compositor Quality Upgrade (evolving.ai / airesearches style)
- [ ] Heavier bottom gradient (darker, taller — text sits on solid dark band at bottom)
- [ ] Better font: install Anton/Oswald Bold, highlight 1-2 key words in yellow/orange accent
- [ ] Cover slide: edgy eye-catching image prompt + "5 THINGS THAT HAPPENED IN AI THIS WEEK" style title
- [ ] Fix carousel image cropping in dashboard (full image visible, no edge clipping)
- [ ] Mixed carousel: 2 video slides + 2 image slides per run (AI decides which topics get video)
- [ ] Pipeline: assign isVideo=true for 2 topics, isVideo=false for 2 topics automatically

## Virality Framework Integration (GitHub Research)
- [ ] Fix carousel preview: show full 1080x1350 image without edge cropping in phone mockup
- [ ] Fix cover photo [object Object] display bug in run detail
- [ ] Integrate virality hook formulas into LLM prompt (FOMO, Big Opportunity, RIP Pattern, Contrarian)
- [ ] Add 5-pillar carousel structure to slide generation: Hook → Problem → Solution → Proof → CTA
- [ ] Add hashtag strategy engine: 5-10 niche-specific tags, mix of large/medium/small reach
- [ ] Add caption optimizer: open loop hook + surprising stat + CTA question
- [ ] Add virality scoring to topic selection: controversy score, information gap, emotional trigger
- [ ] Add posting time recommendation display (Tue-Fri 9-11am or 6-8pm)
- [ ] Slide text: max 10-15 words per slide, 1 idea per slide rule enforced in prompt
- [ ] Cover slide: always lead with a surprising stat or contrarian claim

## Insight Line Feature (Slide Context)
- [x] DB: Add insightLine column to generatedSlides table
- [x] Research prompt: GPT generates optional insightLine (1 sentence, max 12 words) per slide — null if headline is self-explanatory
- [x] Compositor: Render insightLine as chat bubble below headline when present
- [x] Fix Kling ESM crash: replace jsonwebtoken (CJS) with jose (ESM-native)
- [x] Fix carousel preview: image edges clipped in phone mockup lightbox (object-cover → object-contain)
- [x] Add subtle dry/dark humor tone to headline + insightLine prompts — occasional, natural, not forced

## Bug: Kling Key Save
- [x] Fix Kling API keys disappearing after Save & Activate in Setup Guide

## Image/Video Prompt Specificity & Video Layout
- [x] Fix image prompts: must be story-specific (name actual product/company/event/person), not generic AI/robot/server scenes
- [x] Fix video prompts: same — directly tied to the specific headline and story
- [x] Video slide layout: top 70% video edge-to-edge + gradient fade into solid black bottom 30% with headline text

## Regenerate Slide Feature
- [x] Server: tRPC regenerateSlide procedure — accepts runId + slideId, re-runs image or video generation for that single slide, re-assembles the composite, updates DB
- [x] Server: try/catch wraps generation — resets slide status to "failed" if anything throws, never leaves slide stuck in "generating_video"
- [x] Server: NaN guard on Drizzle sql`NULL` cast to safely clear varchar columns
- [x] UI: Add "Re-roll" button on each slide in RunDetailDialog carousel (icon button, shows spinner while regenerating)
- [x] UI: Disables all other Re-roll buttons while one regeneration is in progress
- [x] UI: After regeneration completes, auto-refreshes the slide in the carousel without closing the dialog
- [x] Vitest: 12 tests covering input validation, state transitions, and edge cases

## Audio / Music for Posts
- [x] Server: Module-level TRACK_LIBRARY (8 royalty-free epic/cinematic tracks, CC BY 4.0)
- [x] Server: getMusicSuggestion tRPC query — GPT picks best matching track from curated list based on run topics
- [x] Server: JSON.parse guard on topicsSelected — returns null gracefully on malformed data
- [x] Server: NaN guard on LLM track index response
- [x] UI: "Recommended Track" card in RunDetailDialog approval view — shows track name, artist, mood, BPM, license, and link
- [x] UI: Card only loads when run is in pending_post status (staleTime: 5 min to avoid re-querying LLM)
- [x] Note: Instagram API does not support programmatic audio — track must be selected manually in IG's music picker when posting
