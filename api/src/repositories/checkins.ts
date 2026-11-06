import { asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { wellnessCheckins } from '../db/schema.js';

export type CheckinRow = typeof wellnessCheckins.$inferSelect;
export type NewCheckin = typeof wellnessCheckins.$inferInsert;

export const checkinsRepo = {
  /** One check-in per user per day: a second submission replaces the first. */
  async upsert(db: Db, values: NewCheckin): Promise<CheckinRow> {
    const [row] = await db
      .insert(wellnessCheckins)
      .values(values)
      .onConflictDoUpdate({
        target: [wellnessCheckins.userId, wellnessCheckins.date],
        set: {
          restingHr: sql`excluded.resting_hr`,
          sleepHours: sql`excluded.sleep_hours`,
          fatigue: sql`excluded.fatigue`,
          soreness: sql`excluded.soreness`,
          note: sql`excluded.note`,
        },
      })
      .returning();
    return row!;
  },

  async list(db: Db, userId: string): Promise<CheckinRow[]> {
    return db.select().from(wellnessCheckins).where(eq(wellnessCheckins.userId, userId)).orderBy(asc(wellnessCheckins.date));
  },
};
