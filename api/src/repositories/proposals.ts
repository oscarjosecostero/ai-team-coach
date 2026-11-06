import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { plannedWorkouts, proposals, users } from '../db/schema.js';

export type ProposalRow = typeof proposals.$inferSelect;

const OPEN_STATUSES: ProposalRow['status'][] = ['awaiting_coach', 'pending'];

export const proposalsRepo = {
  async getById(db: Db, id: string): Promise<ProposalRow | null> {
    const [row] = await db.select().from(proposals).where(eq(proposals.id, id));
    return row ?? null;
  },

  /** Row lock for the duration of the surrounding transaction, so two decisions cannot interleave. */
  async getByIdForUpdate(db: Db, id: string): Promise<ProposalRow | null> {
    const [row] = await db.select().from(proposals).where(eq(proposals.id, id)).for('update');
    return row ?? null;
  },

  async listForUser(db: Db, userId: string, statuses?: ProposalRow['status'][]): Promise<ProposalRow[]> {
    const where = statuses?.length ? and(eq(proposals.userId, userId), inArray(proposals.status, statuses)) : eq(proposals.userId, userId);
    return db.select().from(proposals).where(where).orderBy(desc(proposals.createdAt));
  },

  async listForTeam(db: Db, teamId: string, statuses?: ProposalRow['status'][]): Promise<ProposalRow[]> {
    const base = eq(users.teamId, teamId);
    const where = statuses?.length ? and(base, inArray(proposals.status, statuses)) : base;
    const rows = await db.select({ p: proposals }).from(proposals).innerJoin(users, eq(users.id, proposals.userId)).where(where).orderBy(desc(proposals.createdAt));
    return rows.map((r) => r.p);
  },

  async update(db: Db, id: string, values: Partial<typeof proposals.$inferInsert>): Promise<ProposalRow> {
    const [row] = await db.update(proposals).set(values).where(eq(proposals.id, id)).returning();
    return row!;
  },

  /** Workouts of an athlete that already have a proposal waiting on the coach or the athlete. */
  async listOpenWorkoutIds(db: Db, userId: string): Promise<string[]> {
    const rows = await db
      .select({ id: proposals.plannedWorkoutId })
      .from(proposals)
      .where(and(eq(proposals.userId, userId), inArray(proposals.status, OPEN_STATUSES)));
    return [...new Set(rows.map((r) => r.id))];
  },

  async hasOpenForWorkout(db: Db, workoutId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: proposals.id })
      .from(proposals)
      .where(and(eq(proposals.plannedWorkoutId, workoutId), inArray(proposals.status, OPEN_STATUSES)))
      .limit(1);
    return Boolean(row);
  },

  async listByRun(db: Db, agentRunId: string): Promise<ProposalRow[]> {
    return db.select().from(proposals).where(eq(proposals.agentRunId, agentRunId)).orderBy(proposals.createdAt);
  },

  async listByRuns(db: Db, agentRunIds: string[]): Promise<ProposalRow[]> {
    if (agentRunIds.length === 0) return [];
    return db.select().from(proposals).where(inArray(proposals.agentRunId, agentRunIds)).orderBy(proposals.createdAt);
  },

  /** Used by the agent proposal service and by tests. */
  async insert(db: Db, values: typeof proposals.$inferInsert): Promise<ProposalRow> {
    const [row] = await db.insert(proposals).values(values).returning();
    return row!;
  },

  async getWorkoutOwnerTeam(db: Db, workoutId: string) {
    const [row] = await db
      .select({ userId: plannedWorkouts.userId, teamId: users.teamId })
      .from(plannedWorkouts)
      .innerJoin(users, eq(users.id, plannedWorkouts.userId))
      .where(eq(plannedWorkouts.id, workoutId));
    return row ?? null;
  },
};
