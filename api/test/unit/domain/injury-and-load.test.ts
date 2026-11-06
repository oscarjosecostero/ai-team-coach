import { describe, expect, it } from 'vitest';
import { detectInjurySignal, mentionsInjury } from '../../../src/domain/injury-signal.js';
import { plannedLoadByWeek, proposalLoadImpact } from '../../../src/domain/plan-load.js';

describe('detectInjurySignal', () => {
  const today = '2026-11-06';

  it('ignores ordinary fatigue and soreness below 5', () => {
    const s = detectInjurySignal(
      { checkins: [{ date: today, soreness: 4, note: 'Legs heavy after three hard days in a row, slept badly.' }], activityNotes: [{ date: today, note: 'Heavy legs from the first kilometer.' }] },
      today,
    );
    expect(s).toEqual({ flag: false, reasons: [] });
  });

  it('flags pain words in notes and maximal soreness within the last 7 days', () => {
    const s = detectInjurySignal(
      {
        checkins: [
          { date: '2026-11-05', soreness: 5, note: null },
          { date: '2026-10-20', soreness: 5, note: 'Sharp pain' }, // outside the window
        ],
        activityNotes: [{ date: '2026-11-03', note: 'Felt a strain in my hamstring.' }],
      },
      today,
    );
    expect(s.flag).toBe(true);
    expect(s.reasons).toEqual(['soreness 5/5 on 2026-11-05', 'activity note on 2026-11-03 mentions pain or injury']);
  });

  it('matches whole words only', () => {
    expect(mentionsInjury('Sharp pain in the knee')).toBe(true);
    expect(mentionsInjury('I have shin splints again')).toBe(true);
    expect(mentionsInjury('Painted the fence, then ran')).toBe(false);
    expect(mentionsInjury('Sharpened my focus')).toBe(false);
  });
});

describe('proposalLoadImpact', () => {
  const week = [
    { id: 'tue', date: '2026-11-10', plannedLoad: 175 },
    { id: 'thu', date: '2026-11-12', plannedLoad: 240 },
    { id: 'sat', date: '2026-11-14', plannedLoad: 300 },
    { id: 'nextmon', date: '2026-11-16', plannedLoad: 100 },
  ];
  const thu = { id: 'thu', date: '2026-11-12', sport: 'run' as const, workoutType: 'intervals' as const, title: 'Intervals', description: null, durationMin: 60, targetZone: null, plannedLoad: 240 };

  it('sums planned load per Monday week', () => {
    expect(Object.fromEntries(plannedLoadByWeek(week))).toEqual({ '2026-11-09': 715, '2026-11-16': 100 });
  });

  it('computes before/after/allowed range for the touched week', () => {
    const { next, weeks } = proposalLoadImpact({ target: thu, changeType: 'reduce', change: { durationMin: 45 }, weekWorkouts: week });
    expect(next.plannedLoad).toBe(180);
    expect(weeks).toEqual([{ weekStart: '2026-11-09', before: 715, after: 655, changePct: -8.4, allowedMin: 643.5, allowedMax: 786.5 }]);
  });

  it('reports both weeks when a move crosses a week boundary', () => {
    const { weeks } = proposalLoadImpact({ target: thu, changeType: 'move', change: { date: '2026-11-17' }, weekWorkouts: week });
    expect(weeks.map((w) => [w.weekStart, w.before, w.after])).toEqual([
      ['2026-11-09', 715, 475],
      ['2026-11-16', 100, 340],
    ]);
  });
});
