import { addDays, daysBetween, eachDay, weekStartOf } from './dates.js';
import { acwr, fitnessMetrics } from './fitness.js';
import { intensitySplit, maxConsecutiveHardDays, type IntensityClass } from './intensity.js';
import type { TimeInZones } from './load.js';

export type SummaryActivity = {
  date: string; // yyyy-mm-dd
  sport: string;
  durationS: number;
  distanceM: number | null;
  trainingLoad: number | null;
  timeInZonesS: TimeInZones | null;
  intensityClass: IntensityClass | null;
};

export type SummaryCheckin = { date: string; restingHr: number | null };

export type WeeklySummary = {
  weekStart: string;
  totalDurationS: number;
  totalDistanceBySport: Record<string, number>;
  totalLoad: number;
  loadChangePct: number | null;
  atl: number;
  ctl: number;
  tsb: number;
  acwr: number | null;
  lowIntensityPct: number;
  highIntensityPct: number;
  hardSessions: number;
  maxConsecutiveHardDays: number;
  avgRestingHr: number | null;
  restingHrDelta: number | null;
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function dailyLoadSeries(activities: SummaryActivity[], from: string, to: string): number[] {
  const byDay = new Map<string, number>();
  for (const a of activities) byDay.set(a.date, (byDay.get(a.date) ?? 0) + (a.trainingLoad ?? 0));
  return eachDay(from, to).map((d) => byDay.get(d) ?? 0);
}

/**
 * Metrics for the week starting `weekStart` (Monday). `activities` must contain the athlete's full
 * history up to the week end (older data feeds ATL/CTL). When `asOf` falls inside the week the
 * fitness series stops there, so the current week is never padded with future zero-load days.
 */
export function summarizeWeek(input: {
  weekStart: string;
  activities: SummaryActivity[];
  checkins: SummaryCheckin[];
  restingHrBaseline: number | null;
  asOf?: string;
}): WeeklySummary {
  const { weekStart, activities, checkins, restingHrBaseline } = input;
  const weekEnd = addDays(weekStart, 6);
  const seriesEnd = input.asOf && input.asOf < weekEnd ? input.asOf : weekEnd;

  const inWeek = activities.filter((a) => a.date >= weekStart && a.date <= weekEnd);
  const prevStart = addDays(weekStart, -7);
  // Like-for-like: a partial current week is compared with the same number of days of the previous week.
  const prevEnd = addDays(prevStart, daysBetween(weekStart, seriesEnd));
  const inPrevWindow = activities.filter((a) => a.date >= prevStart && a.date <= prevEnd);
  const prevLoad = sum(inPrevWindow.map((a) => a.trainingLoad ?? 0));
  const totalLoad = round1(sum(inWeek.map((a) => a.trainingLoad ?? 0)));

  const firstDay = activities.reduce((min, a) => (a.date < min ? a.date : min), seriesEnd);
  const series = dailyLoadSeries(activities.filter((a) => a.date <= seriesEnd), firstDay, seriesEnd);
  const fitness = fitnessMetrics(series);

  const distanceBySport: Record<string, number> = {};
  for (const a of inWeek) distanceBySport[a.sport] = round1((distanceBySport[a.sport] ?? 0) + (a.distanceM ?? 0));

  const zoneTotals = [0, 0, 0, 0, 0];
  for (const a of inWeek) a.timeInZonesS?.forEach((s, i) => (zoneTotals[i]! += s));
  const split = intensitySplit(zoneTotals as unknown as TimeInZones);

  const hardDates = inWeek.filter((a) => a.intensityClass === 'hard').map((a) => a.date);
  // Streaks are measured over the 7 days ending at the series end, so a run that crosses Monday still counts.
  const streakFrom = addDays(seriesEnd, -6);
  const trailingHardDates = activities.filter((a) => a.intensityClass === 'hard' && a.date >= streakFrom && a.date <= seriesEnd).map((a) => a.date);

  const rhr = checkins.filter((c) => c.date >= weekStart && c.date <= weekEnd && c.restingHr != null).map((c) => c.restingHr!);
  const avgRestingHr = rhr.length ? round1(sum(rhr) / rhr.length) : null;

  return {
    weekStart,
    totalDurationS: sum(inWeek.map((a) => a.durationS)),
    totalDistanceBySport: distanceBySport,
    totalLoad,
    loadChangePct: prevLoad > 0 ? round1(((totalLoad - prevLoad) / prevLoad) * 100) : null,
    ...fitness,
    acwr: acwr(series),
    lowIntensityPct: split.lowPct,
    highIntensityPct: split.highPct,
    hardSessions: hardDates.length,
    maxConsecutiveHardDays: maxConsecutiveHardDays(trailingHardDates),
    avgRestingHr,
    restingHrDelta: avgRestingHr != null && restingHrBaseline != null ? round1(avgRestingHr - restingHrBaseline) : null,
  };
}

export { weekStartOf };
