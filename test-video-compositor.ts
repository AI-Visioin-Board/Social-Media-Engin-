/**
 * Quick test: composite a real Kling video from the DB using the new VideoCompositor
 */
import { getDb } from "./server/db";
import { generatedSlides } from "./drizzle/schema";
import { eq } from "drizzle-orm";
import { compositeVideoSlide } from "./server/videoCompositor";

async function main() {
  const db = await getDb();
  if (!db) { console.error("No DB"); process.exit(1); }

  // Get a real Kling video slide
  const rows = await db
    .select({ slideIndex: generatedSlides.slideIndex, headline: generatedSlides.headline, videoUrl: generatedSlides.videoUrl, insightLine: generatedSlides.insightLine, runId: generatedSlides.runId })
    .from(generatedSlides)
    .where(eq(generatedSlides.isVideoSlide, 1))
    .limit(1);

  if (!rows.length || !rows[0].videoUrl) {
    console.error("No video slides found in DB");
    process.exit(1);
  }

  const slide = rows[0];
  console.log(`Testing with slide: "${slide.headline}"`);
  console.log(`Video URL: ${slide.videoUrl?.slice(0, 80)}...`);

  try {
    const outputUrl = await compositeVideoSlide({
      runId: slide.runId,
      slideIndex: slide.slideIndex,
      videoUrl: slide.videoUrl!,
      headline: slide.headline ?? "TEST HEADLINE FOR VIDEO COMPOSITOR",
      insightLine: slide.insightLine ?? undefined,
    });
    console.log(`\n✅ SUCCESS! Composited video URL:\n${outputUrl}`);
  } catch (err: any) {
    console.error(`\n❌ FAILED: ${err.message}`);
    console.error(err.stack);
  }

  process.exit(0);
}

main();
