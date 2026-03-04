/**
 * End-to-end pipeline test — runs the full pipeline with requireAdminApproval=false
 */
import { createConnection } from 'mysql2/promise';
import { runContentPipeline } from './server/contentPipeline';

async function main() {
  // Load Kling keys from DB
  const conn = await createConnection(process.env.DATABASE_URL!);
  const [rows] = await conn.query(
    "SELECT `key`, `value` FROM appSettings WHERE `key` IN ('kling_access_key', 'kling_secret_key')"
  ) as any;
  await conn.end();

  const settings = Object.fromEntries((rows as any[]).map((r: any) => [r.key, r.value]));
  const klingAccessKey = (settings['kling_access_key'] as string) || '';
  const klingSecretKey = (settings['kling_secret_key'] as string) || '';

  console.log(`\n🚀 Starting end-to-end pipeline test`);
  console.log(`   Kling: ${klingAccessKey ? `✅ keys loaded (...${klingAccessKey.slice(-4)})` : '❌ no keys'}`);
  console.log(`   Make webhook: ${process.env.MAKE_WEBHOOK_URL ? '✅ configured' : '⚠️  not set (posting skipped)'}`);
  console.log(`   requireAdminApproval: false (auto-approve topics)\n`);

  const startTime = Date.now();

  try {
    const runId = await runContentPipeline({
      runSlot: 'monday',
      klingAccessKey,
      klingSecretKey,
      makeWebhookUrl: process.env.MAKE_WEBHOOK_URL,
      requireAdminApproval: false,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ Pipeline completed successfully!`);
    console.log(`   Run ID: ${runId}`);
    console.log(`   Total time: ${elapsed}s`);
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`\n❌ Pipeline failed after ${elapsed}s:`);
    console.error(err);
    process.exit(1);
  }
}

main();
