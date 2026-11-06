import type { Db } from '../db/client.js';
import { toIsoDate, weekStartOf } from '../domain/dates.js';
import { computeActivityMetrics } from '../domain/activity-metrics.js';
import { computeHrZones, type HrZones } from '../domain/zones.js';
import type { ActivitySource, ParsedActivity } from '../integrations/activity-source.js';
import { activitiesRepo } from '../repositories/activities.js';
import { athletesRepo, type AthleteProfile } from '../repositories/athletes.js';
import { knowledgeRepo } from '../repositories/knowledge.js';

export type IngestResult = { created: number; duplicates: number; activityIds: string[]; fromWeekStart: string | null };

export type IngestDeps = {
  db: Db;
  /** Called once per ingest with the earliest affected week (run metrics inline, or enqueue a job). */
  afterIngest?: (userId: string, fromWeekStart: string) => Promise<void>;
};

function zonesFor(profile: AthleteProfile): HrZones | null {
  if (profile.hrZones) return profile.hrZones;
  try {
    return computeHrZones({ lthr: profile.lthr, maxHr: profile.maxHr });
  } catch {
    return null;
  }
}

/** Enrich with backend-computed metrics (zones, load, intensity) and store, idempotently. */
export async function ingestActivities(deps: IngestDeps, userId: string, source: ActivitySource): Promise<IngestResult> {
  const profile = await athletesRepo.getProfile(deps.db, userId);
  if (!profile) throw new Error(`No athlete profile for user ${userId}`);
  const zones = zonesFor(profile);
  const parsed: ParsedActivity[] = await source.fetchActivities();

  const result: IngestResult = { created: 0, duplicates: 0, activityIds: [], fromWeekStart: null };

  await deps.db.transaction(async (tx) => {
    for (const p of parsed) {
      const m = computeActivityMetrics({ ...p, zones, timeInZonesS: p.timeInZonesS ?? null });
      const { row, created } = await activitiesRepo.insertIfNew(tx, {
        userId,
        source: p.source,
        sourceId: p.sourceId,
        sport: p.sport,
        startedAt: p.startedAt,
        durationS: p.durationS,
        movingTimeS: p.movingTimeS,
        distanceM: p.distanceM,
        elevationGainM: p.elevationGainM,
        avgHr: p.avgHr,
        maxHr: p.maxHr,
        avgPaceSPerKm: m.avgPaceSPerKm,
        avgPowerW: p.avgPowerW,
        timeInZonesS: m.timeInZonesS ? [...m.timeInZonesS] : null,
        trainingLoad: m.trainingLoad,
        loadMethod: m.loadMethod,
        intensityClass: m.intensityClass,
        rpe: p.rpe,
        notes: p.notes,
        raw: p.raw,
      });
      result.activityIds.push(row.id);
      if (!created) {
        result.duplicates++;
        continue;
      }
      result.created++;
      if (p.notes) await knowledgeRepo.upsertNote(tx, { userId, sourceType: 'activity_note', sourceId: row.id, content: p.notes });
      const week = weekStartOf(toIsoDate(p.startedAt));
      if (!result.fromWeekStart || week < result.fromWeekStart) result.fromWeekStart = week;
    }
  });

  if (result.fromWeekStart && deps.afterIngest) await deps.afterIngest(userId, result.fromWeekStart);
  return result;
}
