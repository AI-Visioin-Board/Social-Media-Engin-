// Quick smoke test: Stage 1 (Script Director) + Stage 2 (Asset Router)
// Run: npx tsx src/test/testStage1.ts

import { generateScript } from "../scriptDirector.js";
import { routeAssets } from "../assetRouter.js";

const TOPIC = "Anthropic just launched Claude's new computer use feature — an AI that can control your mouse, keyboard, and browser autonomously";

async function main() {
  console.log("=== Testing Stage 1: Script Director ===\n");
  console.log(`Topic: ${TOPIC}\n`);

  const script = await generateScript({ topic: TOPIC, targetDurationSec: 60 });

  console.log(`\nHook: "${script.hook}"`);
  console.log(`Total duration: ${script.totalDurationSec}s`);
  console.log(`Beats: ${script.beats.length}`);
  console.log(`Caption: ${script.caption}`);
  console.log(`CTA: ${script.cta}\n`);

  console.log("--- Beat Breakdown ---");
  for (const beat of script.beats) {
    console.log(`  Beat ${beat.id} [${beat.startSec}s-${beat.startSec + beat.durationSec}s] (${beat.durationSec}s)`);
    console.log(`    Narration: "${beat.narration}"`);
    console.log(`    Visual: ${beat.visualType} → ${beat.motionStyle}`);
    console.log(`    Prompt: "${beat.visualPrompt.slice(0, 80)}..."`);
    if (beat.visualSubject) console.log(`    Subject: ${beat.visualSubject}`);
    console.log(`    Emphasis: [${beat.captionEmphasis?.join(", ")}]`);
    console.log(`    Transition: ${beat.transition}`);
    console.log();
  }

  // Visual type distribution
  const typeCounts: Record<string, number> = {};
  for (const b of script.beats) {
    typeCounts[b.visualType] = (typeCounts[b.visualType] ?? 0) + 1;
  }
  console.log("--- Visual Type Distribution ---");
  for (const [type, count] of Object.entries(typeCounts)) {
    console.log(`  ${type}: ${count}`);
  }

  console.log("\n=== Testing Stage 2: Asset Router ===\n");
  const manifest = routeAssets(script);

  console.log(`Total asset requests: ${manifest.requests.length}`);
  console.log(`Parallel groups: ${manifest.parallelGroups.length}`);
  for (const group of manifest.parallelGroups) {
    console.log(`  ${group.source}: ${group.beatIds.length} beats (max ${group.maxConcurrent} concurrent)`);
  }

  const dependents = manifest.requests.filter(r => r.dependsOn !== undefined);
  if (dependents.length > 0) {
    console.log(`\nDependent requests (I2V): ${dependents.length}`);
    for (const d of dependents) {
      console.log(`  Beat ${d.beatId} (${d.source}) depends on beat ${d.dependsOn}`);
    }
  }

  console.log("\n=== PASS: Stages 1+2 working ===");
}

main().catch(err => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
