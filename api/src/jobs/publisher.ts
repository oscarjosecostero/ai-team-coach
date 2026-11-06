import type { PgBoss } from 'pg-boss';
import { ANALYZE_POST_ACTIVITY, RECOMPUTE_METRICS, type AnalyzePostActivityPayload, type RecomputeMetricsPayload } from './definitions.js';

/** Thin port the HTTP layer and services use to schedule background work. */
export interface JobPublisher {
  enqueueMetricsRecompute(userId: string, fromWeekStart: string, opts?: { thenAnalyze?: boolean }): Promise<void>;
  enqueuePostActivityAnalysis(userId: string): Promise<void>;
}

export class PgBossPublisher implements JobPublisher {
  constructor(private readonly boss: PgBoss) {}

  async enqueueMetricsRecompute(userId: string, fromWeekStart: string, opts: { thenAnalyze?: boolean } = {}): Promise<void> {
    const payload: RecomputeMetricsPayload = { userId, fromWeekStart, ...(opts.thenAnalyze ? { thenAnalyze: true } : {}) };
    // Bursts of uploads for the same athlete/week collapse into one job.
    await this.boss.send(RECOMPUTE_METRICS, payload, { singletonKey: `${userId}:${fromWeekStart}:${opts.thenAnalyze ? 'a' : '-'}`, singletonSeconds: 5 });
  }

  async enqueuePostActivityAnalysis(userId: string): Promise<void> {
    const payload: AnalyzePostActivityPayload = { userId };
    // Collapses bursts; the handler also skips if today's analysis already succeeded.
    await this.boss.send(ANALYZE_POST_ACTIVITY, payload, { singletonKey: userId, singletonSeconds: 60, retryLimit: 2, retryDelay: 30, retryBackoff: true });
  }
}
