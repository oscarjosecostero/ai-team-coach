import type { PgBoss } from 'pg-boss';
import { RECOMPUTE_METRICS, type RecomputeMetricsPayload } from './definitions.js';

/** Thin port the HTTP layer and services use to schedule background work. */
export interface JobPublisher {
  enqueueMetricsRecompute(userId: string, fromWeekStart: string): Promise<void>;
}

export class PgBossPublisher implements JobPublisher {
  constructor(private readonly boss: PgBoss) {}

  async enqueueMetricsRecompute(userId: string, fromWeekStart: string): Promise<void> {
    const payload: RecomputeMetricsPayload = { userId, fromWeekStart };
    // Bursts of uploads for the same athlete/week collapse into one job.
    await this.boss.send(RECOMPUTE_METRICS, payload, { singletonKey: `${userId}:${fromWeekStart}`, singletonSeconds: 5 });
  }
}
