import type { Db } from '../db/client.js';
import { addDays, toIsoDate, weekStartOf } from '../domain/dates.js';
import type { Actor, Clock } from '../lib/actor.js';
import { activitiesRepo } from '../repositories/activities.js';
import { athletesRepo } from '../repositories/athletes.js';
import { checkinsRepo } from '../repositories/checkins.js';
import { plannedWorkoutsRepo } from '../repositories/planned-workouts.js';
import { proposalsRepo } from '../repositories/proposals.js';
import { weeklyMetricsRepo } from '../repositories/weekly-metrics.js';
import { authorizeAthleteAccess } from './access.js';

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
    latestActivity: recent[0] ?? null,
    recentActivities: recent,
    currentWeek: metrics.find((m) => m.weekStart === thisWeek) ?? null,
    previousWeek: metrics.find((m) => m.weekStart === addDays(thisWeek, -7)) ?? null,
    weeklyHistory: metrics,
    upcomingWorkouts: upcoming,
    latestCheckin: checkins.at(-1) ?? null,
    pendingProposals: open.length,
  };
}

export async function getCalendar(deps: { db: Db }, actor: Actor, athleteId: string, from: string, to: string) {
  const athlete = await authorizeAthleteAccess(deps.db, actor, athleteId);
  return plannedWorkoutsRepo.listRange(deps.db, athlete.id, from, to);
}

export async function listActivities(deps: { db: Db }, actor: Actor, athleteId: string, limit: number) {
  const athlete = await authorizeAthleteAccess(deps.db, actor, athleteId);
  return activitiesRepo.listRecent(deps.db, athlete.id, limit);
}
