import { PgBoss } from 'pg-boss';
import { sql as dsql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { weekStartOf } from '../../src/domain/dates.js';
import { handleRecomputeAll, handleRecomputeMetrics } from '../../src/jobs/handlers.js';
import { PgBossPublisher } from '../../src/jobs/publisher.js';
import { startWorkers } from '../../src/jobs/worker-setup.js';
import { truncateAllData } from '../../src/repositories/maintenance.js';
import { weeklyMetricsRepo } from '../../src/repositories/weekly-metrics.js';
import { seedDemoTeam, type SeedResult } from '../../src/services/seed.js';
import { createTestDb, TEST_DATABASE_URL } from '../helpers/db.js';

const TODAY = '2026-11-06';
const database = createTestDb();
const { db } = database;
const now = () => new Date(`${TODAY}T12:00:00Z`);
let seeded: SeedResult;

beforeAll(async () => {
  await truncateAllData(db);
  seeded = await seedDemoTeam(db, { today: TODAY, password: 'test-password' });
});
afterAll(async () => {
  await database.sql.end();
});

const wipeMetrics = () => db.execute(dsql`delete from weekly_metrics`);

describe('job handlers', () => {
  it('recompute rebuilds weekly metrics from the given week through the current one', async () => {
    await wipeMetrics();
    const carlos = seeded.athletes[0]!;
    const res = await handleRecomputeMetrics({ db, now }, { userId: carlos.id, fromWeekStart: '2026-10-19' });
    expect(res.weeks).toBe(3);
    const weeks = await weeklyMetricsRepo.list(db, carlos.id);
    expect(weeks.map((w) => w.weekStart)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02']);
    expect(weeks.at(-1)!.maxConsecutiveHardDays).toBe(3);
  });

  it('rejects a malformed payload so the job fails instead of running with garbage', async () => {
    await expect(handleRecomputeMetrics({ db, now }, { userId: 'not-a-uuid', fromWeekStart: 'yesterday' })).rejects.toThrow();
  });

  it('the daily sweep refreshes the previous and current week for every athlete', async () => {
    await wipeMetrics();
    const res = await handleRecomputeAll({ db, now });
    expect(res.athletes).toBe(5);
    for (const a of seeded.athletes) {
      const weeks = await weeklyMetricsRepo.list(db, a.id);
      expect(weeks.map((w) => w.weekStart)).toEqual(['2026-10-26', weekStartOf(TODAY)]);
    }
  });
});

describe('pg-boss round trip', () => {
  it('a published job is picked up by the worker and updates weekly_metrics', async () => {
    await wipeMetrics();
    const boss = new PgBoss(TEST_DATABASE_URL);
    boss.on('error', () => {});
    await boss.start();
    try {
      await startWorkers(boss, { db, now }, { pollingIntervalSeconds: 0.5 });
      const carlos = seeded.athletes[0]!;
      await new PgBossPublisher(boss).enqueueMetricsRecompute(carlos.id, '2026-11-02');

      const deadline = Date.now() + 10_000;
      let rows = await weeklyMetricsRepo.list(db, carlos.id);
      while (rows.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
        rows = await weeklyMetricsRepo.list(db, carlos.id);
      }
      expect(rows.map((r) => r.weekStart)).toEqual(['2026-11-02']);
    } finally {
      await boss.stop({ graceful: false });
    }
  });
});
