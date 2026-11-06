import type { Db } from '../db/client.js';
import { addDays, toIsoDate, weekStartOf } from '../domain/dates.js';
import { athletesRepo } from '../repositories/athletes.js';
import { recomputeWeeklyMetrics } from '../services/metrics.js';
import { recomputeMetricsPayload } from './definitions.js';

export type JobDeps = { db: Db; now?: () => Date };
const today = (deps: JobDeps) => toIsoDate((deps.now ?? (() => new Date()))());

/** Validates the (untrusted, queue-delivered) payload, then recomputes. Throws so pg-boss retries. */
export async function handleRecomputeMetrics(deps: JobDeps, data: unknown): Promise<{ weeks: number }> {
  const { userId, fromWeekStart } = recomputeMetricsPayload.parse(data);
  return { weeks: await recomputeWeeklyMetrics(deps.db, userId, fromWeekStart, today(deps)) };
}

export async function handleRecomputeAll(deps: JobDeps): Promise<{ athletes: number }> {
  const asOf = today(deps);
  const from = addDays(weekStartOf(asOf), -7);
  const ids = await athletesRepo.listAthleteIds(deps.db);
  for (const id of ids) await recomputeWeeklyMetrics(deps.db, id, from, asOf);
  return { athletes: ids.length };
}
