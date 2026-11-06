import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { teams } from '../db/schema.js';

export const teamsRepo = {
  async get(db: Db, id: string) {
    const [row] = await db.select().from(teams).where(eq(teams.id, id));
    return row ?? null;
  },
};
