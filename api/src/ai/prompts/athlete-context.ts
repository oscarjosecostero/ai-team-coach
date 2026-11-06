import type { AgentAthlete } from '../ports.js';

const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Per-athlete part of the system prompt: goal, race, zones, thresholds, level, available days.
 * Deterministic (no timestamps, stable ordering) so it caches per athlete; the date is the last
 * line because it is the only part that changes daily.
 */
export function buildAthleteContext(a: AgentAthlete, today: string): string {
  const p = a.profile;
  const z = p.hrZones;
  const lines = [
    '## Athlete',
    `Name: ${a.name}`,
    `Level: ${p.level}`,
    `Goal: ${p.goal}`,
    p.raceName ? `Goal race: ${p.raceName}${p.raceType ? ` (${p.raceType})` : ''}${p.raceDate ? ` on ${p.raceDate}` : ''}` : 'Goal race: none set',
    `Available training days: ${p.availableDays.length ? p.availableDays.map((d) => DAY_NAMES[d]).join(', ') : 'not set'}`,
    `Lactate threshold HR: ${p.lthr ?? 'unknown'} bpm · Max HR: ${p.maxHr ?? 'unknown'} bpm · Resting HR baseline: ${p.restingHrBaseline ?? 'unknown'} bpm`,
    z ? `HR zones (bpm): Z1 ≤${z.z1Max}, Z2 ≤${z.z2Max}, Z3 ≤${z.z3Max}, Z4 ≤${z.z4Max}, Z5 >${z.z4Max}` : 'HR zones: unknown',
    'Training load unit: TRIMP (minutes weighted by HR zone). Weeks start on Monday.',
    '',
    `Today is ${today}.`,
  ];
  return lines.join('\n');
}
