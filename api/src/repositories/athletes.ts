import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { athleteProfiles, teams, users } from '../db/schema.js';

export type AthleteProfile = typeof athleteProfiles.$inferSelect;

export const athletesRepo = {
  async getProfile(db: Db, userId: string): Promise<AthleteProfile | null> {
    const [row] = await db.select().from(athleteProfiles).where(eq(athleteProfiles.userId, userId));
    return row ?? null;
  },

  async listAthleteIds(db: Db): Promise<string[]> {
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.role, 'athlete')).orderBy(asc(users.name));
    return rows.map((r) => r.id);
  },

  async createTeam(db: Db, values: typeof teams.$inferInsert) {
    const [row] = await db.insert(teams).values(values).returning();
    return row!;
  },

  async createUser(db: Db, values: typeof users.$inferInsert) {
    const [row] = await db.insert(users).values(values).returning();
    return row!;
  },

  async createProfile(db: Db, values: typeof athleteProfiles.$inferInsert) {
    await db.insert(athleteProfiles).values(values);
  },
};
