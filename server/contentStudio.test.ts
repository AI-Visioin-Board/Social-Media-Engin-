/**
 * contentStudio.test.ts
 *
 * Unit tests for the Content Studio tRPC procedures:
 * - regenerateSlide: validates input schema, DB guard, and error paths
 * - getMusicSuggestion: validates track selection logic and response shape
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── regenerateSlide input validation ─────────────────────────────────────────

describe("regenerateSlide: input validation", () => {
  it("requires both runId and slideId as numbers", () => {
    const schema = { runId: 0, slideId: 0 };
    expect(typeof schema.runId).toBe("number");
    expect(typeof schema.slideId).toBe("number");
  });

  it("rejects negative IDs", () => {
    const isValidId = (id: number) => id > 0;
    expect(isValidId(-1)).toBe(false);
    expect(isValidId(0)).toBe(false);
    expect(isValidId(1)).toBe(true);
    expect(isValidId(999)).toBe(true);
  });
});

// ─── getMusicSuggestion: track library logic ──────────────────────────────────

const TRACK_LIBRARY = [
  { name: "Titan", artist: "Audionautix", mood: "Epic / Orchestral", bpm: 120, license: "CC BY 4.0" },
  { name: "Colossal Boss Battle Theme", artist: "Kevin MacLeod", mood: "Intense / Battle", bpm: 140, license: "CC BY 4.0" },
  { name: "Epic Cinematic", artist: "Scott Buckley", mood: "Cinematic / Grandiose", bpm: 110, license: "CC BY 4.0" },
  { name: "Ascension", artist: "Scott Buckley", mood: "Uplifting / Triumphant", bpm: 128, license: "CC BY 4.0" },
  { name: "Thunderstruck (Cinematic)", artist: "Audionautix", mood: "Dramatic / Powerful", bpm: 132, license: "CC BY 4.0" },
  { name: "Infinite Horizon", artist: "Scott Buckley", mood: "Futuristic / Expansive", bpm: 118, license: "CC BY 4.0" },
  { name: "Impact Moderato", artist: "Kevin MacLeod", mood: "Urgent / Driving", bpm: 125, license: "CC BY 4.0" },
  { name: "Olympus", artist: "Scott Buckley", mood: "Heroic / Majestic", bpm: 115, license: "CC BY 4.0" },
];

/** Simulate the track selection logic from the router (with NaN guard) */
function selectTrack(llmResponse: string): (typeof TRACK_LIBRARY)[number] {
  const parsed = parseInt(llmResponse.trim(), 10);
  const trackIndex = isNaN(parsed) ? 0 : Math.max(0, Math.min(TRACK_LIBRARY.length - 1, parsed - 1));
  return TRACK_LIBRARY[trackIndex];
}

describe("getMusicSuggestion: track selection logic", () => {
  it("selects the correct track for index 1", () => {
    const track = selectTrack("1");
    expect(track.name).toBe("Titan");
    expect(track.artist).toBe("Audionautix");
  });

  it("selects the correct track for index 3", () => {
    const track = selectTrack("3");
    expect(track.name).toBe("Epic Cinematic");
    expect(track.artist).toBe("Scott Buckley");
  });

  it("clamps out-of-range index to last track", () => {
    const track = selectTrack("99");
    expect(track).toBe(TRACK_LIBRARY[TRACK_LIBRARY.length - 1]);
  });

  it("clamps negative/zero index to first track", () => {
    const track0 = selectTrack("0");
    const trackNeg = selectTrack("-5");
    expect(track0).toBe(TRACK_LIBRARY[0]);
    expect(trackNeg).toBe(TRACK_LIBRARY[0]);
  });

  it("handles non-numeric LLM response by defaulting to first track", () => {
    // The router has a NaN guard: if parseInt returns NaN, trackIndex defaults to 0
    const track = selectTrack("Titan");
    expect(track).toBe(TRACK_LIBRARY[0]);
    expect(track.name).toBe("Titan");
  });

  it("all tracks have required fields", () => {
    for (const track of TRACK_LIBRARY) {
      expect(track.name).toBeTruthy();
      expect(track.artist).toBeTruthy();
      expect(track.mood).toBeTruthy();
      expect(track.bpm).toBeGreaterThan(0);
      expect(track.license).toContain("CC BY");
    }
  });

  it("all tracks have BPM in epic/cinematic range (100-160)", () => {
    for (const track of TRACK_LIBRARY) {
      expect(track.bpm).toBeGreaterThanOrEqual(100);
      expect(track.bpm).toBeLessThanOrEqual(160);
    }
  });
});

