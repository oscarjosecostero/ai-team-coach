import { and, asc, eq, lte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { activities } from '../db/schema.js';

export type ActivityRow = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;

export const activitiesRepo = {
  /** Idempotent on (source, source_id). Returns the row and whether it was newly created. */
  async insertIfNew(db: Db, values: NewActivity): Promise<{ row: ActivityRow; created: boolean }> {
    const [inserted] = await db.insert(activities).values(values).onConflictDoNothing({ target: [activities.source, activities.sourceId] }).returning();
    if (inserted) return { row: inserted, created: true };
    const [existing] = await db
      .select()
      .from(activities)
      .where(and(eq(activities.source, values.source), eq(activities.sourceId, values.sourceId)));
    return { row: existing!, created: false };
  },

  /** Full history up to and including `until` (oldest first). */
  async listUpTo(db: Db, userId: string, until: Date): Promise<ActivityRow[]> {
    return db
      .select()
      .from(activities)
      .where(and(eq(activities.userId, userId), lte(activities.startedAt, until)))
      .orderBy(asc(activities.startedAt));
  },
};
