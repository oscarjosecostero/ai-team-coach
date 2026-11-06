import type { AgentActivity, CoachDataPort } from '../ai/ports.js';
import type { Db } from '../db/client.js';
import { toIsoDate } from '../domain/dates.js';
import type { EmbeddingProvider } from '../integrations/embeddings/embedding-provider.js';
import type { Clock } from '../lib/actor.js';
import { activitiesRepo, type ActivityRow } from '../repositories/activities.js';
import { athletesRepo } from '../repositories/athletes.js';
import { checkinsRepo } from '../repositories/checkins.js';
import { plannedWorkoutsRepo } from '../repositories/planned-workouts.js';
import { proposalsRepo } from '../repositories/proposals.js';
import { usersRepo } from '../repositories/users.js';
import { weeklyMetricsRepo } from '../repositories/weekly-metrics.js';
import { createAgentProposal, injurySignalFor } from './agent-proposals.js';
import { searchAthleteNotes } from './notes-search.js';

export type CoachDataDeps = { db: Db; now: Clock; embeddings: EmbeddingProvider | null; log?: (msg: string) => void };

const toAgentActivity = (a: ActivityRow): AgentActivity => ({
  id: a.id,
  date: toIsoDate(a.startedAt),
  sport: a.sport,
  durationS: a.durationS,
  distanceM: a.distanceM,
  avgHr: a.avgHr,
  avgPaceSPerKm: a.avgPaceSPerKm,
  trainingLoad: a.trainingLoad,
  intensityClass: a.intensityClass,
  timeInZonesS: a.timeInZonesS,
  rpe: a.rpe,
  note: a.notes,
});

/**
 * The agent's view of the database, scoped to the athlete id it is called with (the service that
 * starts a run has already authorized the caller for that athlete). Read methods map rows to the
 * slim port types; the only write is `createProposal`.
 */
export function createCoachDataPort(deps: CoachDataDeps): CoachDataPort {
  const { db } = deps;
  const today = () => toIsoDate(deps.now());

  return {
    async getAthlete(athleteId) {
      const [user, profile] = await Promise.all([usersRepo.findById(db, athleteId), athletesRepo.getProfile(db, athleteId)]);
      if (!user || user.role !== 'athlete' || !profile) return null;
      return {
        id: user.id,
        name: user.name,
        profile: {
          goal: profile.goal,
          raceName: profile.raceName,
          raceDate: profile.raceDate,
          raceType: profile.raceType,
          level: profile.level,
          availableDays: profile.availableDays,
          maxHr: profile.maxHr,
          lthr: profile.lthr,
          restingHrBaseline: profile.restingHrBaseline,
          hrZones: profile.hrZones ?? null,
        },
      };
    },

    async listWeeks(athleteId, fromWeekStart, toWeekStart) {
      const rows = await weeklyMetricsRepo.list(db, athleteId, fromWeekStart);
      return rows
        .filter((w) => w.weekStart <= toWeekStart)
        .map((w) => ({
          weekStart: w.weekStart,
          totalDurationS: w.totalDurationS,
          totalDistanceBySport: w.totalDistanceBySport,
          totalLoad: w.totalLoad,
          loadChangePct: w.loadChangePct,
          atl: w.atl,
          ctl: w.ctl,
          tsb: w.tsb,
          acwr: w.acwr,
          lowIntensityPct: w.lowIntensityPct,
          highIntensityPct: w.highIntensityPct,
          hardSessions: w.hardSessions,
          maxConsecutiveHardDays: w.maxConsecutiveHardDays,
          avgRestingHr: w.avgRestingHr,
          restingHrDelta: w.restingHrDelta,
        }));
    },

    async listActivities(athleteId, from, to) {
      const rows = await activitiesRepo.listBetween(db, athleteId, new Date(`${from}T00:00:00Z`), new Date(`${to}T23:59:59.999Z`));
      return rows.map(toAgentActivity);
    },

    async listCheckins(athleteId, from, to) {
      const rows = await checkinsRepo.listRange(db, athleteId, from, to);
      return rows.map((c) => ({ id: c.id, date: c.date, restingHr: c.restingHr, sleepHours: c.sleepHours, fatigue: c.fatigue, soreness: c.soreness, note: c.note }));
    },

    async listPlannedWorkouts(athleteId, from, to) {
      const rows = await plannedWorkoutsRepo.listRange(db, athleteId, from, to);
      return rows.map((w) => ({
        id: w.id,
        date: w.date,
        sport: w.sport,
        workoutType: w.workoutType,
        title: w.title,
        description: w.description,
        durationMin: w.durationMin,
        targetZone: w.targetZone,
        plannedLoad: w.plannedLoad,
        status: w.status,
      }));
    },

    listOpenProposalWorkoutIds: (athleteId) => proposalsRepo.listOpenWorkoutIds(db, athleteId),

    getInjurySignal: (athleteId) => injurySignalFor(db, athleteId, today()),

    async searchNotes(athleteId, query, limit) {
      const { hits, mode } = await searchAthleteNotes({ db, embeddings: deps.embeddings, log: deps.log }, athleteId, query, limit);
      return { mode, hits: hits.map((h) => ({ id: h.id, sourceType: h.sourceType, date: h.date, content: h.content, matchedBy: h.matchedBy })) };
    },

    createProposal: (input) => createAgentProposal({ db, now: deps.now }, input),
  };
}
