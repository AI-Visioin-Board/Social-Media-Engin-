/**
 * viralityFramework.ts
 *
 * Encodes data-backed Instagram growth strategies specifically for
 * AI news carousel accounts (@evolving.ai, @airesearches style).
 *
 * Research sources:
 * - Buffer Instagram Algorithm Guide 2026
 * - Hootsuite Instagram Carousel Guide
 * - TrueFuture Media Carousel Strategy 2026
 * - Cliptics: Instagram 5-hashtag limit (Dec 2025)
 * - Social-Media-Engagement-Forecasting (GitHub)
 * - Creator Growth Navigator (GitHub)
 *
 * Key algorithm signals (2026, strongest → weakest):
 * 1. Shares / DM sends (strongest for Explore distribution)
 * 2. Saves (signals long-term value)
 * 3. Comments (especially conversation depth — replies >5 words)
 * 4. Watch time / Dwell time (caption dwell time now tracked)
 * 5. Likes (weakest signal)
 *
 * Carousels get 1.9x higher reach than single-image posts,
 * 10.15% avg engagement rate. Unswiped slides get re-served as
 * "new content" — multiple chances at engagement.
 */

// ─── Cover Headline Hook Templates ──────────────────────────────────────────
// These are curiosity-gap and FOMO formulas proven to work for AI news accounts.
// The LLM picks the best-fitting template and adapts it to the week's stories.

export const COVER_HOOK_TEMPLATES = [
  // ─── Curiosity gap ───
  "{COMPANY} JUST DID SOMETHING NOBODY SAW COMING",
  "THE AI NEWS EVERYONE MISSED THIS WEEK",
  "THIS CHANGES EVERYTHING — AND NOBODY IS TALKING ABOUT IT",
  "WHAT {COMPANY} JUST RELEASED WILL SHOCK YOU",
  // ─── FOMO ───
  "AI JUST CHANGED {NUMBER} INDUSTRIES OVERNIGHT",
  "YOU'RE ALREADY BEHIND IF YOU MISSED THIS",
  "THE AI UPDATES THAT BROKE THE INTERNET THIS WEEK",
  "{NUMBER} AI BOMBSHELLS THAT DROPPED THIS WEEK",
  // ─── Disbelief ───
  "AI CAN NOW DO THIS — AND IT'S NOT EVEN CLOSE",
  "WE JUST WITNESSED THE BIGGEST AI SHIFT OF THE YEAR",
  "THIS WEEK IN AI WAS ABSOLUTELY INSANE",
  // ─── Contrarian ───
  "EVERYONE IS WRONG ABOUT WHAT HAPPENED IN AI THIS WEEK",
  "THE AI STORY NO ONE WANTS YOU TO SEE",
  // ─── Newsletter / straight-news style ───
  "{COMPANY} JUST ANNOUNCED {PRODUCT} — HERE'S WHAT IT DOES",
  "THE {NUMBER} BIGGEST AI STORIES THIS WEEK",
  "{COMPANY} VS {COMPANY} — ONE OF THEM JUST WON",
  "HERE'S WHAT ACTUALLY HAPPENED WITH {COMPANY} THIS WEEK",
  // ─── Stakes / consequence ───
  "THIS IS THE AI UPDATE THAT WILL ACTUALLY AFFECT YOU",
  "{COMPANY} JUST MADE YOUR FAVORITE APP OBSOLETE",
  "YOUR JOB JUST GOT HARDER — OR EASIER. SWIPE TO FIND OUT",
  "THE AI MOVE WALL STREET DIDN'T SEE COMING",
  // ─── Specificity-first (name-drops) ───
  "{PERSON} JUST SAID SOMETHING THAT SHOCKED THE ENTIRE INDUSTRY",
  "{COMPANY} DROPPED A BOMBSHELL — {NUMBER} THINGS TO KNOW",
  "THE REAL REASON {COMPANY} JUST {ACTION}",
  // ─── Calm authority (not every cover needs to scream) ───
  "AI NEWS — {DATE} EDITION",
  "THIS WEEK IN AI — THE {NUMBER} STORIES THAT MATTER",
  "WHAT YOU NEED TO KNOW ABOUT AI THIS WEEK",
  // ─── Question hooks ───
  "DID {COMPANY} JUST KILL {PRODUCT}?",
  "IS THIS THE END OF {CONCEPT}?",
  "WHY IS NOBODY TALKING ABOUT THIS?",
];