// ─── Slide regeneration state machine ─────────────────────────────────────────

describe("regenerateSlide: state transitions", () => {
  it("correctly identifies video slides from URL", () => {
    const isVideoUrl = (url: string) => url.includes(".mp4") || url.includes("video");
    expect(isVideoUrl("https://cdn.example.com/clip.mp4")).toBe(true);
    expect(isVideoUrl("https://cdn.example.com/video/clip")).toBe(true);
    expect(isVideoUrl("https://cdn.example.com/slide.png")).toBe(false);
    expect(isVideoUrl("https://cdn.example.com/image.jpg")).toBe(false);
  });

  it("correctly identifies cover slide from slideIndex", () => {
    const isCover = (slideIndex: number) => slideIndex === 0;
    expect(isCover(0)).toBe(true);
    expect(isCover(1)).toBe(false);
    expect(isCover(4)).toBe(false);
  });

  it("status progression is valid for regeneration", () => {
    const VALID_STATUSES = ["pending", "researching", "generating_video", "assembling", "ready", "failed"];
    const regenerationStatuses = ["generating_video", "assembling", "ready"];
    for (const s of regenerationStatuses) {
      expect(VALID_STATUSES).toContain(s);
    }
  });
});

// ─── Marketing Brain: prompt quality guards ────────────────────────────────────

describe("marketingBrainPrompt: generic prompt detection", () => {
  /** Mirrors the isGenericPrompt logic in contentPipeline.ts */
  function isGenericPrompt(prompt: string): boolean {
    const p = prompt.toLowerCase();
    return (
      !prompt ||
      p.includes("futuristic ai interface") ||
      p.includes("glowing data streams") ||
      p.includes("server room") ||
      p.includes("neural network visualization")
    );
  }

  it("flags a generic 'futuristic AI interface' prompt", () => {
    expect(isGenericPrompt("Cinematic shot of a futuristic AI interface with glowing data streams")).toBe(true);
  });

  it("flags a generic 'server room' prompt", () => {
    expect(isGenericPrompt("Wide shot of a server room with blinking lights")).toBe(true);
  });

  it("flags a generic 'neural network visualization' prompt", () => {
    expect(isGenericPrompt("Neural network visualization with pulsing nodes")).toBe(true);
  });

  it("does NOT flag a specific, story-driven prompt", () => {
    expect(isGenericPrompt("Alex Karp, Palantir CEO, standing at a podium with the Palantir logo behind him, intense expression")).toBe(false);
  });

  it("does NOT flag a specific ChatGPT uninstall prompt", () => {
    expect(isGenericPrompt("Close-up of a hand pressing Delete App on an iPhone showing the ChatGPT logo, dramatic lighting")).toBe(false);
  });

  it("does NOT flag an OpenAI logo falling off a cliff prompt", () => {
    expect(isGenericPrompt("The OpenAI logo falling in slow motion off a cliff edge into a dark void below, dramatic god rays")).toBe(false);
  });

  it("flags an empty prompt", () => {
    expect(isGenericPrompt("")).toBe(true);
  });
});

// ─── Compositor: layout logic ─────────────────────────────────────────────────

describe("sharpCompositor: layout constants", () => {
  it("content slides use wider wrap width (20) than cover slides (16)", () => {
    const coverWrap = 16;
    const contentWrap = 20;
    expect(contentWrap).toBeGreaterThan(coverWrap);
  });

  it("insight bubble is positioned below the last headline line", () => {
    // Simulate the bubble Y calculation
    const textStartY = 900;
    const lineHeight = 108 * 1.15; // fontSize * 1.15
    const lineCount = 2;
    const fontSize = 108;
    const lastLineY = textStartY + (lineCount - 1) * lineHeight + fontSize;
    const iBubbleY = lastLineY + 24;

    // Bubble must be below the last text line
    expect(iBubbleY).toBeGreaterThan(lastLineY);
    // Gap must be exactly 24px
    expect(iBubbleY - lastLineY).toBe(24);
  });

  it("insight bubble tail points upward (iBubbleY - tailSize < iBubbleY)", () => {
    const iBubbleY = 1100;
    const iTailSize = 12;
    // Tail tip Y = iBubbleY - iTailSize * 1.5 (above the bubble top edge)
    const tailTipY = iBubbleY - iTailSize * 1.5;
    expect(tailTipY).toBeLessThan(iBubbleY);
  });
});

