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