// ─── Caption Framework ──────────────────────────────────────────────────────
// Instagram 2026: keyword-rich captions > hashtags for discoverability.
// Captions should be 150-250 words with SEO keywords.
// DM shares are the #1 algorithm signal — every caption must prompt shares.

export const CAPTION_SYSTEM_PROMPT = `You are the Head of Content Strategy for @suggestedbygpt, a fast-growing AI news Instagram page. You write captions that are ENGINEERED for the Instagram 2026 algorithm.

YOUR KNOWLEDGE OF THE ALGORITHM:
- DM shares/sends are the #1 ranking signal — content that gets forwarded to friends gets Explore page distribution
- Saves are #2 — content with lasting reference value
- Caption dwell time is now tracked — longer, engaging captions that people READ boost ranking
- Instagram is now a search engine — keyword-rich captions outperform hashtag-stuffed ones
- Conversation depth matters — comments >5 words signal "high social relevance"

YOUR CAPTION FORMULA:
1. HOOK LINE (first line, visible before "more" tap): 6-10 words, creates irresistible curiosity gap. Must make someone tap "more."
2. STORY TEASERS: 2-3 sentences that hint at the carousel content WITHOUT giving it all away. Use specific numbers, names, and claims.
3. ENGAGEMENT BRIDGE: 1 sentence that creates FOMO or urgency ("This one caught even the experts off guard")
4. SHARE PROMPT: Natural call to share — "Send this to someone who needs to see this" or "Tag a friend who's still sleeping on AI"
5. SAVE PROMPT: "Save this for reference" or "Bookmark this before the algorithm hides it"
6. CTA: "Swipe to see all the stories →" or "Which one shocked you most? Comment below 👇"

KEYWORD SEO RULES:
- Naturally weave in these keywords throughout the caption: AI, artificial intelligence, machine learning, tech news, AI tools, AI updates
- Use LSI (related) keywords: automation, future of work, AI breakthrough, neural network, language model, etc.
- Keywords should read naturally — never keyword-stuff

TONE:
- Conversational but authoritative — like a tech-savvy friend who always knows the news first
- Slightly irreverent, not corporate
- Use 3-5 emojis as visual separators, not decoration
- Line breaks every 1-2 sentences for scannability`;

export const CAPTION_USER_PROMPT_TEMPLATE = `Write an Instagram caption for this AI news carousel.

This week's stories:
{TOPICS}

REQUIREMENTS:
1. 75-120 words MAXIMUM (short punchy captions outperform long ones on Instagram — be ruthlessly concise)
2. First line MUST create a curiosity gap (this is the only line visible before "more" tap)
3. Include a natural share prompt (DM shares = strongest algorithm signal)
4. Include a save prompt (saves = second strongest signal)
5. End with an engaging question to spark comments >5 words
6. Weave in SEO keywords naturally: AI, artificial intelligence, tech news, AI updates
7. Place exactly 3-5 hashtags at the very end (Instagram's 2026 limit)
8. Use line breaks for scannability

HASHTAG RULES (critical — Instagram now limits to 5):
- Use exactly 3-5 hashtags
- Mix: 2-3 niche (#AINews, #ArtificialIntelligence, #MachineLearning) + 1-2 trending (specific to THIS week's stories)
- Place IN the caption (not comments) — this gets 36% more reach
- NEVER reuse the exact same hashtag set as previous posts

Return ONLY the caption text, no explanation.`;

