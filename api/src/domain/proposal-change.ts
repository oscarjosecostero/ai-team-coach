import type { ChangeType, ProposedChange } from '@coach/contracts';
import { plannedWorkoutLoad } from './load.js';

export type WorkoutFields = {
  date: string;
  sport: 'run' | 'bike' | 'swim' | 'strength' | 'other';
  workoutType: 'easy' | 'long' | 'tempo' | 'intervals' | 'recovery' | 'strength' | 'brick' | 'rest';
  title: string;
  description: string | null;
  durationMin: number;
  targetZone: number | null;
};

/** Returns the human-readable problem with a change, or null when it is well formed for its type. */
export function validateChangeShape(changeType: ChangeType, change: ProposedChange): string | null {
  switch (changeType) {
    case 'reduce':
      return change.durationMin === undefined ? 'reduce requires durationMin' : null;
    case 'move':
      return change.date === undefined ? 'move requires date' : null;
    case 'replace':
      return change.workoutType === undefined || change.title === undefined || change.durationMin === undefined
        ? 'replace requires workoutType, title and durationMin'
        : null;
    case 'rest':
      return null;
  }
}

/** Applies a validated change to a workout and recomputes its planned load. Pure. */
export function applyProposedChange(
  current: WorkoutFields,
  changeType: ChangeType,
  change: ProposedChange,
): WorkoutFields & { plannedLoad: number } {
  let next: WorkoutFields;
  switch (changeType) {
    case 'rest':
      next = { ...current, workoutType: 'rest', title: change.title ?? 'Rest day', description: change.description ?? null, durationMin: 0, targetZone: null };
      break;
    case 'reduce':
      next = { ...current, durationMin: change.durationMin ?? current.durationMin, description: change.description ?? current.description };
      break;
    case 'move':
      next = { ...current, date: change.date ?? current.date };
      break;
    case 'replace':
      next = {
        date: change.date ?? current.date,
        sport: change.sport ?? current.sport,
        workoutType: change.workoutType ?? current.workoutType,
        title: change.title ?? current.title,
        description: change.description === undefined ? current.description : change.description,
        durationMin: change.durationMin ?? current.durationMin,
        targetZone: change.targetZone === undefined ? null : change.targetZone,
      };
      break;
  }
  return { ...next, plannedLoad: plannedWorkoutLoad(next) };
}
