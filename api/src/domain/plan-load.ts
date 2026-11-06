import type { ChangeType, ProposedChange } from '@coach/contracts';
import { weekStartOf } from './dates.js';
import { MAX_WEEKLY_LOAD_CHANGE_PCT } from './plan-guardrails.js';
import { applyProposedChange, type WorkoutFields } from './proposal-change.js';

export type PlannedLoadItem = { id: string; date: string; plannedLoad: number };

/** Sum of planned load per Monday-based week. */
export function plannedLoadByWeek(workouts: PlannedLoadItem[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const w of workouts) {
    const wk = weekStartOf(w.date);
    out.set(wk, round1((out.get(wk) ?? 0) + w.plannedLoad));
  }
  return out;
}

export type WeekLoadImpact = {
  weekStart: string;
  before: number;
  after: number;
  changePct: number | null;
  /** Allowed planned-load range for that week under the ±10% rule (before any injury exception). */
  allowedMin: number;
  allowedMax: number;
};

/**
 * What a proposed change does to the planned load of every week it touches (a `move` can touch two).
 * `weekWorkouts` must contain all planned workouts of those weeks, including the target.
 */
export function proposalLoadImpact(input: {
  target: WorkoutFields & { id: string; plannedLoad: number };
  changeType: ChangeType;
  change: ProposedChange;
  weekWorkouts: PlannedLoadItem[];
}): { next: WorkoutFields & { plannedLoad: number }; weeks: WeekLoadImpact[] } {
  const next = applyProposedChange(input.target, input.changeType, input.change);
  const others = input.weekWorkouts.filter((w) => w.id !== input.target.id);
  const before = plannedLoadByWeek([...others, { id: input.target.id, date: input.target.date, plannedLoad: input.target.plannedLoad }]);
  const after = plannedLoadByWeek([...others, { id: input.target.id, date: next.date, plannedLoad: next.plannedLoad }]);
  const weeks = [...new Set([weekStartOf(input.target.date), weekStartOf(next.date)])].sort();

  return {
    next,
    weeks: weeks.map((weekStart) => {
      const b = before.get(weekStart) ?? 0;
      const a = after.get(weekStart) ?? 0;
      const f = MAX_WEEKLY_LOAD_CHANGE_PCT / 100;
      return {
        weekStart,
        before: b,
        after: a,
        changePct: b > 0 ? round1(((a - b) / b) * 100) : null,
        allowedMin: round1(b * (1 - f)),
        allowedMax: round1(b * (1 + f)),
      };
    }),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