// ─── Hashtag Strategy ────────────────────────────────────────────────────────
// Instagram Dec 2025: Max 5 hashtags. Keyword captions now drive ~30% more reach.

export const NICHE_HASHTAGS = [
  "#AINews", "#ArtificialIntelligence", "#MachineLearning",
  "#TechNews", "#AITools", "#FutureOfAI", "#AIUpdates",
  "#AIcommunity", "#DeepLearning", "#GenerativeAI",
];

export const TRENDING_HASHTAG_POOLS = {
  openai: ["#OpenAI", "#ChatGPT", "#GPT5", "#GPT4o"],
  google: ["#Gemini", "#GoogleAI", "#DeepMind", "#GoogleIO"],
  meta: ["#MetaAI", "#LLaMA", "#Llama3"],
  anthropic: ["#Claude", "#Anthropic", "#ClaudeAI"],
  microsoft: ["#Copilot", "#MicrosoftAI", "#Azure"],
  apple: ["#AppleAI", "#AppleIntelligence", "#Siri"],
  general: ["#AIRevolution", "#TechTrends", "#Innovation", "#FutureTech"],
};

// ─── Cover Headline Hook System ──────────────────────────────────────────────

export const COVER_HEADLINE_SYSTEM_PROMPT = `You are the Hook Architect for @suggestedbygpt, a viral AI news Instagram page (newsletter-style). Your job is to write cover headlines that make people STOP SCROLLING.

CRITICAL: VARIETY IS EVERYTHING. If every cover headline sounds the same, followers tune out. You MUST rotate between different headline TONES:

HEADLINE TONE CATEGORIES (rotate between these — never use the same tone twice in a row):
1. CURIOSITY GAP — hint at something incredible without revealing it ("THIS CHANGES EVERYTHING — AND NOBODY IS TALKING ABOUT IT")
2. FOMO — "everyone else knows this and you don't yet" ("YOU'RE ALREADY BEHIND IF YOU MISSED THIS")
3. STRAIGHT NEWS — just state what happened, let the story speak ("OPENAI JUST RELEASED GPT-5 — HERE'S WHAT IT DOES")
4. QUESTION HOOK — pose a provocative question ("DID GOOGLE JUST KILL SEARCH?")
5. NAME-DROP — lead with the person or company ("SAM ALTMAN JUST SAID SOMETHING THAT SHOCKED THE INDUSTRY")
6. CALM AUTHORITY — newsletter voice, not screaming ("AI NEWS — THIS WEEK'S 4 BIGGEST STORIES")
7. STAKES / CONSEQUENCE — tell people why it matters to THEM ("THIS AI UPDATE WILL ACTUALLY AFFECT YOUR JOB")
8. CONTRARIAN — go against the grain ("EVERYONE IS WRONG ABOUT WHAT HAPPENED IN AI THIS WEEK")

RULES:
- ALL CAPS, 8-16 words max (longer headlines perform better — fill the space)
- Must hint at MULTIPLE stories (it's a carousel) OR name the single biggest story
- Power words are fine but NOT required every time — sometimes a clean, direct headline wins
- Do NOT use quotation marks
- Do NOT be generic — reference specific events, companies, or impacts when possible
- Not every headline needs to be hyperbolic. A calm, confident headline can scroll-stop just as effectively.

ANTI-PATTERNS (never do these):
- "TOP 5 AI STORIES" — boring, no curiosity gap
- "AI NEWS ROUNDUP" — sounds like homework
- "WEEKLY AI UPDATE" — zero emotional pull
- "INTERESTING AI DEVELOPMENTS" — who cares?
- Using the SAME formula as last time — variety is king`;

export const COVER_HEADLINE_USER_PROMPT_TEMPLATE = `Write ONE cover headline for this Instagram AI news carousel.

This week's stories:
{HEADLINES}

HOOK TEMPLATES to inspire you (adapt, don't copy):
{TEMPLATES}

Return ONLY the headline in ALL CAPS. Nothing else.`;