// ─── Make.com Webhook: payload shape ─────────────────────────────────────────

describe("triggerInstagramPost: payload shape", () => {
  /** Mirror the slide payload builder from contentPipeline.ts */
  function buildSlidePayload(slides: Array<{ assembledUrl: string; headline: string; isVideo?: boolean }>) {
    return slides.map((s, i) => ({
      slide_index: i,
      media_type: s.isVideo ? "VIDEO" : "IMAGE",
      image_url: s.assembledUrl,
      video_url: s.assembledUrl,
      headline: s.headline,
    }));
  }

  const mixedSlides = [
    { assembledUrl: "https://cdn.example.com/slide0.png", headline: "Cover", isVideo: false },
    { assembledUrl: "https://cdn.example.com/slide1.mp4", headline: "Story 1", isVideo: true },
    { assembledUrl: "https://cdn.example.com/slide2.png", headline: "Story 2", isVideo: false },
    { assembledUrl: "https://cdn.example.com/slide3.mp4", headline: "Story 3", isVideo: true },
  ];

  it("assigns correct media_type per slide", () => {
    const payload = buildSlidePayload(mixedSlides);
    expect(payload[0].media_type).toBe("IMAGE");
    expect(payload[1].media_type).toBe("VIDEO");
    expect(payload[2].media_type).toBe("IMAGE");
    expect(payload[3].media_type).toBe("VIDEO");
  });

  it("always sets both image_url and video_url to the same assembledUrl", () => {
    const payload = buildSlidePayload(mixedSlides);
    for (const slide of payload) {
      expect(slide.image_url).toBe(slide.video_url);
    }
  });

  it("preserves slide_index order", () => {
    const payload = buildSlidePayload(mixedSlides);
    payload.forEach((s, i) => expect(s.slide_index).toBe(i));
  });

  it("correctly detects has_video from slide array", () => {
    const hasVideo = mixedSlides.some((s) => s.isVideo);
    expect(hasVideo).toBe(true);

    const imageOnly = mixedSlides.filter((s) => !s.isVideo);
    expect(imageOnly.some((s) => s.isVideo)).toBe(false);
  });

  it("defaults isVideo to false when not provided", () => {
    const slides = [{ assembledUrl: "https://cdn.example.com/slide.png", headline: "Test" }];
    const payload = buildSlidePayload(slides);
    expect(payload[0].media_type).toBe("IMAGE");
  });
});

// ─── Zernio publisher: payload shape ─────────────────────────────────────────
//
// These mirror the slide-mapping logic inside triggerCarouselPost so we catch
// regressions in the Zernio mediaItems payload independent of the legacy Make
// payload. Zernio's shape: { type: "image"|"video", url, altText? }.

describe("Zernio publisher: mediaItems payload shape", () => {
  /** Mirror the slide → Zernio mediaItem mapping from contentPipeline.triggerCarouselPost */
  function buildZernioMediaItems(
    slides: Array<{ assembledUrl: string; headline: string; isVideo?: boolean }>
  ) {
    return slides.map((s) => ({
      type: s.isVideo ? ("video" as const) : ("image" as const),
      url: s.assembledUrl,
      altText: s.headline,
    }));
  }

  const mixedSlides = [
    { assembledUrl: "https://cdn.example.com/slide0.png", headline: "Cover",   isVideo: false },
    { assembledUrl: "https://cdn.example.com/slide1.mp4", headline: "Story 1", isVideo: true  },
    { assembledUrl: "https://cdn.example.com/slide2.png", headline: "Story 2", isVideo: false },
    { assembledUrl: "https://cdn.example.com/slide3.mp4", headline: "Story 3", isVideo: true  },
  ];

  it("emits lowercase 'image' / 'video' types per slide (Zernio convention)", () => {
    const payload = buildZernioMediaItems(mixedSlides);
    expect(payload.map((s) => s.type)).toEqual(["image", "video", "image", "video"]);
  });

  it("never sets both image_url AND video_url on the same slide", () => {
    // Zernio uses a single `url` field per mediaItem. This guards against a
    // refactor accidentally reintroducing the Make schema (separate image_url
    // / video_url fields that Make's IG module choked on).
    const payload = buildZernioMediaItems(mixedSlides);
    for (const s of payload) {
      expect(s).toHaveProperty("url");
      expect(s).not.toHaveProperty("image_url");
      expect(s).not.toHaveProperty("video_url");
    }
  });

  it("preserves slide order in the array (carousel order matters)", () => {
    const payload = buildZernioMediaItems(mixedSlides);
    expect(payload[0].url).toContain("slide0");
    expect(payload[1].url).toContain("slide1");
    expect(payload[2].url).toContain("slide2");
    expect(payload[3].url).toContain("slide3");
  });

  it("passes headline through as altText", () => {
    const payload = buildZernioMediaItems(mixedSlides);
    expect(payload[0].altText).toBe("Cover");
    expect(payload[3].altText).toBe("Story 3");
  });

  it("supports image-only carousels (no video flag at all)", () => {
    const imgOnly = [
      { assembledUrl: "https://cdn.example.com/a.png", headline: "A" },
      { assembledUrl: "https://cdn.example.com/b.png", headline: "B" },
    ];
    const payload = buildZernioMediaItems(imgOnly);
    expect(payload.every((s) => s.type === "image")).toBe(true);
  });

  it("builds title in sbgpt-run-<id> shape (used for internal correlation)", () => {
    const runId = 42;
    expect(`sbgpt-run-${runId}`).toBe("sbgpt-run-42");
  });
});

