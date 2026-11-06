import type { Db } from '../db/client.js';
import { computeHrZones } from '../domain/zones.js';
import { plannedWorkoutLoad } from '../domain/load.js';
import { SeedActivitySource } from '../integrations/seed/seed-source.js';
import { buildScenario } from '../integrations/seed/scenario.js';
import { hashPassword } from '../lib/password.js';
import { athletesRepo } from '../repositories/athletes.js';
import { checkinsRepo } from '../repositories/checkins.js';
import { knowledgeRepo } from '../repositories/knowledge.js';
import { plannedWorkoutsRepo } from '../repositories/planned-workouts.js';
import { ingestActivities } from './ingestion.js';
import { recomputeWeeklyMetrics } from './metrics.js';

export type SeededUser = { id: string; name: string; email: string; role: 'athlete' | 'coach' };
export type SeedResult = { teamId: string; coach: SeededUser; athletes: SeededUser[] };

/**
 * Loads the synthetic team through the same ingestion and metrics path real data uses.
 * Assumes an empty database (the CLI resets first when asked to).
 */
export async function seedDemoTeam(db: Db, opts: { today: string; password: string }): Promise<SeedResult> {
  const scenario = buildScenario(opts.today);
  const passwordHash = await hashPassword(opts.password);

  const team = await athletesRepo.createTeam(db, { name: scenario.team.name, coachReviewEnabled: scenario.team.coachReviewEnabled });
  const coachRow = await athletesRepo.createUser(db, { teamId: team.id, role: 'coach', name: scenario.coach.name, email: scenario.coach.email, passwordHash });
  const result: SeedResult = { teamId: team.id, coach: { id: coachRow.id, name: coachRow.name, email: coachRow.email, role: 'coach' }, athletes: [] };

  for (const a of scenario.athletes) {
    const user = await athletesRepo.createUser(db, { teamId: team.id, role: 'athlete', name: a.name, email: a.email, passwordHash });
    await athletesRepo.createProfile(db, {
      userId: user.id,
      ...a.profile,
      hrZones: computeHrZones({ lthr: a.profile.lthr, maxHr: a.profile.maxHr }),
    });

    for (const c of a.checkins) {
      const row = await checkinsRepo.upsert(db, { userId: user.id, date: c.date, restingHr: c.restingHr, sleepHours: c.sleepHours, fatigue: c.fatigue, soreness: c.soreness, note: c.note });
      if (c.note) await knowledgeRepo.upsertNote(db, { userId: user.id, sourceType: 'checkin_note', sourceId: row.id, content: c.note });
    }

    await plannedWorkoutsRepo.insertMany(
      db,
      a.plan.map((p) => ({
        userId: user.id,
        date: p.date,
        sport: p.sport,
        workoutType: p.workoutType,
        title: p.title,
        description: p.description,
        durationMin: p.durationMin,
        plannedLoad: plannedWorkoutLoad({ durationMin: p.durationMin, workoutType: p.workoutType, sport: p.sport }),
        origin: 'seed' as const,
      })),
    );

    await ingestActivities(
      { db, afterIngest: async (userId, fromWeek) => void (await recomputeWeeklyMetrics(db, userId, fromWeek, opts.today)) },
      user.id,
      new SeedActivitySource(a.activities),
    );
    result.athletes.push({ id: user.id, name: user.name, email: user.email, role: 'athlete' });
  }
  return result;
}
