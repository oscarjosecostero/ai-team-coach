import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { handleDemoReseed } from '../../src/jobs/handlers.js';
import { activities, users } from '../../src/db/schema.js';
import { createTestDb } from '../helpers/db.js';

const database = createTestDb();
afterAll(() => database.sql.end());

describe('daily demo reseed', () => {
  it('replaces all data with a fresh demo team as of the job date, idempotently', async () => {
    const now = () => new Date('2026-12-01T04:00:00Z');
    expect(await handleDemoReseed({ db: database.db, now }, 'reseed-password')).toEqual({ athletes: 5, embedded: 0, analysesQueued: 0 });
    const first = await database.db.select({ id: users.id }).from(users);
    // With an LLM configured, it queues the post-activity check for every athlete.
    const queued: string[] = [];
    const publisher = { enqueuePostActivityAnalysis: async (id: string) => void queued.push(id) };
    const llm = { create: async () => Promise.reject(new Error('not called')) };
    expect(await handleDemoReseed({ db: database.db, now, llm, publisher }, 'reseed-password')).toEqual({ athletes: 5, embedded: 0, analysesQueued: 5 });
    const second = await database.db.select({ id: users.id }).from(users);
    expect(second).toHaveLength(first.length); // replaced, not appended
    expect(new Set(queued)).toEqual(new Set((await database.db.select({ id: users.id }).from(users).where(eq(users.role, 'athlete'))).map((u) => u.id)));
    const latest = await database.db.select({ startedAt: activities.startedAt }).from(activities);
    const newest = latest.map((a) => a.startedAt.toISOString().slice(0, 10)).sort().at(-1)!;
    expect(newest <= '2026-12-01' && newest >= '2026-11-28').toBe(true); // the story is anchored on the job date
  });
});
