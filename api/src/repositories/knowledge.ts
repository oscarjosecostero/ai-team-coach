import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { knowledgeChunks } from '../db/schema.js';

export const knowledgeRepo = {
  /** Stores a note as a searchable chunk. The embedding is filled in later (Phase 3) and may be null. */
  async upsertNote(db: Db, v: { userId: string; sourceType: 'activity_note' | 'checkin_note'; sourceId: string; content: string }): Promise<void> {
    await db
      .insert(knowledgeChunks)
      .values(v)
      .onConflictDoUpdate({ target: [knowledgeChunks.sourceType, knowledgeChunks.sourceId], set: { content: sql`excluded.content`, embedding: null, embeddingModel: null } });
  },
};
