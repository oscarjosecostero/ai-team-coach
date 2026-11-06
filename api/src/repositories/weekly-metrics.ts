import { and, asc, eq, gte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { weeklyMetrics } from '../db/schema.js';

export type WeeklyMetricsRow = typeof weeklyMetrics.$inferSelect;
export type NewWeeklyMetrics = typeof weeklyMetrics.$inferInsert;

export const weeklyMetricsRepo = {
  async upsert(db: Db, values: NewWeeklyMetrics): Promise<void> {
    await db
      .insert(weeklyMetrics)
      .values(values)
      .onConflictDoUpdate({ target: [weeklyMetrics.userId, weeklyMetrics.weekStart], set: { ...values, computedAt: new Date() } });
  },

  async list(db: Db, userId: string, fromWeekStart?: string): Promise<WeeklyMetricsRow[]> {
    const where = fromWeekStart ? and(eq(weeklyMetrics.userId, userId), gte(weeklyMetrics.weekStart, fromWeekStart)) : eq(weeklyMetrics.userId, userId);
    return db.select().from(weeklyMetrics).where(where).orderBy(asc(weeklyMetrics.weekStart));
  },
};
