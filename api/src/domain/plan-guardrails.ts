export const MAX_WEEKLY_LOAD_CHANGE_PCT = 10;

export type GuardrailInput = {
  workoutOwnerId: string;
  proposerAthleteId: string;
  workoutDate: string; // yyyy-mm-dd
  today: string; // yyyy-mm-dd
  currentWeekPlannedLoad: number;
  proposedWeekPlannedLoad: number;
  changeType: 'replace' | 'reduce' | 'move' | 'rest';
  injurySignal: boolean;
  hasOpenProposalForWorkout: boolean;
};

export type GuardrailResult = { ok: true } | { ok: false; violations: string[] };

export function checkProposalGuardrails(i: GuardrailInput): GuardrailResult {
  const violations: string[] = [];
  if (i.workoutOwnerId !== i.proposerAthleteId) violations.push('workout does not belong to this athlete');
  if (i.workoutDate <= i.today) violations.push('workout must be in the future');
  if (i.hasOpenProposalForWorkout) violations.push('workout already has an open proposal');
  if (i.injurySignal && !['reduce', 'rest'].includes(i.changeType)) {
    violations.push('injury signal: only reduce or rest is allowed (and recommend a professional)');
  }
  if (i.currentWeekPlannedLoad > 0) {
    const pct = ((i.proposedWeekPlannedLoad - i.currentWeekPlannedLoad) / i.currentWeekPlannedLoad) * 100;
    const loadIncrease = pct > MAX_WEEKLY_LOAD_CHANGE_PCT;
    const loadDecreaseTooBig = pct < -MAX_WEEKLY_LOAD_CHANGE_PCT && !i.injurySignal;
    if (loadIncrease || loadDecreaseTooBig) violations.push(`weekly load change ${pct.toFixed(1)}% exceeds ±${MAX_WEEKLY_LOAD_CHANGE_PCT}%`);
  }
  return violations.length ? { ok: false, violations } : { ok: true };
}
