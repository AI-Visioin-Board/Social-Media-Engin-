/**
 * sharpCompositor.test.ts
 *
 * Tests for the Sharp-based slide compositor.
 * These tests run against real S3 and a real image URL to verify end-to-end.
 */

import { describe, it, expect } from "vitest";
import { assembleSlideWithSharp, assembleAllSlides } from "./sharpCompositor";

const TEST_IMAGE_URL =
  "https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=1080&h=1350&fit=crop&auto=format";

describe("sharpCompositor: assembleSlideWithSharp()", () => {
  it("assembles an image slide and returns an S3 URL", async () => {
    const result = await assembleSlideWithSharp({
      runId: 999999,
      slideIndex: 0,
      headline: "OPENAI JUST RELEASED A MODEL THAT CODES BETTER THAN 99% OF ENGINEERS",
      summary: "OpenAI's new model outperforms human engineers on coding benchmarks.",
      mediaUrl: TEST_IMAGE_URL,
      isVideo: false,
      isCover: true,
    });

    expect(result).toBeTruthy();
    expect(result).toMatch(/^https?:\/\//);
    expect(result).toMatch(/\.png$/);
    console.log("✅ Image slide S3 URL:", result?.slice(0, 80) + "...");
  }, 30_000);

  it("passes through a video URL unchanged", async () => {
    const videoUrl = "https://d2xsxph8kpxj0f.cloudfront.net/test/video.mp4";
    const result = await assembleSlideWithSharp({
      runId: 999999,
      slideIndex: 1,
      headline: "AI ROBOT PERFORMS SURGERY",
      mediaUrl: videoUrl,
      isVideo: true,
      isCover: false,
    });

    expect(result).toBe(videoUrl);
    console.log("✅ Video pass-through works correctly");
  }, 5_000);

  it("handles null mediaUrl gracefully (uses fallback background)", async () => {
    const result = await assembleSlideWithSharp({
      runId: 999999,
      slideIndex: 2,
      headline: "ANTHROPIC RELEASES CLAUDE 4",
      mediaUrl: null,
      isVideo: false,
      isCover: false,
    });

    expect(result).toBeTruthy();
    expect(result).toMatch(/^https?:\/\//);
    console.log("✅ Fallback background slide S3 URL:", result?.slice(0, 80) + "...");
  }, 30_000);
});

describe("sharpCompositor: assembleAllSlides()", () => {
  it("assembles 4 slides in parallel and returns all URLs", async () => {
    const slides = [
      { runId: 999998, slideIndex: 0, headline: "THIS WEEK IN AI", mediaUrl: TEST_IMAGE_URL, isVideo: false, isCover: true },
      { runId: 999998, slideIndex: 1, headline: "OPENAI RELEASES GPT-5 WITH REASONING THAT BEATS DOCTORS", mediaUrl: TEST_IMAGE_URL, isVideo: false, isCover: false },
      { runId: 999998, slideIndex: 2, headline: "GOOGLE GEMINI NOW READS YOUR EMAILS AND BOOKS MEETINGS AUTOMATICALLY", mediaUrl: TEST_IMAGE_URL, isVideo: false, isCover: false },
      { runId: 999998, slideIndex: 3, headline: "HUMANOID ROBOTS ACHIEVE 90% SUCCESS RATE IN FACTORY TASKS", mediaUrl: TEST_IMAGE_URL, isVideo: false, isCover: false },
    ];

    const start = Date.now();
    const results = await assembleAllSlides(slides);
    const elapsed = Date.now() - start;

    expect(results).toHaveLength(4);
    const succeeded = results.filter((r) => r.url !== null);
    expect(succeeded.length).toBe(4);
    console.log(`✅ All 4 slides assembled in ${elapsed}ms`);
    console.log("URLs:", results.map((r) => r.url?.slice(0, 60) + "..."));

    // Should be fast — under 30 seconds for 4 slides in parallel
    expect(elapsed).toBeLessThan(30_000);
  }, 60_000);
});
