import { and, asc, eq, gte, lte } from 'drizzle-orm';
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
};
