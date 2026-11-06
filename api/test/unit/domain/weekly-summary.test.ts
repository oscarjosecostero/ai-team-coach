import { describe, expect, it } from 'vitest';
import { addDays, eachDay, weekStartOf } from '../../../src/domain/dates.js';
import { plannedWorkoutLoad } from '../../../src/domain/load.js';
import { summarizeWeek, type SummaryActivity } from '../../../src/domain/weekly-summary.js';

const act = (date: string, over: Partial<SummaryActivity> = {}): SummaryActivity => ({
  date,
  sport: 'run',
  durationS: 3600,
  distanceM: 10_000,
  trainingLoad: 100,
  timeInZonesS: [0, 3600, 0, 0, 0],
  intensityClass: 'easy',
  ...over,
});

describe('dates', () => {
  it('finds the Monday of a week', () => {
    expect(weekStartOf('2026-11-06')).toBe('2026-11-02'); // Friday
    expect(weekStartOf('2026-11-08')).toBe('2026-11-02'); // Sunday
    expect(weekStartOf('2026-11-02')).toBe('2026-11-02'); // Monday
  });
  it('adds days across month boundaries and lists ranges', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(eachDay('2026-11-01', '2026-11-03')).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(eachDay('2026-11-03', '2026-11-01')).toEqual([]);
  });
});

describe('plannedWorkoutLoad', () => {
  it('is minutes x zone, zero for rest', () => {
    expect(plannedWorkoutLoad({ durationMin: 60, workoutType: 'easy', sport: 'run' })).toBe(120);
    expect(plannedWorkoutLoad({ durationMin: 60, workoutType: 'intervals', sport: 'run' })).toBe(240);
    expect(plannedWorkoutLoad({ durationMin: 60, workoutType: 'rest', sport: 'other' })).toBe(0);
    expect(plannedWorkoutLoad({ durationMin: 45, workoutType: 'easy', sport: 'run', targetZone: 1 })).toBe(45);
  });
});

describe('summarizeWeek', () => {
  const weekStart = '2026-11-02';

  it('totals duration, distance and load and compares with the previous week', () => {
    const s = summarizeWeek({
      weekStart,
      activities: [act('2026-10-27'), act('2026-11-02', { trainingLoad: 150 }), act('2026-11-04', { sport: 'bike', distanceM: 40_000, trainingLoad: 50 })],
      checkins: [],
      restingHrBaseline: null,
    });
    expect(s.totalDurationS).toBe(7200);
    expect(s.totalDistanceBySport).toEqual({ run: 10_000, bike: 40_000 });
    expect(s.totalLoad).toBe(200);
    expect(s.loadChangePct).toBe(100); // 100 -> 200
  });

  it('has no load change when the previous week is empty', () => {
    const s = summarizeWeek({ weekStart, activities: [act('2026-11-03')], checkins: [], restingHrBaseline: null });
    expect(s.loadChangePct).toBeNull();
  });

  it('counts hard sessions and consecutive hard days', () => {
    const hard = { intensityClass: 'hard' as const, timeInZonesS: [0, 0, 0, 1800, 1800] as const };
    const s = summarizeWeek({
      weekStart,
      activities: [act('2026-11-02', hard), act('2026-11-03', hard), act('2026-11-04', hard), act('2026-11-06', hard)],
      checkins: [],
      restingHrBaseline: null,
    });
    expect(s.hardSessions).toBe(4);
    expect(s.maxConsecutiveHardDays).toBe(3);
    expect(s.highIntensityPct).toBe(100);
    expect(s.lowIntensityPct).toBe(0);
  });

  it('computes resting HR delta against the baseline', () => {
    const s = summarizeWeek({
      weekStart,
      activities: [act('2026-11-02')],
      checkins: [
        { date: '2026-11-02', restingHr: 52 },
        { date: '2026-11-03', restingHr: 56 },
        { date: '2026-11-04', restingHr: null },
        { date: '2026-10-30', restingHr: 40 }, // other week, ignored
      ],
      restingHrBaseline: 50,
    });
    expect(s.avgRestingHr).toBe(54);
    expect(s.restingHrDelta).toBe(4);
  });

  it('stops the fitness series at asOf so the current week is not padded with zeros', () => {
    const activities = [act('2026-11-02'), act('2026-11-03'), act('2026-11-04')];
    const base = { weekStart, activities, checkins: [], restingHrBaseline: null };
    const midWeek = summarizeWeek({ ...base, asOf: '2026-11-04' });
    const fullWeek = summarizeWeek(base);
    expect(midWeek.atl).toBeGreaterThan(fullWeek.atl);
    expect(midWeek.ctl).toBeGreaterThan(fullWeek.ctl);
    expect(midWeek.acwr).toBe(1); // 3 days of history: acute and chronic windows coincide
  });

  it('returns zeros for an empty week without throwing', () => {
    const s = summarizeWeek({ weekStart, activities: [], checkins: [], restingHrBaseline: null });
    expect(s.totalLoad).toBe(0);
    expect(s.acwr).toBeNull();
    expect(s.hardSessions).toBe(0);
  });
});

describe('hard streaks across week boundaries', () => {
  const hard = { intensityClass: 'hard' as const, timeInZonesS: [0, 0, 0, 1800, 1800] as const };
  it('counts a streak that started in the previous week when the series ends mid-week', () => {
    const s = summarizeWeek({
      weekStart: '2026-11-02',
      activities: [act('2026-10-31', hard), act('2026-11-01', hard), act('2026-11-02', hard)],
      checkins: [],
      restingHrBaseline: null,
      asOf: '2026-11-03',
    });
    expect(s.hardSessions).toBe(1);
    expect(s.maxConsecutiveHardDays).toBe(3);
  });
});

describe('load change for a partial week', () => {
  it('compares against the same number of days of the previous week', () => {
    const activities = [
      act('2026-10-26', { trainingLoad: 100 }),
      act('2026-10-27', { trainingLoad: 100 }),
      act('2026-10-30', { trainingLoad: 300 }), // later in the previous week: must not count
      act('2026-11-02', { trainingLoad: 100 }),
      act('2026-11-03', { trainingLoad: 120 }),
    ];
    const s = summarizeWeek({ weekStart: '2026-11-02', activities, checkins: [], restingHrBaseline: null, asOf: '2026-11-03' });
    expect(s.totalLoad).toBe(220);
    expect(s.loadChangePct).toBe(10); // 220 vs 200 over Mon-Tue
  });
});
