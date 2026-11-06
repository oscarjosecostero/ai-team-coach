import { createAiAdapters } from '../config/ai.js';
import { createDb } from '../db/client.js';
import { toIsoDate } from '../domain/dates.js';
import { countTeams, truncateAllData } from '../repositories/maintenance.js';
import { backfillEmbeddings } from '../services/notes-search.js';
import { seedDemoTeam } from '../services/seed.js';

/** Usage: npm run db:seed [-- --reset] [-- --today=YYYY-MM-DD] */
async function main() {
  const args = process.argv.slice(2);
  const reset = args.includes('--reset');
  const today = args.find((a) => a.startsWith('--today='))?.slice('--today='.length) ?? toIsoDate(new Date());
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const { db, sql } = createDb(url);
  try {
    if (reset) {
      await truncateAllData(db);
      console.log('Existing data removed (--reset).');
    } else if ((await countTeams(db)) > 0) {
      console.error('Database already has data. Re-run with --reset to replace it.');
      process.exitCode = 1;
      return;
    }
    const result = await seedDemoTeam(db, { today, password: process.env.SEED_PASSWORD ?? 'demo-password' });
    console.log(`Seeded team ${result.teamId} as of ${today}:`);
    for (const u of [result.coach, ...result.athletes]) console.log(`  ${u.role.padEnd(7)} ${u.email}  (${u.name})`);

    // Vectors for the notes ("the brain"). Without VOYAGE_API_KEY, note search is full-text only.
    const { embeddings } = createAiAdapters({ ANTHROPIC_API_KEY: undefined, VOYAGE_API_KEY: process.env.VOYAGE_API_KEY || undefined });
    if (embeddings) {
      try {
        console.log(`Embedded ${await backfillEmbeddings({ db, embeddings })} notes with ${embeddings.model}.`);
      } catch (err) {
        console.warn(`Embedding backfill failed (search falls back to full-text): ${(err as Error).message}`);
      }
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
