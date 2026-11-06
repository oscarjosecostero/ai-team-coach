import { FitBaseType, FitEncoder } from 'fit-file-parser';
import { sql as dsql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { weekStartOf } from '../../src/domain/dates.js';
import { FileActivitySource } from '../../src/integrations/files/file-source.js';
import { SeedActivitySource } from '../../src/integrations/seed/seed-source.js';
import { buildScenario } from '../../src/integrations/seed/scenario.js';
import { activitiesRepo } from '../../src/repositories/activities.js';
import { athletesRepo } from '../../src/repositories/athletes.js';
import { truncateAllData } from '../../src/repositories/maintenance.js';
import { weeklyMetricsRepo } from '../../src/repositories/weekly-metrics.js';
import { ingestActivities } from '../../src/services/ingestion.js';
import { recomputeWeeklyMetrics } from '../../src/services/metrics.js';
import { seedDemoTeam, type SeedResult } from '../../src/services/seed.js';
import { createTestDb } from '../helpers/db.js';

const TODAY = '2026-11-06'; // a Friday
const database = createTestDb();
const { db } = database;
let seeded: SeedResult;

async function count(query: ReturnType<typeof dsql>): Promise<number> {
  const rows = await db.execute<{ n: number }>(query);
  return rows[0]!.n;
}

/** Drizzle wraps driver errors; the Postgres message lives on `cause`. */
async function dbErrorMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    const e = err as Error & { cause?: Error };
    return `${e.message} ${e.cause?.message ?? ''}`;
  }
  return '';
}

const athlete = (name: string) => seeded.athletes.find((a) => a.name.startsWith(name))!;

beforeAll(async () => {
  await truncateAllData(db);
  seeded = await seedDemoTeam(db, { today: TODAY, password: 'test-password' });
});
afterAll(async () => {
  await database.sql.end();
});

describe('seed scenario -> weekly_metrics', () => {
  it('creates the team: 1 coach, 5 athletes, 2 weeks of plan, notes as knowledge chunks', async () => {
    expect(seeded.athletes).toHaveLength(5);
    expect(await count(dsql`select count(*)::int n from planned_workouts`)).toBe(5 * 14);
    expect(await count(dsql`select count(*)::int n from knowledge_chunks where embedding is null`)).toBeGreaterThan(0);
  });

  it('computes metrics for every athlete over the 8 weeks of history plus the current week', async () => {
    for (const a of seeded.athletes) {
      const weeks = await weeklyMetricsRepo.list(db, a.id);
      expect(weeks.length).toBeGreaterThanOrEqual(9);
      expect(weeks.at(-1)!.weekStart).toBe(weekStartOf(TODAY));
      for (const w of weeks) {
        expect(w.totalLoad).toBeGreaterThan(0);
        expect(w.lowIntensityPct + w.highIntensityPct).toBeGreaterThan(99); // zones add up (rounding)
      }
    }
  });

  it('every activity has a backend-computed load, method and intensity class', async () => {
    expect(await count(dsql`select count(*)::int n from activities where training_load is null or load_method is null or intensity_class is null`)).toBe(0);
    expect(await count(dsql`select count(*)::int n from activities where sport = 'strength' and load_method = 'duration_estimate'`)).toBeGreaterThan(0);
  });

  it("tells Carlos's story: 3 hard days in a row and resting HR up", async () => {
    const [current] = (await weeklyMetricsRepo.list(db, athlete('Carlos').id, weekStartOf(TODAY)));
    expect(current!.hardSessions).toBe(3);
    expect(current!.maxConsecutiveHardDays).toBe(3);
    expect(current!.restingHrDelta).toBeGreaterThanOrEqual(3);
    expect(current!.acwr).toBeGreaterThan(1.1);
    expect(current!.tsb).toBeLessThan(0);
  });

  it("flags Marcos's sudden load spike and nobody else's streak", async () => {
    const marcos = await weeklyMetricsRepo.list(db, athlete('Marcos').id);
    expect(Math.max(...marcos.map((w) => w.acwr ?? 0))).toBeGreaterThan(1.5);
    for (const a of seeded.athletes.filter((x) => !x.name.startsWith('Carlos'))) {
      const latest = (await weeklyMetricsRepo.list(db, a.id)).at(-1)!;
      expect(latest.maxConsecutiveHardDays).toBeLessThan(2);
    }
  });

  it('compares a partial current week like-for-like (no spurious -40% drop)', async () => {
    const lucia = (await weeklyMetricsRepo.list(db, athlete('Luc').id)).at(-1)!;
    expect(lucia.loadChangePct).not.toBeNull();
    expect(Math.abs(lucia.loadChangePct!)).toBeLessThan(80);
  });

  it('re-seeding the same activities is idempotent', async () => {
    const carlos = athlete('Carlos');
    const scenario = buildScenario(TODAY);
    const before = await activitiesRepo.listUpTo(db, carlos.id, new Date(`${TODAY}T23:59:59Z`));
    const res = await ingestActivities({ db }, carlos.id, new SeedActivitySource(scenario.athletes[0]!.activities));
    expect(res.created).toBe(0);
    expect(res.duplicates).toBe(before.length);
    expect(res.fromWeekStart).toBeNull();
  });
});

