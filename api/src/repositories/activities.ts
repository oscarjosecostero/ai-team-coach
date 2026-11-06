import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
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

  async listRecent(db: Db, userId: string, limit: number): Promise<ActivityRow[]> {
    return db.select().from(activities).where(eq(activities.userId, userId)).orderBy(desc(activities.startedAt)).limit(limit);
  },

  /** Activities whose start falls in [from, to], inclusive (oldest first). */
  async listBetween(db: Db, userId: string, from: Date, to: Date): Promise<ActivityRow[]> {
    return db
      .select()
      .from(activities)
      .where(and(eq(activities.userId, userId), gte(activities.startedAt, from), lte(activities.startedAt, to)))
      .orderBy(asc(activities.startedAt));
  },

  async getById(db: Db, id: string): Promise<ActivityRow | null> {
    const [row] = await db.select().from(activities).where(eq(activities.id, id));
    return row ?? null;
  },
};
