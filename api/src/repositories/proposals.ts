import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { plannedWorkouts, proposals, users } from '../db/schema.js';

export type ProposalRow = typeof proposals.$inferSelect;

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

  /** Used by the agent layer (Phase 3) and by tests. */
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
