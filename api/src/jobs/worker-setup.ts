import type { PgBoss } from 'pg-boss';
import { ALL_QUEUES, ANALYZE_POST_ACTIVITY, RECOMPUTE_ALL_METRICS, RECOMPUTE_METRICS, WEEKLY_REVIEW_ALL } from './definitions.js';
import { handlePostActivityAnalysis, handleRecomputeAll, handleRecomputeMetrics, handleWeeklyReviewAll, type JobDeps } from './handlers.js';

/** Creates queues, registers handlers and schedules recurring jobs. Shared by worker.ts and tests. */
export async function startWorkers(boss: PgBoss, deps: JobDeps, opts: { pollingIntervalSeconds?: number } = {}): Promise<void> {
  for (const name of ALL_QUEUES) await boss.createQueue(name);
  const work = { pollingIntervalSeconds: opts.pollingIntervalSeconds ?? 2 };

  await boss.work(RECOMPUTE_METRICS, work, async (jobs) => {
    for (const job of jobs) await handleRecomputeMetrics(deps, job.data);
  });
  await boss.work(RECOMPUTE_ALL_METRICS, work, async () => {
    await handleRecomputeAll(deps);
  });
  await boss.work(ANALYZE_POST_ACTIVITY, work, async (jobs) => {
    for (const job of jobs) await handlePostActivityAnalysis(deps, job.data);
  });
  await boss.work(WEEKLY_REVIEW_ALL, work, async () => {
    await handleWeeklyReviewAll(deps);
  });

  await boss.schedule(RECOMPUTE_ALL_METRICS, '0 3 * * *'); // daily, 03:00 UTC
  await boss.schedule(WEEKLY_REVIEW_ALL, '0 18 * * 0'); // Sundays, 18:00 UTC
}
