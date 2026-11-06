import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';

export type UserRow = typeof users.$inferSelect;

export const usersRepo = {
  async findByEmail(db: Db, email: string): Promise<UserRow | null> {
    const [row] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
    return row ?? null;
  },

  async findById(db: Db, id: string): Promise<UserRow | null> {
    const [row] = await db.select().from(users).where(eq(users.id, id));
    return row ?? null;
  },

  async listAll(db: Db): Promise<UserRow[]> {
    return db.select().from(users).orderBy(asc(users.role), asc(users.name));
  },

  async listByTeam(db: Db, teamId: string): Promise<UserRow[]> {
    return db.select().from(users).where(eq(users.teamId, teamId)).orderBy(asc(users.name));
  },
};
