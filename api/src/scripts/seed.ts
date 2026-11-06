import { createAiAdapters } from '../config/ai.js';
import { createDb } from '../db/client.js';
import { toIsoDate } from '../domain/dates.js';
import { countTeams } from '../repositories/maintenance.js';
import { resetDemoData } from '../services/demo-reset.js';

/**
 * Usage: npm run db:seed [-- --reset] [-- --today=YYYY-MM-DD]
 * In the production image: node dist/scripts/seed.js --reset
 */
async function main() {
  const args = process.argv.slice(2);
  const reset = args.includes('--reset');
  const today = args.find((a) => a.startsWith('--today='))?.slice('--today='.length) ?? toIsoDate(new Date());
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const { db, sql } = createDb(url);
  try {
    if (!reset && (await countTeams(db)) > 0) {
      console.error('Database already has data. Re-run with --reset to replace it.');
      process.exitCode = 1;
      return;
    }
    // Vectors for the notes ("the brain"). Without VOYAGE_API_KEY, note search is full-text only.
    const { embeddings } = createAiAdapters({ ANTHROPIC_API_KEY: undefined, VOYAGE_API_KEY: process.env.VOYAGE_API_KEY || undefined });
    const result = await resetDemoData({ db, embeddings, log: (m) => console.warn(m) }, { today, password: process.env.SEED_PASSWORD ?? 'demo-password' });
    if (reset) console.log('Existing data replaced (--reset).');
    console.log(`Seeded team ${result.teamId} as of ${today}:`);
    for (const u of [result.coach, ...result.athletes]) console.log(`  ${u.role.padEnd(7)} ${u.email}  (${u.name})`);
    console.log(embeddings ? `Embedded ${result.embedded} notes with ${embeddings.model}.` : 'No VOYAGE_API_KEY: note search is full-text only.');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
