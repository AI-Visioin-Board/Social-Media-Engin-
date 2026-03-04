
import { getDb } from "./server/db";
import { generatedSlides } from "./drizzle/schema";
import { eq } from "drizzle-orm";
import { assembleAllSlides } from "./server/sharpCompositor";

const runId = 150001;
const db = await getDb();
const slides = await db.select().from(generatedSlides).where(eq(generatedSlides.runId, runId));
console.log("[Repair] Found", slides.length, "slides for run", runId);

if (slides.length === 0) {
  console.log("[Repair] No slides found. Check the runId.");
  process.exit(1);
}

const inputs = slides.map(s => ({
  runId,
  slideIndex: s.slideIndex,
  headline: s.headline ?? "",
  summary: s.summary ?? undefined,
  mediaUrl: s.videoUrl ?? null,
  isVideo: !!(s.videoUrl && (s.videoUrl.includes(".mp4") || s.videoUrl.includes("video"))),
  isCover: s.slideIndex === 0,
}));

console.log("[Repair] Assembling", inputs.length, "slides...");
const results = await assembleAllSlides(inputs);

for (const result of results) {
  const slide = slides.find(s => s.slideIndex === result.slideIndex);
  if (slide && result.url) {
    await db.update(generatedSlides)
      .set({ assembledUrl: result.url, status: "ready" })
      .where(eq(generatedSlides.id, slide.id));
    console.log("[Repair] Slide", result.slideIndex, "->", result.url.slice(0, 80));
  } else {
    console.warn("[Repair] Slide", result.slideIndex, "failed to assemble");
  }
}
console.log("[Repair] Done!");
