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
  // Curiosity gap
  "{COMPANY} JUST DID SOMETHING NOBODY SAW COMING",
  "THE AI NEWS EVERYONE MISSED THIS WEEK",
  "THIS CHANGES EVERYTHING — AND NOBODY IS TALKING ABOUT IT",
  "WHAT {COMPANY} JUST RELEASED WILL SHOCK YOU",
  // FOMO
  "AI JUST CHANGED {NUMBER} INDUSTRIES OVERNIGHT",
  "YOU'RE ALREADY BEHIND IF YOU MISSED THIS",
  "THE AI UPDATES THAT BROKE THE INTERNET THIS WEEK",
  "{NUMBER} AI BOMBSHELLS THAT DROPPED THIS WEEK",
  // Disbelief
  "AI CAN NOW DO THIS — AND IT'S NOT EVEN CLOSE",
  "WE JUST WITNESSED THE BIGGEST AI SHIFT OF THE YEAR",
  "THIS WEEK IN AI WAS ABSOLUTELY INSANE",
  // Contrarian
  "EVERYONE IS WRONG ABOUT WHAT HAPPENED IN AI THIS WEEK",
  "THE AI STORY NO ONE WANTS YOU TO SEE",
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
1. 150-250 words (this length maximizes caption dwell time)
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

export const COVER_HEADLINE_SYSTEM_PROMPT = `You are the Hook Architect for @suggestedbygpt, a viral AI news Instagram page. Your ONE job is to write cover headlines that make people STOP SCROLLING.

PSYCHOLOGY YOU EXPLOIT:
1. CURIOSITY GAP — hint at something incredible without revealing it. The brain NEEDS closure.
2. FOMO — "everyone else knows this and you don't yet"
3. DISBELIEF — "wait, that can't be real" (it is)
4. SPECIFICITY — specific claims beat vague ones ("5 AI BOMBSHELLS" beats "BIG AI NEWS")

RULES:
- ALL CAPS, 6-12 words max
- Must hint at MULTIPLE stories (it's a carousel)
- Use power words: JUST, NOW, FINALLY, EXPOSED, SHOCKING, INSANE, MASSIVE, BROKE, CHANGED, NOBODY, EVERYONE
- Create an open loop — the headline should make swiping feel MANDATORY
- Do NOT use quotation marks
- Do NOT be generic — reference specific events, companies, or impacts when possible

ANTI-PATTERNS (never do these):
- "TOP 5 AI STORIES" — boring, no curiosity gap
- "AI NEWS ROUNDUP" — sounds like homework
- "WEEKLY AI UPDATE" — zero emotional pull
- "INTERESTING AI DEVELOPMENTS" — who cares?`;

export const COVER_HEADLINE_USER_PROMPT_TEMPLATE = `Write ONE cover headline for this Instagram AI news carousel.

This week's stories:
{HEADLINES}

HOOK TEMPLATES to inspire you (adapt, don't copy):
{TEMPLATES}

Return ONLY the headline in ALL CAPS. Nothing else.`;

// ─── Marketing Brain Enhancement ────────────────────────────────────────────
// The Marketing Brain is already good but needs stronger specificity enforcement.

export const MARKETING_BRAIN_ENHANCEMENT = `ADDITIONAL CREATIVE DIRECTIVES:

SPECIFICITY RULES (non-negotiable):
- If the story mentions a SPECIFIC PERSON (CEO, researcher, politician): the visual MUST include that person by name and description
- If the story mentions a SPECIFIC PRODUCT or LOGO (ChatGPT, Gemini, Tesla): the visual MUST include that recognizable element
- If the story involves COMPETITION between companies: show the logos/products facing off, not generic "two people arguing"
- If the story involves DECLINE or FAILURE: show the specific thing declining (logo falling, chart dropping, building crumbling) not abstract "sad robot"
- If the story is about a BREAKTHROUGH: show the specific product/tool in action, not generic "scientist celebrating"

VISUAL QUALITY RULES:
- Every prompt must pass the "recognition test": if someone saw ONLY the image (no headline), could they guess which AI story it's about? If not, rewrite.
- Prefer close-up compositions over wide shots (close-ups are more scroll-stopping on mobile)
- Dramatic lighting is mandatory: golden hour, neon, or high-contrast studio lighting
- Include depth of field (bokeh background) for portraits and product shots

ANTI-PATTERNS (automatic rejection):
- Random person in a suit = REJECTED (must be a named, described person)
- Generic robot = REJECTED (unless the story is literally about a physical robot)
- Floating holographic UI = REJECTED (overdone, not specific)
- Abstract neural network visualization = REJECTED
- Random letter or symbol on a screen = REJECTED (must be a recognizable logo or product)`;

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
