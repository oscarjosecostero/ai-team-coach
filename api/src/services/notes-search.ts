import type { Db } from '../db/client.js';
import { EmbeddingError, type EmbeddingProvider } from '../integrations/embeddings/embedding-provider.js';
import { knowledgeRepo, type NoteHit } from '../repositories/knowledge.js';

export type NotesSearchDeps = { db: Db; embeddings: EmbeddingProvider | null; log?: (msg: string) => void };

const BACKFILL_BATCH = 64;

/** Embeds notes that have no vector yet (or one from another model). Returns how many were embedded. */
export async function backfillEmbeddings(deps: NotesSearchDeps, opts: { userId?: string; max?: number } = {}): Promise<number> {
  if (!deps.embeddings) return 0;
  const max = opts.max ?? Number.POSITIVE_INFINITY;
  let done = 0;
  while (done < max) {
    const batch = await knowledgeRepo.listNeedingEmbedding(deps.db, deps.embeddings.model, { userId: opts.userId, limit: Math.min(BACKFILL_BATCH, max - done) });
    if (batch.length === 0) break;
    const vectors = await deps.embeddings.embed(batch.map((c) => c.content), 'document');
    for (let i = 0; i < batch.length; i++) await knowledgeRepo.setEmbedding(deps.db, batch[i]!.id, vectors[i]!, deps.embeddings.model);
    done += batch.length;
  }
  return done;
}

/**
 * Hybrid search over an athlete's notes. Semantic search needs the embedding provider; when it is
 * not configured or fails (rate limit, outage), search degrades to full-text instead of failing.
 */
export async function searchAthleteNotes(deps: NotesSearchDeps, userId: string, query: string, limit: number): Promise<{ hits: NoteHit[]; mode: 'hybrid' | 'text' }> {
  let queryVector: number[] | null = null;
  if (deps.embeddings) {
    try {
      // Notes written since the last backfill get their vectors now (a handful at most).
      await backfillEmbeddings(deps, { userId, max: BACKFILL_BATCH });
      queryVector = (await deps.embeddings.embed([query], 'query'))[0] ?? null;
    } catch (err) {
      if (!(err instanceof EmbeddingError)) throw err;
      deps.log?.(`embeddings unavailable, using full-text search: ${err.message}`);
      queryVector = null;
    }
  }
  const hits = await knowledgeRepo.searchHybrid(deps.db, userId, query, queryVector, limit);
  return { hits, mode: queryVector ? 'hybrid' : 'text' };
}
