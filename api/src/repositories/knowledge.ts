import { and, asc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { knowledgeChunks } from '../db/schema.js';

export type NoteHit = {
  id: string;
  sourceType: 'activity_note' | 'checkin_note';
  sourceId: string;
  /** Calendar day of the activity or check-in the note belongs to. */
  date: string;
  content: string;
  score: number;
  matchedBy: ('text' | 'semantic')[];
};

/** Reciprocal-rank-fusion constant (standard value from the RRF paper). */
const RRF_K = 60;
const CANDIDATES = 20;

/** "calf pain?" -> "calf | pain": OR semantics suit short notes better than plainto_tsquery's AND. */
export function toOrTsQuery(text: string): string | null {
  const words = [...new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? [])].filter((w) => w.length > 1);
  return words.length ? words.join(' | ') : null;
}

export const knowledgeRepo = {
  /** Stores a note as a searchable chunk. The embedding is filled in later and may be null. */
  async upsertNote(db: Db, v: { userId: string; sourceType: 'activity_note' | 'checkin_note'; sourceId: string; content: string }): Promise<void> {
    await db
      .insert(knowledgeChunks)
      .values(v)
      .onConflictDoUpdate({ target: [knowledgeChunks.sourceType, knowledgeChunks.sourceId], set: { content: sql`excluded.content`, embedding: null, embeddingModel: null } });
  },

  /** Chunks with no embedding, or one from a different model. */
  async listNeedingEmbedding(db: Db, model: string, opts: { userId?: string; limit: number }) {
    const stale = or(isNull(knowledgeChunks.embedding), ne(knowledgeChunks.embeddingModel, model));
    return db
      .select({ id: knowledgeChunks.id, content: knowledgeChunks.content })
      .from(knowledgeChunks)
      .where(opts.userId ? and(eq(knowledgeChunks.userId, opts.userId), stale) : stale)
      .orderBy(asc(knowledgeChunks.createdAt))
      .limit(opts.limit);
  },

  async setEmbedding(db: Db, id: string, embedding: number[], model: string): Promise<void> {
    await db.update(knowledgeChunks).set({ embedding, embeddingModel: model }).where(eq(knowledgeChunks.id, id));
  },

  /**
   * Hybrid search over one athlete's notes: full-text (GIN/tsvector) and, when a query vector is
   * given, cosine similarity (HNSW/pgvector), merged with reciprocal rank fusion.
   */
  async searchHybrid(db: Db, userId: string, text: string, queryEmbedding: number[] | null, limit: number): Promise<NoteHit[]> {
    const tsq = toOrTsQuery(text);
    if (!tsq && !queryEmbedding) return [];

    const fts = tsq
      ? sql`SELECT id, row_number() OVER (ORDER BY ts_rank_cd(tsv, q) DESC) AS r
            FROM knowledge_chunks, to_tsquery('english', ${tsq}) q
            WHERE user_id = ${userId} AND tsv @@ q
            ORDER BY r LIMIT ${CANDIDATES}`
      : sql`SELECT NULL::uuid AS id, NULL::bigint AS r WHERE false`;
    const vectorLiteral = queryEmbedding ? `[${queryEmbedding.join(',')}]` : null;
    const vec = vectorLiteral
      ? sql`SELECT id, row_number() OVER (ORDER BY embedding <=> ${vectorLiteral}::vector) AS r
            FROM knowledge_chunks
            WHERE user_id = ${userId} AND embedding IS NOT NULL
            ORDER BY embedding <=> ${vectorLiteral}::vector LIMIT ${CANDIDATES}`
      : sql`SELECT NULL::uuid AS id, NULL::bigint AS r WHERE false`;

    const rows = await db.execute<{
      id: string;
      source_type: NoteHit['sourceType'];
      source_id: string;
      date: string;
      content: string;
      fts_r: number | null;
      vec_r: number | null;
    }>(sql`
      WITH fts AS (${fts}), vec AS (${vec})
      SELECT k.id, k.source_type, k.source_id, k.content, fts.r AS fts_r, vec.r AS vec_r,
             COALESCE(to_char(a.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'), to_char(c.date, 'YYYY-MM-DD'), to_char(k.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')) AS date
      FROM knowledge_chunks k
      LEFT JOIN fts ON fts.id = k.id
      LEFT JOIN vec ON vec.id = k.id
      LEFT JOIN activities a ON k.source_type = 'activity_note' AND a.id = k.source_id
      LEFT JOIN wellness_checkins c ON k.source_type = 'checkin_note' AND c.id = k.source_id
      WHERE k.user_id = ${userId} AND (fts.id IS NOT NULL OR vec.id IS NOT NULL)
    `);

    return rows
      .map((r) => {
        const score = (r.fts_r ? 1 / (RRF_K + Number(r.fts_r)) : 0) + (r.vec_r ? 1 / (RRF_K + Number(r.vec_r)) : 0);
        const matchedBy: NoteHit['matchedBy'] = [];
        if (r.fts_r) matchedBy.push('text');
        if (r.vec_r) matchedBy.push('semantic');
        return { id: r.id, sourceType: r.source_type, sourceId: r.source_id, date: r.date, content: r.content, score, matchedBy };
      })
      .sort((a, b) => b.score - a.score || b.date.localeCompare(a.date))
      .slice(0, limit);
  },
};
