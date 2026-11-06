import type { CheckinRequest } from '@coach/contracts';
import type { Db } from '../db/client.js';
import { toIsoDate, weekStartOf } from '../domain/dates.js';
import type { Actor, Clock } from '../lib/actor.js';
import { badRequest } from '../lib/errors.js';
import { checkinsRepo } from '../repositories/checkins.js';
import { knowledgeRepo } from '../repositories/knowledge.js';
import type { JobPublisher } from '../jobs/publisher.js';
import { requireAthlete } from './access.js';

export type CheckinDeps = { db: Db; now: Clock; jobs: JobPublisher };

/** An athlete logs their own daily check-in (a second one for the same day replaces the first). */
export async function submitCheckin(deps: CheckinDeps, actor: Actor, req: CheckinRequest) {
  requireAthlete(actor);
  const today = toIsoDate(deps.now());
  const date = req.date ?? today;
  if (date > today) throw badRequest('Check-in date cannot be in the future');

  const row = await checkinsRepo.upsert(deps.db, {
    userId: actor.id,
    date,
    restingHr: req.restingHr ?? null,
    sleepHours: req.sleepHours ?? null,
    fatigue: req.fatigue ?? null,
    soreness: req.soreness ?? null,
    note: req.note ?? null,
  });
  if (row.note) await knowledgeRepo.upsertNote(deps.db, { userId: actor.id, sourceType: 'checkin_note', sourceId: row.id, content: row.note });
  // Resting HR changes the week's trend, so refresh metrics from that week on.
  await deps.jobs.enqueueMetricsRecompute(actor.id, weekStartOf(date));
  return row;
}