// ─── Marketing Brain Enhancement ────────────────────────────────────────────
// The Marketing Brain is already good but needs stronger specificity enforcement.

export const MARKETING_BRAIN_ENHANCEMENT = `ADDITIONAL CREATIVE DIRECTIVES:

IMAGE GENERATION CAPABILITIES (2026 — UPDATED):

✅ NANO BANANA (GEMINI) CAN GENERATE:
- Named public figures with recognizable faces (tested: Elon Musk, Tim Cook, Sam Altman, Sundar Pichai — all look accurate)
- Multiple named people in the same scene
- People with specific expressions, poses, clothing, and settings
- USE THIS FOR ALL person_composite slides — it is the PRIMARY model for people

✅ DALL-E 3 CAN GENERATE:
- Stunning cinematic environments, landscapes, abstract scenes
- Any scene WITHOUT people (pure backgrounds for cinematic_scene and scene_with_badge)

❌ WHAT STILL DOESN'T WORK:
- DALL-E 3 CANNOT render recognizable faces (always use Nano Banana for people)
- No model can render accurate company logos (we composite real logo PNGs separately — just specify logoKeys)
- No model can render readable text (we add text overlays in post-production)

REAL LOGOS: Do NOT describe logos in the scene prompt. Just set logoKeys to the relevant companies — we composite real transparent PNG logos on top of the image separately. Your scene prompt should be LOGO-FREE.

REAL PEOPLE: For person_composite, describe the ACTUAL PERSON by name in your scenePrompt. Nano Banana generates recognizable faces. Include: full name, title, signature clothing, expression, pose, lighting, lens, color grade.

10-PART FRAMEWORK MANDATORY: Every scene prompt (person or not) MUST include all 10 parts: (1) Subject, (2) Action & Context, (3) Environment, (4) Mood & Story, (5) Visual Style, (6) Lighting & Color, (7) Camera & Composition, (8) Detail & Texture, (9) Quality & Realism, (10) Negative Constraints. If any part is missing, the image WILL look generic.

PRODUCTS & APPS: Show a phone or laptop screen from a distance with the right color scheme. Show someone's hand holding a phone with a glowing interface. Show the product's physical context.

VISUAL QUALITY RULES:
- Every prompt must pass the "recognition test": if someone saw ONLY the image (no headline), could they guess which company/story it's about from the PEOPLE, COLORS and CONTEXT? If not, rewrite.
- Prefer close-up compositions over wide shots (close-ups are more scroll-stopping on mobile)
- Dramatic lighting is mandatory: golden hour, neon, or high-contrast studio lighting
- Include depth of field (bokeh background) for product shots
- PERSON-FIRST: If a story mentions a CEO/founder, the DEFAULT is person_composite with their face filling 60-80% of the frame

ANTI-PATTERNS (automatic rejection):
- Server rooms or data centers = REJECTED (overdone — we've used this 6+ times in a row)
- Generic robot = REJECTED (unless the story is literally about a physical robot)
- Floating holographic UI = REJECTED (overdone, not specific)
- Abstract neural network visualization = REJECTED
- Faceless silhouettes in front of screens = REJECTED (use real people via person_composite instead)
- Random people in suits = REJECTED (use named public figures)`;

// ─── Insight Line Strategy ──────────────────────────────────────────────────
// The chat bubble context line should add SHARE-WORTHY commentary

export const INSIGHT_LINE_GUIDELINES = `The insightLine is a short chat-bubble annotation that appears below the headline on the slide. It should make someone want to SCREENSHOT and SHARE this slide.

GOOD insight lines (share-worthy):
- "This means your job interview might be with an AI next year"
- "Google spent $30B on this and OpenAI did it for free"
- "Your phone is about to get a LOT smarter"
- "This is why tech stocks dropped 12% on Tuesday"

BAD insight lines (generic, not share-worthy):
- "This is an interesting development in AI"
- "Many experts are watching this closely"
- "This could have significant implications"
- "The AI industry continues to evolve"

Rules:
- Max 1 sentence, under 80 characters
- Must connect the story to the READER'S life or something they care about
- Should provoke a reaction: surprise, concern, excitement, or humor
- Set to null if the headline alone is self-explanatory — don't force it`;

