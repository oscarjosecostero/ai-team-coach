import type { Db } from '../db/client.js';
import type { EmbeddingProvider } from '../integrations/embeddings/embedding-provider.js';
import { truncateAllData } from '../repositories/maintenance.js';
import { backfillEmbeddings } from './notes-search.js';
import { seedDemoTeam, type SeedResult } from './seed.js';

/**
 * Replaces all data with the demo team as of `today`. The seed story (Carlos' three hard days,
 * Marcos' load spike) is relative to the seed date, so the public demo reseeds daily to stay current.
 * Embedding failures are logged, not thrown: note search falls back to full-text.
 */
export async function resetDemoData(deps: { db: Db; embeddings: EmbeddingProvider | null; log?: (msg: string) => void }, opts: { today: string; password: string }): Promise<SeedResult & { embedded: number }> {
  await truncateAllData(deps.db);
  const seeded = await seedDemoTeam(deps.db, opts);
  let embedded = 0;
  if (deps.embeddings) {
    try {
      embedded = await backfillEmbeddings({ db: deps.db, embeddings: deps.embeddings, log: deps.log });
    } catch (err) {
      deps.log?.(`embedding backfill failed (search falls back to full-text): ${(err as Error).message}`);
    }
  }
  return { ...seeded, embedded };
}
