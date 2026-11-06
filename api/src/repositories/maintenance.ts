import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';

/**
 * Empties every application table (dev/test/demo only). TRUNCATE does not fire the audit_log
 * row-level immutability trigger, which is why resetting is a deliberate, separate operation.
 */
export async function truncateAllData(db: Db): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE chat_messages, proposals, audit_log, agent_runs, knowledge_chunks, planned_workouts, weekly_metrics, wellness_checkins, activities, athlete_profiles, users, teams RESTART IDENTITY CASCADE`,
  );
}

export async function countTeams(db: Db): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM teams`);
  return rows[0]!.n;
}