// ─── Posting Time Strategy ──────────────────────────────────────────────────

export const OPTIMAL_POSTING_WINDOWS = {
  monday: { primary: "11:00 AM EST", secondary: "7:00 PM EST" },
  tuesday: { primary: "10:00 AM EST", secondary: "6:00 PM EST" },
  wednesday: { primary: "11:00 AM EST", secondary: "7:00 PM EST" },
  thursday: { primary: "10:00 AM EST", secondary: "6:00 PM EST" },
  friday: { primary: "9:00 AM EST", secondary: "5:00 PM EST" },
  saturday: { primary: "10:00 AM EST", secondary: "12:00 PM EST" },
  sunday: { primary: "10:00 AM EST", secondary: "7:00 PM EST" },
};

// ─── Engagement Maximizers ──────────────────────────────────────────────────

export const SHARE_PROMPT_TEMPLATES = [
  "Send this to someone who needs to see this 📩",
  "Tag a friend who's still sleeping on AI 👀",
  "Share this with your team — they need to know 🔗",
  "Forward this to someone in tech 📱",
  "Your friends need to see slide {N} 🤯",
];

export const SAVE_PROMPT_TEMPLATES = [
  "Save this for reference 🔖",
  "Bookmark this before the algorithm buries it 📌",
  "Save this — you'll want to come back to it 💾",
];

export const COMMENT_PROMPT_TEMPLATES = [
  "Which story shocked you the most? Comment below 👇",
  "What's your take on story #{N}? Drop your thoughts 💬",
  "Agree or disagree with #{N}? Let's debate 🔥",
  "Which of these will have the biggest impact? Tell us 👇",
  "Did we miss a story? Drop it in the comments 💡",
];

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATED MARKETING INTELLIGENCE — GitHub Research (March 2026)
//
// Sources:
// - twitter/the-algorithm (62k★) — X/Twitter open-source ranking system
// - xai-org/x-algorithm — Grok-based engagement prediction model
// - langchain-ai/social-media-agent (1.8k★) — AI content curation pipeline
// - Social-Media-Engagement-Forecasting — Prophet + XGBoost engagement models
// - EngagementGNN (ACM ICMR 2023) — Graph neural network engagement prediction
// - pyviralcontent — Readability + virality scoring (Keener's method)
// - Buffer, Sprout Social, Emplifi 2026 research reports
// - Instagram Algorithm December 2025 update analysis
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Instagram Algorithm Signal Hierarchy (2026 Update) ─────────────────────
// Instagram runs 4 SEPARATE algorithms: Feed, Reels, Stories, Explore
// Each has different ranking priorities. For carousel posts (our format):

export const ALGORITHM_SIGNAL_WEIGHTS = {
  // Ranked by impact on distribution (from X/Twitter algorithm + Instagram research)
  sends_per_reach: { weight: 5.0, description: "DM shares — weighted 3-5x higher than likes" },
  saves_per_reach: { weight: 3.5, description: "Bookmarks — signals lasting reference value" },
  comments_quality: { weight: 2.5, description: "Comments >5 words — conversation depth" },
  dwell_time: { weight: 2.0, description: "Time spent on post — caption + carousel swipes" },
  likes_per_reach: { weight: 1.0, description: "Weakest signal — baseline engagement" },
  // Negative signals (from twitter/the-algorithm)
  not_interested: { weight: -3.0, description: "Hide/not interested clicks tank distribution" },
  unfollow_after: { weight: -5.0, description: "Unfollow after seeing = strong negative signal" },
} as const;

// ─── Content Format Performance Benchmarks ──────────────────────────────────
// Data from Emplifi (399M posts) + Buffer (9.6M Instagram posts, 2026)

