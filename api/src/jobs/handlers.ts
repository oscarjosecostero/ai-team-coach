import type { LlmClient } from '../ai/llm-client.js';
import type { Db } from '../db/client.js';
import { addDays, toIsoDate, weekStartOf } from '../domain/dates.js';
import type { EmbeddingProvider } from '../integrations/embeddings/embedding-provider.js';
import { agentRunsRepo } from '../repositories/agent-runs.js';
import { athletesRepo } from '../repositories/athletes.js';
import { runAnalysis, type AnalysisResult } from '../services/analysis.js';
import { recomputeWeeklyMetrics } from '../services/metrics.js';
import { analyzePostActivityPayload, recomputeMetricsPayload } from './definitions.js';
import type { JobPublisher } from './publisher.js';

export type JobDeps = {
  db: Db;
  now?: () => Date;
  llm?: LlmClient | null;
  embeddings?: EmbeddingProvider | null;
  publisher?: Pick<JobPublisher, 'enqueuePostActivityAnalysis'>;
  log?: (msg: string) => void;
};
const clock = (deps: JobDeps) => deps.now ?? (() => new Date());
const today = (deps: JobDeps) => toIsoDate(clock(deps)());
const aiDeps = (deps: JobDeps) => ({ db: deps.db, now: clock(deps), llm: deps.llm ?? null, embeddings: deps.embeddings ?? null, log: deps.log });

/** Thrown so pg-boss retries the job (rate limits, overload, network). */
export class RetryableJobError extends Error {}

/** Validates the (untrusted, queue-delivered) payload, then recomputes. Throws so pg-boss retries. */
export async function handleRecomputeMetrics(deps: JobDeps, data: unknown): Promise<{ weeks: number }> {
  const { userId, fromWeekStart, thenAnalyze } = recomputeMetricsPayload.parse(data);
  const weeks = await recomputeWeeklyMetrics(deps.db, userId, fromWeekStart, today(deps));
  // The analysis must see fresh metrics, so it is chained after the recompute, never in parallel.
  if (thenAnalyze && deps.publisher) await deps.publisher.enqueuePostActivityAnalysis(userId);
  return { weeks };
}

export async function handleRecomputeAll(deps: JobDeps): Promise<{ athletes: number }> {
  const asOf = today(deps);
  const from = addDays(weekStartOf(asOf), -7);
  const ids = await athletesRepo.listAthleteIds(deps.db);
  for (const id of ids) await recomputeWeeklyMetrics(deps.db, id, from, asOf);
  return { athletes: ids.length };
}

export async function handlePostActivityAnalysis(
  deps: JobDeps,
  data: unknown,
): Promise<{ skipped: 'no_llm' | 'already_analyzed_today' } | { status: AnalysisResult['status']; runId: string; proposals: number }> {
  const { userId } = analyzePostActivityPayload.parse(data);
  if (!deps.llm) return { skipped: 'no_llm' };
  const startOfDay = new Date(`${today(deps)}T00:00:00Z`);
  if (await agentRunsRepo.hasSucceededSince(deps.db, userId, 'post_activity', startOfDay)) return { skipped: 'already_analyzed_today' };

  const r = await runAnalysis(aiDeps(deps), { athleteId: userId, kind: 'post_activity', trigger: 'activity_ingested' });
  if (r.status === 'failed' && /^(llm_error|empty_reply)/.test(r.error ?? '')) throw new RetryableJobError(r.error ?? 'analysis failed');
  return { status: r.status, runId: r.runId, proposals: r.proposals.length };
}

/** Weekly review for every athlete. One athlete failing does not stop the others. */
export async function handleWeeklyReviewAll(deps: JobDeps): Promise<{ succeeded: number; failed: number; skipped?: 'no_llm' }> {
  if (!deps.llm) return { succeeded: 0, failed: 0, skipped: 'no_llm' };
  let succeeded = 0;
  let failed = 0;
  for (const id of await athletesRepo.listAthleteIds(deps.db)) {
    try {
      const r = await runAnalysis(aiDeps(deps), { athleteId: id, kind: 'weekly', trigger: 'cron:weekly' });
      if (r.status === 'succeeded') succeeded++;
      else failed++;
    } catch (err) {
      failed++;
      deps.log?.(`weekly review failed for ${id}: ${(err as Error).message}`);
    }
  }
  return { succeeded, failed };
}
