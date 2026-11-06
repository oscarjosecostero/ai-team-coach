import { describe, expect, it } from 'vitest';
import { computeHrZones, timeInZones, zoneForHr } from '../../../src/domain/zones.js';
import { durationEstimateLoad, edwardsTrimp } from '../../../src/domain/load.js';
import { classifyIntensity, intensitySplit, maxConsecutiveHardDays } from '../../../src/domain/intensity.js';
import { acwr, ewma, fitnessMetrics } from '../../../src/domain/fitness.js';
import { checkProposalGuardrails, type GuardrailInput } from '../../../src/domain/plan-guardrails.js';

describe('zones', () => {
  const z = computeHrZones({ lthr: 170 });
  it('computes Friel zones from LTHR', () => {
    expect(z).toEqual({ z1Max: 144, z2Max: 151, z3Max: 160, z4Max: 168 });
  });
  it('falls back to %HRmax', () => {
    expect(computeHrZones({ maxHr: 190 }).z4Max).toBe(171);
  });
  it('throws without lthr or maxHr', () => {
    expect(() => computeHrZones({})).toThrow();
  });
  it('assigns zones at boundaries', () => {
    expect([144, 145, 168, 169].map((h) => zoneForHr(h, z))).toEqual([1, 2, 4, 5]);
  });
  it('accumulates time per zone', () => {
    expect(timeInZones([100, 150, 150, 180], z, 2)).toEqual([2, 4, 0, 0, 2]);
  });
});

describe('load', () => {
  it('computes Edwards TRIMP', () => {
    expect(edwardsTrimp([600, 1200, 0, 600, 0])).toBe(10 + 40 + 40);
  });
  it('estimates load from duration and RPE', () => {
    expect(durationEstimateLoad({ durationS: 3600, sport: 'run', rpe: 6 })).toBe(180);
    expect(durationEstimateLoad({ durationS: 3600, sport: 'bike', intensityClass: 'easy' })).toBe(72);
  });
});

describe('intensity', () => {
  it('splits low/high', () => {
    expect(intensitySplit([300, 500, 100, 50, 50])).toEqual({ lowPct: 80, highPct: 20 });
    expect(intensitySplit([0, 0, 0, 0, 0])).toEqual({ lowPct: 0, highPct: 0 });
  });
  it('classifies sessions', () => {
    expect(classifyIntensity([100, 100, 0, 50, 50])).toBe('hard');
    expect(classifyIntensity([500, 400, 50, 25, 25])).toBe('easy');
    expect(classifyIntensity([200, 200, 400, 100, 0])).toBe('moderate');
  });
  it('finds max consecutive hard days', () => {
    expect(maxConsecutiveHardDays(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-05', '2026-11-02'])).toBe(3);
    expect(maxConsecutiveHardDays([])).toBe(0);
  });
});

describe('fitness', () => {
  it('ewma of a constant series equals the constant', () => {
    expect(ewma(Array(50).fill(100), 7)).toBeCloseTo(100);
  });
  it('rising load gives negative TSB', () => {
    const loads = [...Array(35).fill(50), ...Array(7).fill(120)];
    const m = fitnessMetrics(loads);
    expect(m.atl).toBeGreaterThan(m.ctl);
    expect(m.tsb).toBeLessThan(0);
  });
  it('computes ACWR and handles zero chronic load', () => {
    expect(acwr([...Array(21).fill(50), ...Array(7).fill(100)])).toBe(1.6);
    expect(acwr(Array(28).fill(0))).toBeNull();
  });
});

describe('guardrails', () => {
  const base: GuardrailInput = {
    workoutOwnerId: 'a', proposerAthleteId: 'a', workoutDate: '2026-11-10', today: '2026-11-06',
    currentWeekPlannedLoad: 100, proposedWeekPlannedLoad: 95, changeType: 'replace',
    injurySignal: false, hasOpenProposalForWorkout: false,
  };
  it('accepts a valid proposal', () => expect(checkProposalGuardrails(base)).toEqual({ ok: true }));
  it('rejects >10% load changes', () => {
    expect(checkProposalGuardrails({ ...base, proposedWeekPlannedLoad: 115 }).ok).toBe(false);
    expect(checkProposalGuardrails({ ...base, proposedWeekPlannedLoad: 85 }).ok).toBe(false);
  });
  it('rejects past workouts, foreign workouts and duplicates', () => {
    const r = checkProposalGuardrails({ ...base, workoutDate: '2026-11-06', workoutOwnerId: 'b', hasOpenProposalForWorkout: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations).toHaveLength(3);
  });
  it('injury only allows reduce/rest and permits large decreases', () => {
    expect(checkProposalGuardrails({ ...base, injurySignal: true, changeType: 'replace' }).ok).toBe(false);
    expect(checkProposalGuardrails({ ...base, injurySignal: true, changeType: 'rest', proposedWeekPlannedLoad: 60 })).toEqual({ ok: true });
  });
});
