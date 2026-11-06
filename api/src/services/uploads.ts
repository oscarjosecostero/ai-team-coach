import type { Db } from '../db/client.js';
import type { ParsedActivity } from '../integrations/activity-source.js';
import { FileActivitySource } from '../integrations/files/file-source.js';
import type { JobPublisher } from '../jobs/publisher.js';
import type { Actor } from '../lib/actor.js';
import { requireAthlete } from './access.js';
import { ingestActivities } from './ingestion.js';

/** Parse + store synchronously (so the user gets an answer), recompute metrics in the background. */
export async function uploadActivityFile(
  deps: { db: Db; jobs: JobPublisher },
  actor: Actor,
  file: { name: string; content: Buffer },
  sport?: ParsedActivity['sport'],
) {
  requireAthlete(actor);
  return ingestActivities(
    { db: deps.db, afterIngest: (userId, fromWeek) => deps.jobs.enqueueMetricsRecompute(userId, fromWeek) },
    actor.id,
    new FileActivitySource(file, sport),
  );
}