export const FORMAT_BENCHMARKS = {
  reels: { engagementRate: 2.08, reachMultiplier: 1.0, note: "Best for discovery" },
  carousel: { engagementRate: 1.70, reachMultiplier: 1.9, note: "Our format — 1.9x reach vs single images. Instagram reshows unswiped slides as NEW content" },
  single_image: { engagementRate: 1.17, reachMultiplier: 1.0, note: "Baseline" },
} as const;

// ─── Engagement Probability Model ───────────────────────────────────────────
// Adapted from twitter/the-algorithm + xai-org/x-algorithm engagement prediction.
// The X algorithm predicts P(favorite), P(reply), P(repost), P(share), P(dwell), etc.
// We adapt this for Instagram content scoring:

export const VIRALITY_SCORE_FORMULA = `
VIRALITY SCORING MODEL (use for topic selection and content ranking):

For each piece of content, estimate these probabilities (0.0 to 1.0):
  P(share)     — Will viewers DM this to a friend? (MOST IMPORTANT)
  P(save)      — Will viewers bookmark this for later?
  P(comment)   — Will viewers write a meaningful comment (>5 words)?
  P(dwell)     — Will viewers read the full caption + swipe all slides?
  P(like)      — Will viewers double-tap? (least important)

WEIGHTED SCORE = (P(share) × 5.0) + (P(save) × 3.5) + (P(comment) × 2.5) + (P(dwell) × 2.0) + (P(like) × 1.0)

Topics scoring 8.0+ are EXCELLENT (strong virality potential)
Topics scoring 5.0-8.0 are GOOD (solid engagement)
Topics scoring <5.0 should be REPLACED with better topics

WHAT DRIVES EACH SIGNAL:
- P(share) ↑: Controversy, "tag a friend who...", insider knowledge, industry gossip, career impact
- P(save) ↑: How-to value, reference data, statistics, predictions, tool recommendations
- P(comment) ↑: Debate-worthy claims, "agree or disagree?", predictions people want to weigh in on
- P(dwell) ↑: Surprising stats, multi-step stories, narrative tension, curiosity gaps
- P(like) ↑: Aesthetically pleasing, relatable, feel-good, community identity

WHAT KILLS ENGAGEMENT:
- Generic/vague headlines (no specific names, numbers, or stakes)
- Topics that feel "old news" (even 3 days old can feel stale in AI)
- Corporate PR announcements with no controversy or consequence
- Topics the audience can't relate to (too niche, too academic)
`;

// ─── Instagram 2026 Algorithm Rules ─────────────────────────────────────────
// Compiled from December 2025 algorithm update + 2026 data

export const INSTAGRAM_2026_RULES = `
INSTAGRAM ALGORITHM RULES (2026):

1. KEYWORD SEO > HASHTAGS: Instagram removed hashtag following in Dec 2024. The platform
   now works like a search engine. Use keyword-rich captions with natural SEO terms
   (AI, artificial intelligence, machine learning, tech news). Hashtags are secondary (3-5 max).

2. FOUR SEPARATE ALGORITHMS: Feed, Reels, Stories, and Explore each rank content differently.
   Our carousel posts are ranked by the Feed algorithm (relationship signals, engagement velocity,
   recency, content type preference).

3. CAROUSEL RESHOWING: Unswiped slides get re-served as "new content" to followers who didn't
   swipe through the whole carousel. This means each slide is a NEW engagement opportunity.
   Design slides to be independently compelling.

4. EARLY ENGAGEMENT VELOCITY: Posts that get engagement in the first 30-60 minutes get boosted.
   Post during peak engagement windows and have engagement-ready captions.

5. MICRO-NICHE CATEGORIZATION: Instagram's AI categorizes your account based on your last
   9-12 posts. Maintain consistent AI/tech news topic focus for algorithmic trust.

6. TRIAL REELS: Instagram now tests content with non-followers first. Even though we post
   carousels, this reveals the algorithm's preference: CONTENT THAT WORKS WITH STRANGERS
   gets the most distribution.

7. POSTING FREQUENCY: 6-9 posts per week is optimal. Our Mon/Fri schedule (2 posts/week)
   is below optimal — consider adding mid-week content.

8. CONSISTENCY > TIMING: While timing matters (Tue-Thu 11am-6pm), consistency of posting
   schedule matters MORE for building algorithmic trust.
`;

