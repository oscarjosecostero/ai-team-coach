import type { Db } from '../db/client.js';
import { addDays, toIsoDate, weekStartOf } from '../domain/dates.js';
import type { TimeInZones } from '../domain/load.js';
import { summarizeWeek, type SummaryActivity } from '../domain/weekly-summary.js';
import { activitiesRepo, type ActivityRow } from '../repositories/activities.js';
import { athletesRepo } from '../repositories/athletes.js';
import { checkinsRepo } from '../repositories/checkins.js';
import { weeklyMetricsRepo } from '../repositories/weekly-metrics.js';

export function toSummaryActivity(a: ActivityRow): SummaryActivity {
  const zones = a.timeInZonesS?.length === 5 ? (a.timeInZonesS as unknown as TimeInZones) : null;
  return {
    date: toIsoDate(a.startedAt),
    sport: a.sport,
    durationS: a.durationS,
    distanceM: a.distanceM,
    trainingLoad: a.trainingLoad,
    timeInZonesS: zones,
    intensityClass: a.intensityClass,
  };
}

/**
 * Recomputes weekly_metrics for every week from `fromWeekStart` through the week containing `asOf`.
 * ATL/CTL and load_change_pct cascade forward, so a new or late activity invalidates all later weeks.
 */
export async function recomputeWeeklyMetrics(db: Db, userId: string, fromWeekStart: string, asOf: string): Promise<number> {
  const profile = await athletesRepo.getProfile(db, userId);
  if (!profile) throw new Error(`No athlete profile for user ${userId}`);

  const lastWeek = weekStartOf(asOf);
  const history = (await activitiesRepo.listUpTo(db, userId, new Date(`${addDays(lastWeek, 6)}T23:59:59.999Z`))).map(toSummaryActivity);
  const checkins = (await checkinsRepo.list(db, userId)).map((c) => ({ date: c.date, restingHr: c.restingHr }));

  let count = 0;
  for (let week = weekStartOf(fromWeekStart); week <= lastWeek; week = addDays(week, 7)) {
    const s = summarizeWeek({ weekStart: week, activities: history, checkins, restingHrBaseline: profile.restingHrBaseline, asOf });
    await weeklyMetricsRepo.upsert(db, { userId, ...s });
    count++;
  }
  return count;
}
