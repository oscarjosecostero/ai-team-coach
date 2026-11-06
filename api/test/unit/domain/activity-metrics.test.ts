import { describe, expect, it } from 'vitest';
import { computeActivityMetrics } from '../../../src/domain/activity-metrics.js';
import { computeHrZones } from '../../../src/domain/zones.js';

const zones = computeHrZones({ lthr: 170 });

describe('computeActivityMetrics', () => {
  it('uses TRIMP from HR samples', () => {
    const hr = [...Array(600).fill(120), ...Array(600).fill(185)]; // 10 min Z1, 10 min Z5
    const m = computeActivityMetrics({ sport: 'run', durationS: 1200, distanceM: 4000, hrSamples: hr, zones });
    expect(m.loadMethod).toBe('hr_trimp');
    expect(m.timeInZonesS).toEqual([600, 0, 0, 0, 600]);
    expect(m.trainingLoad).toBe(10 * 1 + 10 * 5);
    expect(m.intensityClass).toBe('hard');
    expect(m.avgPaceSPerKm).toBe(300);
  });

  it('prefers pre-aggregated zones and ignores samples-less HR', () => {
    const m = computeActivityMetrics({ sport: 'bike', durationS: 3600, timeInZonesS: [0, 3600, 0, 0, 0], zones: null });
    expect(m.trainingLoad).toBe(120);
    expect(m.intensityClass).toBe('easy');
    expect(m.avgPaceSPerKm).toBeNull(); // no pace for bike
  });

  it('falls back to a duration estimate without HR, using RPE for intensity', () => {
    const hard = computeActivityMetrics({ sport: 'strength', durationS: 3600, rpe: 8, zones });
    expect(hard.loadMethod).toBe('duration_estimate');
    expect(hard.intensityClass).toBe('hard');
    expect(hard.trainingLoad).toBe(60 * 0.7 * 4);
    expect(computeActivityMetrics({ sport: 'run', durationS: 1800, rpe: 3, zones }).intensityClass).toBe('easy');
    expect(computeActivityMetrics({ sport: 'run', durationS: 1800, zones }).intensityClass).toBe('moderate');
  });

  it('falls back when HR exists but zones are unknown', () => {
    const m = computeActivityMetrics({ sport: 'run', durationS: 1800, hrSamples: [150, 150], zones: null });
    expect(m.loadMethod).toBe('duration_estimate');
  });
});
