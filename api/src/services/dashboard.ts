import type { Db } from '../db/client.js';
import { addDays, daysBetween, toIsoDate, weekStartOf } from '../domain/dates.js';
import { plannedLoadByWeek } from '../domain/plan-load.js';
import { sessionShape } from '../domain/session-shape.js';
import type { Actor, Clock } from '../lib/actor.js';
import { activitiesRepo } from '../repositories/activities.js';
import { athletesRepo } from '../repositories/athletes.js';
import { checkinsRepo } from '../repositories/checkins.js';
import { plannedWorkoutsRepo } from '../repositories/planned-workouts.js';
import { proposalsRepo } from '../repositories/proposals.js';
import { weeklyMetricsRepo } from '../repositories/weekly-metrics.js';
import { authorizeAthleteAccess } from './access.js';

/** A planned workout plus its schematic intensity profile (see domain/session-shape.ts). */
const withShape = <W extends { workoutType: string; durationMin: number; targetZone: number | null }>(w: W) => ({ ...w, shape: sessionShape(w) });

/** Everything the dashboard shows is read from stored, backend-computed values. */
export async function getDashboard(deps: { db: Db; now: Clock }, actor: Actor, athleteId: string) {
  const { db } = deps;
  const athlete = await authorizeAthleteAccess(db, actor, athleteId);
  const today = toIsoDate(deps.now());
  const thisWeek = weekStartOf(today);

  const [profile, recent, metrics, upcoming, checkins, open] = await Promise.all([
    athletesRepo.getProfile(db, athlete.id),
    activitiesRepo.listRecent(db, athlete.id, 5),
    weeklyMetricsRepo.list(db, athlete.id, addDays(thisWeek, -7 * 7)),
    plannedWorkoutsRepo.listRange(db, athlete.id, today, addDays(today, 13)),
    checkinsRepo.list(db, athlete.id),
    proposalsRepo.listForUser(db, athlete.id, ['pending']),
  ]);

  return {
    athlete: { id: athlete.id, name: athlete.name },
    profile,
    today,
    daysToRace: profile?.raceDate ? daysBetween(today, profile.raceDate) : null,
    latestActivity: recent[0] ?? null,
    recentActivities: recent,
    currentWeek: metrics.find((m) => m.weekStart === thisWeek) ?? null,
    previousWeek: metrics.find((m) => m.weekStart === addDays(thisWeek, -7)) ?? null,
    weeklyHistory: metrics,
    upcomingWorkouts: upcoming.map(withShape),
    latestCheckin: checkins.at(-1) ?? null,
    pendingProposals: open.length,
  };
}

export async function getCalendar(deps: { db: Db }, actor: Actor, athleteId: string, from: string, to: string) {
  const athlete = await authorizeAthleteAccess(deps.db, actor, athleteId);
  return (await plannedWorkoutsRepo.listRange(deps.db, athlete.id, from, to)).map(withShape);
}

/** Planned load per Monday week, over whole weeks so a range starting mid-week still totals correctly. */
export async function getCalendarWeeks(deps: { db: Db }, actor: Actor, athleteId: string, from: string, to: string) {
  const athlete = await authorizeAthleteAccess(deps.db, actor, athleteId);
  const rows = await plannedWorkoutsRepo.listRange(deps.db, athlete.id, weekStartOf(from), addDays(weekStartOf(to), 6));
  return [...plannedLoadByWeek(rows)].sort(([a], [b]) => a.localeCompare(b)).map(([weekStart, plannedLoad]) => ({ weekStart, plannedLoad }));
}

/** Most recent first; with `from`/`to` (UTC days, inclusive) the activities in that range, oldest first. */
export async function listActivities(deps: { db: Db }, actor: Actor, athleteId: string, q: { limit: number; from?: string; to?: string }) {
  const athlete = await authorizeAthleteAccess(deps.db, actor, athleteId);
  if (q.from && q.to) return activitiesRepo.listBetween(deps.db, athlete.id, new Date(`${q.from}T00:00:00.000Z`), new Date(`${q.to}T23:59:59.999Z`));
  return activitiesRepo.listRecent(deps.db, athlete.id, q.limit);
}
