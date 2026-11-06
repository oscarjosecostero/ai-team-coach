import type { Fact } from '@coach/contracts';
import { addDays, daysBetween, weekStartOf } from '../../domain/dates.js';
import { plannedLoadByWeek } from '../../domain/plan-load.js';
import { MAX_WEEKLY_LOAD_CHANGE_PCT } from '../../domain/plan-guardrails.js';
import { factIds } from '../facts.js';
import type { AgentActivity, AgentCheckin, AgentWeek } from '../ports.js';
import { getCalendarInput, getHistoryInput, getWeekSummaryInput, searchNotesInput } from '../schemas/tool-inputs.js';
import { defineTool, ToolInputError, type ToolContext } from './types.js';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekday = (iso: string) => WEEKDAY[new Date(`${iso}T00:00:00Z`).getUTCDay()]!;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Formatting is a backend job too: the model gets "5:12", never seconds to convert. */
export function formatPace(sPerKm: number): string {
  const m = Math.floor(sPerKm / 60);
  const s = Math.round(sPerKm - m * 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`;
}

function weekFacts(w: AgentWeek, compact = false): Fact[] {
  const id = (m: string) => factIds.week(w.weekStart, m);
  const facts: Fact[] = [
    { id: id('total_load'), label: 'Training load', value: r1(w.totalLoad), unit: 'TRIMP' },
    { id: id('load_change_pct'), label: 'Load change vs previous week', value: w.loadChangePct === null ? null : r1(w.loadChangePct), unit: '%' },
    { id: id('total_duration_min'), label: 'Training time', value: Math.round(w.totalDurationS / 60), unit: 'min' },
    { id: id('ctl'), label: 'Fitness (CTL, 42-day)', value: w.ctl },
    { id: id('atl'), label: 'Fatigue (ATL, 7-day)', value: w.atl },
    { id: id('acwr'), label: 'Acute:chronic load ratio', value: w.acwr },
    { id: id('high_intensity_pct'), label: 'Time at high intensity (Z3-Z5)', value: w.highIntensityPct, unit: '%' },
    { id: id('hard_sessions'), label: 'Hard sessions', value: w.hardSessions },
    { id: id('avg_resting_hr'), label: 'Average resting HR', value: w.avgRestingHr === null ? null : r1(w.avgRestingHr), unit: 'bpm' },
  ];
  if (compact) return facts;
  return [
    ...facts,
    { id: id('tsb'), label: 'Form (TSB = CTL - ATL)', value: w.tsb },
    { id: id('low_intensity_pct'), label: 'Time at low intensity (Z1-Z2)', value: w.lowIntensityPct, unit: '%' },
    { id: id('max_consecutive_hard_days'), label: 'Most consecutive hard days', value: w.maxConsecutiveHardDays, unit: 'days' },
    { id: id('resting_hr_delta'), label: 'Resting HR vs baseline', value: w.restingHrDelta === null ? null : r1(w.restingHrDelta), unit: 'bpm' },
    ...Object.entries(w.totalDistanceBySport)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([sport, m]): Fact => ({ id: id(`distance_${sport}_km`), label: `Distance (${sport})`, value: r1(m / 1000), unit: 'km' })),
  ];
}

function activityItem(a: AgentActivity) {
  const id = (m: string) => factIds.activity(a.id, m);
  const facts: Fact[] = [
    { id: id('duration_min'), label: `${a.sport} duration`, value: Math.round(a.durationS / 60), unit: 'min' },
    { id: id('training_load'), label: `${a.sport} training load`, value: a.trainingLoad, unit: 'TRIMP' },
    { id: id('intensity'), label: `${a.sport} intensity`, value: a.intensityClass },
  ];
  if (a.distanceM) facts.push({ id: id('distance_km'), label: `${a.sport} distance`, value: r1(a.distanceM / 1000), unit: 'km' });
  if (a.avgHr) facts.push({ id: id('avg_hr'), label: `${a.sport} average HR`, value: a.avgHr, unit: 'bpm' });
  if (a.avgPaceSPerKm && a.sport === 'run') facts.push({ id: id('avg_pace'), label: 'Run average pace', value: formatPace(a.avgPaceSPerKm), unit: 'min/km' });
  if (a.rpe) facts.push({ id: id('rpe'), label: `${a.sport} perceived effort`, value: a.rpe, unit: '/10' });
  if (a.note) facts.push({ id: id('note'), label: `${a.sport} note`, value: a.note });
  return { date: a.date, weekday: weekday(a.date), sport: a.sport, facts };
}

function checkinItem(c: AgentCheckin) {
  const id = (m: string) => factIds.checkin(c.date, m);
  const facts: Fact[] = [];
  if (c.restingHr !== null) facts.push({ id: id('resting_hr'), label: 'Resting HR', value: c.restingHr, unit: 'bpm' });
  if (c.sleepHours !== null) facts.push({ id: id('sleep_hours'), label: 'Sleep', value: c.sleepHours, unit: 'h' });
  if (c.fatigue !== null) facts.push({ id: id('fatigue'), label: 'Fatigue', value: c.fatigue, unit: '/5' });
  if (c.soreness !== null) facts.push({ id: id('soreness'), label: 'Soreness', value: c.soreness, unit: '/5' });
  if (c.note) facts.push({ id: id('note'), label: 'Check-in note', value: c.note });
  return { date: c.date, facts };
}

/** Registers every fact of a tool result in the run's ledger, so they become citable. */
function register<T>(ctx: ToolContext, value: T): T {
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    const rec = node as Record<string, unknown>;
    if (Array.isArray(rec.facts)) ctx.ledger.addAll(rec.facts as Fact[]);
    Object.values(rec).forEach(walk);
  };
  walk(value);
  return value;
}

export const getWeekSummary = defineTool({
  name: 'get_week_summary',
  description:
    'Backend-computed metrics for one training week (load, load change, CTL/ATL/TSB, ACWR, intensity split, hard sessions, resting HR trend), the activities and daily check-ins of that week, the race countdown and the backend injury signal. Call this first in every analysis, and whenever the athlete asks how their training is going.',
  input: getWeekSummaryInput,
  writes: false,
  async run(ctx, input) {
    const week = weekStartOf(input.weekStart ?? ctx.today);
    if (week > weekStartOf(ctx.today)) throw new ToolInputError('weekStart is in the future; there is no data yet.');
    const prev = addDays(week, -7);
    const weekEnd = addDays(week, 6) < ctx.today ? addDays(week, 6) : ctx.today;
    const [weeks, activities, checkins, athlete, injury] = await Promise.all([
      ctx.data.listWeeks(ctx.athleteId, prev, week),
      ctx.data.listActivities(ctx.athleteId, week, weekEnd),
      ctx.data.listCheckins(ctx.athleteId, addDays(weekEnd, -6), weekEnd),
      ctx.data.getAthlete(ctx.athleteId),
      ctx.data.getInjurySignal(ctx.athleteId),
    ]);
    const current = weeks.find((w) => w.weekStart === week);
    const previous = weeks.find((w) => w.weekStart === prev);
    const raceDate = athlete?.profile.raceDate ?? null;

    return register(ctx, {
      week,
      isCurrentWeek: week === weekStartOf(ctx.today),
      daysCovered: daysBetween(week, weekEnd) + 1,
      thisWeek: current ? { facts: weekFacts(current) } : { facts: [], note: 'No metrics computed for this week yet.' },
      previousWeek: previous ? { weekStart: prev, facts: weekFacts(previous, true) } : null,
      activities: activities.map(activityItem),
      checkinsLast7Days: checkins.map(checkinItem),
      signals: {
        facts: [
          ...(raceDate ? [{ id: factIds.profile('days_to_race'), label: `Days to ${athlete?.profile.raceName ?? 'race'}`, value: daysBetween(ctx.today, raceDate), unit: 'days' }] : []),
          {
            id: factIds.signal('injury'),
            label: 'Backend injury signal (last 7 days)',
            value: injury.flag ? `detected: ${injury.reasons.join('; ')}` : 'none',
          },
        ],
      },
    });
  },
});

export const getHistory = defineTool({
  name: 'get_history',
  description:
    'Week-by-week trend of the main metrics (load, load change, CTL, ATL, ACWR, high-intensity share, hard sessions, resting HR) for the last N weeks. Call this to judge whether a spike or a drop is unusual for this athlete, and for readiness questions.',
  input: getHistoryInput,
  writes: false,
  async run(ctx, input) {
    const to = weekStartOf(ctx.today);
    const from = addDays(to, -7 * (input.weeks - 1));
    const weeks = await ctx.data.listWeeks(ctx.athleteId, from, to);
    return register(ctx, { weeks: weeks.map((w) => ({ weekStart: w.weekStart, facts: weekFacts(w, true) })) });
  },
});

export const getCalendar = defineTool({
  name: 'get_calendar',
  description:
    'Upcoming planned workouts (default: tomorrow to 14 days ahead) with their workoutId, planned load and whether a proposal is already open, plus the planned load of each week and the range it may move within under the ±10% rule. Call this before create_proposal: you can only propose changes to workouts listed here.',
  input: getCalendarInput,
  writes: false,
  async run(ctx, input) {
    const from = input.from ?? addDays(ctx.today, 1);
    const to = input.to ?? addDays(ctx.today, 14);
    if (to < from) throw new ToolInputError('`to` is before `from`.');
    if (daysBetween(from, to) > 28) throw new ToolInputError('Range too long: at most 28 days.');

    // Weekly totals need the whole week, even when the range starts mid-week.
    const [workouts, open] = await Promise.all([
      ctx.data.listPlannedWorkouts(ctx.athleteId, weekStartOf(from), addDays(weekStartOf(to), 6)),
      ctx.data.listOpenProposalWorkoutIds(ctx.athleteId),
    ]);
    const openSet = new Set(open);
    const totals = plannedLoadByWeek(workouts);
    const f = MAX_WEEKLY_LOAD_CHANGE_PCT / 100;

    const listed = workouts.filter((w) => w.date >= from && w.date <= to);
    for (const w of listed) ctx.ledger.seeWorkout(w.id);

    return register(ctx, {
      today: ctx.today,
      workouts: listed.map((w) => ({
        workoutId: w.id,
        date: w.date,
        weekday: weekday(w.date),
        sport: w.sport,
        workoutType: w.workoutType,
        title: w.title,
        durationMin: w.durationMin,
        targetZone: w.targetZone,
        status: w.status,
        isFuture: w.date > ctx.today,
        hasOpenProposal: openSet.has(w.id),
        facts: [{ id: factIds.workout(w.id, 'planned_load'), label: `Planned load: ${w.title} (${w.date})`, value: w.plannedLoad, unit: 'TRIMP' }],
      })),
      plannedWeeks: [...totals.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([weekStart, load]) => ({
          weekStart,
          facts: [
            { id: factIds.planWeek(weekStart, 'planned_load'), label: `Planned load, week of ${weekStart}`, value: load, unit: 'TRIMP' },
            { id: factIds.planWeek(weekStart, 'allowed_min'), label: `Lowest planned load allowed (−${MAX_WEEKLY_LOAD_CHANGE_PCT}%), week of ${weekStart}`, value: r1(load * (1 - f)), unit: 'TRIMP' },
            { id: factIds.planWeek(weekStart, 'allowed_max'), label: `Highest planned load allowed (+${MAX_WEEKLY_LOAD_CHANGE_PCT}%), week of ${weekStart}`, value: r1(load * (1 + f)), unit: 'TRIMP' },
          ],
        })),
    });
  },
});

export const searchNotes = defineTool({
  name: 'search_notes',
  description:
    "Searches the athlete's own free-text notes (activity notes and daily check-in notes) by meaning and by keywords. Call this when you need the athlete's own words: how a session felt, sleep, stress, niggles or pain.",
  input: searchNotesInput,
  writes: false,
  async run(ctx, input) {
    const { hits, mode } = await ctx.data.searchNotes(ctx.athleteId, input.query, input.limit);
    return register(ctx, {
      mode,
      results: hits.map((h) => ({
        date: h.date,
        kind: h.sourceType === 'activity_note' ? 'activity note' : 'check-in note',
        facts: [{ id: factIds.note(h.id), label: `${h.sourceType === 'activity_note' ? 'Activity' : 'Check-in'} note (${h.date})`, value: h.content }],
      })),
    });
  },
});
