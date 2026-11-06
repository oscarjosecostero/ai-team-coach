import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { plannedWorkouts } from '../db/schema.js';

export type PlannedWorkoutRow = typeof plannedWorkouts.$inferSelect;
export type NewPlannedWorkout = typeof plannedWorkouts.$inferInsert;

export const plannedWorkoutsRepo = {
  async insertMany(db: Db, values: NewPlannedWorkout[]): Promise<void> {
    if (values.length) await db.insert(plannedWorkouts).values(values);
  },

  async listRange(db: Db, userId: string, from: string, to: string): Promise<PlannedWorkoutRow[]> {
    return db
      .select()
      .from(plannedWorkouts)
      .where(and(eq(plannedWorkouts.userId, userId), gte(plannedWorkouts.date, from), lte(plannedWorkouts.date, to)))
      .orderBy(asc(plannedWorkouts.date));
  },

  async getById(db: Db, id: string): Promise<PlannedWorkoutRow | null> {
    const [row] = await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.id, id));
    return row ?? null;
  },

  async getByIdForUpdate(db: Db, id: string): Promise<PlannedWorkoutRow | null> {
    const [row] = await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.id, id)).for('update');
    return row ?? null;
  },

  /** Optimistic lock: only updates when `version` still matches, and bumps it. Returns null on a stale version. */
  async updateIfVersion(
    db: Db,
    id: string,
    expectedVersion: number,
    values: Partial<Omit<NewPlannedWorkout, 'id' | 'version' | 'userId'>>,
  ): Promise<PlannedWorkoutRow | null> {
    const [row] = await db
      .update(plannedWorkouts)
      .set({ ...values, origin: 'proposal', version: sql`${plannedWorkouts.version} + 1` })
      .where(and(eq(plannedWorkouts.id, id), eq(plannedWorkouts.version, expectedVersion)))
      .returning();
    return row ?? null;
  },
};