// ─── Virality Scoring for Topic Selection ───────────────────────────────────
// Injected into the GPT scoring agent prompt for Stage 2

export const TOPIC_VIRALITY_SCORING_PROMPT = `
VIRALITY ASSESSMENT (score each factor 1-10):

1. SHAREABILITY (weight: 5x) — Would someone DM this to a friend?
   - 10: "OMG you NEED to see this" — career-threatening, life-changing, or hilarious
   - 7-9: "Interesting, you should check this out" — notable but not urgent
   - 4-6: "Huh, that's cool" — interesting but not share-worthy
   - 1-3: "Meh" — no impulse to share

2. SAVE-WORTHINESS (weight: 3.5x) — Would someone bookmark this?
   - 10: Actionable data, tool recommendations, career advice
   - 7-9: Reference-worthy stats or predictions
   - 4-6: Interesting but no lasting value
   - 1-3: Purely ephemeral news

3. DEBATE POTENTIAL (weight: 2.5x) — Would people argue about this?
   - 10: Deeply controversial, moral implications, winners vs losers
   - 7-9: Strong opinions likely, reasonable people disagree
   - 4-6: Some discussion, mostly agreement
   - 1-3: Nothing to debate

4. INFORMATION GAP (weight: 2x) — How much do people NOT know about this?
   - 10: "Wait, WHAT?!" — completely unknown to most people
   - 7-9: "I heard something but didn't know the details"
   - 4-6: "Yeah, I saw the headline"
   - 1-3: "Old news, everyone knows"

5. PERSONAL IMPACT (weight: 1x) — Does this affect the viewer's life/career?
   - 10: Direct job/income/tool impact
   - 7-9: Indirect but real impact
   - 4-6: Interesting but no personal stakes
   - 1-3: Academic/abstract

WEIGHTED VIRALITY SCORE = (Shareability × 5) + (SaveWorthiness × 3.5) + (DebatePotential × 2.5) + (InformationGap × 2) + (PersonalImpact × 1) / 14

Topics with Virality Score < 5.0 should be REPLACED.
`;

// ─── Content Readability Optimization ───────────────────────────────────────
// From pyviralcontent research — content virality correlates with readability

export const READABILITY_RULES = `
READABILITY FOR VIRALITY (backed by research):
- Headlines: 8-16 words. Flesch-Kincaid grade level 4-6 (5th grader can understand)
- Slide text: Max 10-15 words per slide. ONE idea per slide.
- Caption: 150-250 words. Grade level 6-8. Short sentences (under 20 words each).
- Use CONCRETE language: specific numbers, names, actions — never abstract concepts
- The "bar test": if you couldn't explain this headline to a stranger at a bar, it's too complex
`;

// ─── Dynamic Engagement Boosters ────────────────────────────────────────────
// Carousel-specific tactics derived from Emplifi + Hootsuite 2026 data

export const CAROUSEL_ENGAGEMENT_TACTICS = {
  slideCount: "5-10 slides optimal (we use 5 — the sweet spot for news roundups)",
  firstSlide: "Slide 1 = HOOK. Must create enough curiosity to swipe. Show the BIGGEST story.",
  lastSlide: "Slide 5 = CTA. End with a save-worthy takeaway + engagement question.",
  progression: "Each slide should escalate in intensity or relevance. Never put the best story first — build to it.",
  independentValue: "Each slide must be independently valuable — Instagram reshows unswiped slides as standalone content.",
  textDensity: "Low text, high visual impact. The image does the work; the headline creates context.",
  colorConsistency: "Consistent dark theme + cyan accents across ALL slides builds brand recognition.",
} as const;
