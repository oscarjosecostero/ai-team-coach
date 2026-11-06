import { describe, expect, it } from 'vitest';
import { applyProposedChange, validateChangeShape, type WorkoutFields } from '../../../src/domain/proposal-change.js';

const base: WorkoutFields = { date: '2026-11-10', sport: 'run', workoutType: 'intervals', title: '6x800m', description: null, durationMin: 60, targetZone: null };

describe('proposal change', () => {
  it('reduce keeps the workout but shortens it and lowers planned load', () => {
    const next = applyProposedChange(base, 'reduce', { durationMin: 40 });
    expect(next).toMatchObject({ durationMin: 40, workoutType: 'intervals' });
    expect(next.plannedLoad).toBeLessThan(applyProposedChange(base, 'reduce', { durationMin: 60 }).plannedLoad);
  });

  it('rest zeroes duration and load', () => {
    expect(applyProposedChange(base, 'rest', {})).toMatchObject({ workoutType: 'rest', durationMin: 0, plannedLoad: 0 });
  });

  it('move only changes the date', () => {
    expect(applyProposedChange(base, 'move', { date: '2026-11-12' })).toMatchObject({ date: '2026-11-12', title: '6x800m', durationMin: 60 });
  });

  it('replace swaps the workout and recomputes load from the new type', () => {
    const next = applyProposedChange(base, 'replace', { workoutType: 'easy', title: 'Easy run', durationMin: 40 });
    expect(next).toMatchObject({ workoutType: 'easy', title: 'Easy run', durationMin: 40, sport: 'run', plannedLoad: 80 });
  });

  it('validates required fields per change type', () => {
    expect(validateChangeShape('reduce', {})).toMatch(/durationMin/);
    expect(validateChangeShape('move', {})).toMatch(/date/);
    expect(validateChangeShape('replace', { title: 'x' })).toMatch(/workoutType/);
    expect(validateChangeShape('rest', {})).toBeNull();
  });
});
