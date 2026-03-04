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
- ALL CAPS, 6-12 words max
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

CRITICAL REALITY CHECK — AI image generators CANNOT accurately render:
- Real people's faces (they will look like random strangers, NOT the actual person)
- Accurate company logos (they will be garbled/wrong)
- Readable text of any kind

SO YOUR VISUAL STRATEGY MUST WORK AROUND THESE LIMITATIONS:

WHAT TO DO INSTEAD (pick the best approach for each story):

1. REAL LOGOS → Use the logo as a PHYSICAL OBJECT in a scene. Don't try to draw it accurately. Instead describe: "A large glowing orb/sphere bearing the [company] brand colors [describe the specific colors], sitting on [dramatic scene]". Use the company's SIGNATURE COLORS as the identifier. OpenAI = green/white swirl shape. Google = red/blue/yellow/green. Anthropic = orange/brown. Meta = blue. Apple = silver/white. Microsoft = 4-color grid.

2. REAL PEOPLE → NEVER try to generate a specific person's face. Instead:
   - Show them from BEHIND (silhouette at a podium, from-behind shot at a conference)
   - Show their HANDS doing something (typing, holding a phone, gesturing at a screen)
   - Show symbolic objects associated with them (Elon Musk = Tesla/rockets, Tim Cook = Apple products, Sam Altman = OpenAI brand colors)
   - Show a CROWD REACTION to their announcement instead

3. PRODUCTS & APPS → Show a PHONE or LAPTOP SCREEN from a distance (screen content blurred/abstract but with the right color scheme). Show someone's hand holding a phone with a glowing [brand color] interface. Show the product's PHYSICAL CONTEXT (someone using it in a coffee shop, office, etc.)

4. COMPANY COMPETITION → Show two objects in brand colors facing off, clashing, or racing. NOT two people arguing.

5. DECLINE/FAILURE → Show the brand-colored object cracking, falling, dissolving. NOT a sad person.

6. BREAKTHROUGH → Show the product in action from a user's perspective. Phone screens, laptop screens, real-world integration.

VISUAL QUALITY RULES:
- Every prompt must pass the "recognition test": if someone saw ONLY the image (no headline), could they guess which company/story it's about from the COLORS and CONTEXT? If not, rewrite.
- Prefer close-up compositions over wide shots (close-ups are more scroll-stopping on mobile)
- Dramatic lighting is mandatory: golden hour, neon, or high-contrast studio lighting
- Include depth of field (bokeh background) for product shots

ANTI-PATTERNS (automatic rejection):
- Attempting to generate a real person's face = REJECTED (will look like a random stranger)
- Attempting to generate an accurate logo = REJECTED (will be garbled)
- Generic robot = REJECTED (unless the story is literally about a physical robot)
- Floating holographic UI = REJECTED (overdone, not specific)
- Abstract neural network visualization = REJECTED
- Random people in suits = REJECTED`;

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