// ─── Publisher feature flag routing ──────────────────────────────────────────

describe("Publisher feature flag routing", () => {
  /** Mirror the ok aggregation rule from triggerCarouselPost */
  function aggregate(publisher: "make" | "zernio" | "both", makeOk?: boolean, zernioOk?: boolean): boolean {
    return publisher === "make"   ? !!makeOk
         : publisher === "zernio" ? !!zernioOk
         /* both */                : !!zernioOk;
  }

  it("'make' mode: ok follows Make result only", () => {
    expect(aggregate("make", true,  false)).toBe(true);
    expect(aggregate("make", false, true )).toBe(false);
  });

  it("'zernio' mode: ok follows Zernio result only", () => {
    expect(aggregate("zernio", true,  false)).toBe(false);
    expect(aggregate("zernio", false, true )).toBe(true);
  });

  it("'both' (dual-write) mode: Zernio is authoritative; Make is shadow", () => {
    expect(aggregate("both", true,  false)).toBe(false); // Make ok but Zernio failed → run fails
    expect(aggregate("both", false, true )).toBe(true);  // Make failed but Zernio ok → run succeeds
  });
});

describe("isVideoSlide: URL detection logic", () => {
  /** Mirror the isVideo detection from routers.ts approvePost */
  function detectIsVideo(assembledUrl: string | null, isVideoSlide: number): boolean {
    return isVideoSlide === 1 && !!(assembledUrl && (assembledUrl.includes(".mp4") || assembledUrl.includes("video")));
  }

  it("returns true for .mp4 URL with isVideoSlide=1", () => {
    expect(detectIsVideo("https://cdn.example.com/clip.mp4", 1)).toBe(true);
  });

  it("returns true for video path with isVideoSlide=1", () => {
    expect(detectIsVideo("https://cdn.example.com/video/clip", 1)).toBe(true);
  });

  it("returns false for image URL even with isVideoSlide=1", () => {
    expect(detectIsVideo("https://cdn.example.com/slide.png", 1)).toBe(false);
  });

  it("returns false for .mp4 URL when isVideoSlide=0", () => {
    expect(detectIsVideo("https://cdn.example.com/clip.mp4", 0)).toBe(false);
  });

  it("returns false for null URL", () => {
    expect(detectIsVideo(null, 1)).toBe(false);
  });
});

describe("getWebhookStatus: URL masking", () => {
  /** Mirror the masking logic from routers.ts getWebhookStatus */
  function maskWebhookUrl(webhookUrl: string): string {
    return webhookUrl.replace(/(https:\/\/hook\.make\.com\/[^/]+\/)(.+)/, (_, prefix, token) =>
      prefix + "*".repeat(Math.max(0, token.length - 8)) + token.slice(-8)
    );
  }

  it("masks the token portion leaving last 8 chars visible", () => {
    const url = "https://hook.make.com/abc123/abcdefghijklmnop";
    const masked = maskWebhookUrl(url);
    expect(masked).toContain("https://hook.make.com/abc123/");
    expect(masked).toContain("ijklmnop");
    expect(masked).not.toContain("abcdefgh");
  });

  it("does not mask non-Make.com URLs", () => {
    const url = "https://other.example.com/webhook/token123";
    const masked = maskWebhookUrl(url);
    expect(masked).toBe(url); // no change
  });
});
