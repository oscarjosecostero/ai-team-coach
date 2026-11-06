import type { PgBoss } from 'pg-boss';
import { ALL_QUEUES, RECOMPUTE_ALL_METRICS, RECOMPUTE_METRICS } from './definitions.js';
import { handleRecomputeAll, handleRecomputeMetrics, type JobDeps } from './handlers.js';

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

  await boss.schedule(RECOMPUTE_ALL_METRICS, '0 3 * * *'); // daily, 03:00 UTC
}