describe('FIT upload -> activity -> metrics', () => {
  const START = new Date(`${TODAY}T06:30:00Z`);
  function fit(): Buffer {
    const enc = new FitEncoder();
    enc.writeMessage(0, [
      { number: 0, size: 1, baseType: FitBaseType.Enum, value: 4 },
      { number: 1, size: 2, baseType: FitBaseType.Uint16, value: 1 },
    ]);
    const seconds = 1800;
    for (let s = 0; s < seconds; s++) {
      enc.writeMessage(20, [
        { number: 253, size: 4, baseType: FitBaseType.Uint32, value: FitEncoder.toFitTimestamp(new Date(START.getTime() + s * 1000)) },
        { number: 3, size: 1, baseType: FitBaseType.Uint8, value: 175 }, // Carlos LTHR 168 -> zone 5 / 4
      ], 1);
    }
    enc.writeMessage(18, [
      { number: 253, size: 4, baseType: FitBaseType.Uint32, value: FitEncoder.toFitTimestamp(new Date(START.getTime() + seconds * 1000)) },
      { number: 2, size: 4, baseType: FitBaseType.Uint32, value: FitEncoder.toFitTimestamp(START) },
      { number: 5, size: 1, baseType: FitBaseType.Enum, value: 1 },
      { number: 7, size: 4, baseType: FitBaseType.Uint32, value: seconds * 1000 },
      { number: 8, size: 4, baseType: FitBaseType.Uint32, value: seconds * 1000 },
      { number: 9, size: 4, baseType: FitBaseType.Uint32, value: 5000 * 100 },
    ], 2);
    return Buffer.from(enc.close());
  }

  it('ingests a FIT file with zones from the athlete profile, then updates metrics via afterIngest', async () => {
    const carlos = athlete('Carlos');
    const before = (await weeklyMetricsRepo.list(db, carlos.id, weekStartOf(TODAY)))[0]!;
    const calls: Array<[string, string]> = [];
    const res = await ingestActivities(
      {
        db,
        afterIngest: async (userId, fromWeek) => {
          calls.push([userId, fromWeek]);
          await recomputeWeeklyMetrics(db, userId, fromWeek, TODAY);
        },
      },
      carlos.id,
      new FileActivitySource({ name: 'extra.fit', content: fit() }),
    );
    expect(res).toMatchObject({ created: 1, duplicates: 0, fromWeekStart: weekStartOf(TODAY) });
    expect(calls).toEqual([[carlos.id, weekStartOf(TODAY)]]);

    const [row] = (await activitiesRepo.listUpTo(db, carlos.id, new Date(`${TODAY}T23:59:59Z`))).filter((a) => a.source === 'file');
    expect(row).toMatchObject({ loadMethod: 'hr_trimp', intensityClass: 'hard', sport: 'run', distanceM: 5000 });
    expect(row!.avgPaceSPerKm).toBe(360);
    expect(row!.timeInZonesS!.reduce((a, b) => a + b, 0)).toBe(1799);

    const after = (await weeklyMetricsRepo.list(db, carlos.id, weekStartOf(TODAY)))[0]!;
    expect(after.totalLoad).toBeGreaterThan(before.totalLoad);
    expect(after.hardSessions).toBe(before.hardSessions + 1);

    // Uploading the same bytes again changes nothing.
    const again = await ingestActivities({ db }, carlos.id, new FileActivitySource({ name: 'extra-copy.fit', content: fit() }));
    expect(again).toMatchObject({ created: 0, duplicates: 1, fromWeekStart: null });
  });

  it('rejects ingestion for a user without a profile', async () => {
    await expect(ingestActivities({ db }, seeded.coach.id, new SeedActivitySource([]))).rejects.toThrow(/No athlete profile/);
    expect(await athletesRepo.getProfile(db, seeded.coach.id)).toBeNull();
  });
});

describe('audit_log', () => {
  it('is append-only at the database level', async () => {
    await db.execute(dsql`insert into audit_log (actor_type, actor_id, action, entity_type, entity_id) values ('system', 'test', 'test.event', 'test', '1')`);
    expect(await dbErrorMessage(db.execute(dsql`update audit_log set action = 'tampered'`))).toMatch(/append-only/);
    expect(await dbErrorMessage(db.execute(dsql`delete from audit_log`))).toMatch(/append-only/);
  });
});
