import { describe, expect, it } from 'vitest';
import { sessionShape } from '../../../src/domain/session-shape.js';

const total = (blocks: { minutes: number }[]) => blocks.reduce((s, b) => s + b.minutes, 0);

describe('sessionShape', () => {
  it('has no blocks for rest or zero-minute sessions', () => {
    expect(sessionShape({ workoutType: 'rest', durationMin: 0, targetZone: null })).toEqual([]);
    expect(sessionShape({ workoutType: 'easy', durationMin: 0, targetZone: null })).toEqual([]);
  });

  it('shapes a steady session as warm-up, main block at the default zone, cool-down', () => {
    expect(sessionShape({ workoutType: 'easy', durationMin: 60, targetZone: null })).toEqual([
      { phase: 'warmup', minutes: 6, zone: 1 },
      { phase: 'main', minutes: 48, zone: 2 },
      { phase: 'cooldown', minutes: 6, zone: 1 },
    ]);
  });

  it('uses the target zone when set, and a single block for recovery or short sessions', () => {
    expect(sessionShape({ workoutType: 'tempo', durationMin: 40, targetZone: 3 })[1]).toEqual({ phase: 'main', minutes: 28, zone: 3 });
    expect(sessionShape({ workoutType: 'recovery', durationMin: 30, targetZone: null })).toEqual([{ phase: 'main', minutes: 30, zone: 1 }]);
    expect(sessionShape({ workoutType: 'easy', durationMin: 15, targetZone: null })).toEqual([{ phase: 'main', minutes: 15, zone: 2 }]);
  });

  it('shapes intervals as work/recover repeats between warm-up and cool-down', () => {
    const blocks = sessionShape({ workoutType: 'intervals', durationMin: 60, targetZone: null });
    expect(blocks[0]).toEqual({ phase: 'warmup', minutes: 12, zone: 1 });
    expect(blocks.at(-1)).toEqual({ phase: 'cooldown', minutes: 9, zone: 1 });
    const work = blocks.filter((b) => b.phase === 'work');
    expect(work).toHaveLength(5);
    expect(work.every((b) => b.zone === 4)).toBe(true);
    expect(blocks.filter((b) => b.phase === 'recover')).toHaveLength(5);
  });

  it('always adds up to the planned duration', () => {
    for (const workoutType of ['easy', 'long', 'tempo', 'intervals', 'brick', 'strength', 'recovery']) {
      for (const durationMin of [20, 25, 33, 45, 47, 90, 151, 240]) {
        const blocks = sessionShape({ workoutType, durationMin, targetZone: null });
        expect(total(blocks), `${workoutType} ${durationMin}`).toBe(durationMin);
        expect(blocks.every((b) => b.minutes > 0 && b.zone >= 1 && b.zone <= 5)).toBe(true);
      }
    }
  });
});
