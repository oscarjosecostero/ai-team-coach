import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Recompute weekly_metrics for one athlete from a given Monday through the current week. */
export const RECOMPUTE_METRICS = 'metrics.recompute';
export const recomputeMetricsPayload = z.object({
  userId: z.string().uuid(),
  fromWeekStart: isoDate,
  /** Set for new uploads: ingest -> metrics -> post-activity analysis. */
  thenAnalyze: z.boolean().optional(),
});
export type RecomputeMetricsPayload = z.infer<typeof recomputeMetricsPayload>;

/** Daily sweep: ATL/CTL decay on rest days even when nothing was ingested. */
export const RECOMPUTE_ALL_METRICS = 'metrics.recompute-all';

/** Haiku post-activity check, debounced to one successful run per athlete per day. */
export const ANALYZE_POST_ACTIVITY = 'analysis.post-activity';
export const analyzePostActivityPayload = z.object({ userId: z.string().uuid() });
export type AnalyzePostActivityPayload = z.infer<typeof analyzePostActivityPayload>;

/** Weekly Sonnet review for every athlete (cron). */
export const WEEKLY_REVIEW_ALL = 'analysis.weekly-all';

/** Public demo only (DEMO_DAILY_RESEED=true): replace all data with a fresh seed as of today. */
export const DEMO_RESEED = 'demo.reseed';

export const ALL_QUEUES = [RECOMPUTE_METRICS, RECOMPUTE_ALL_METRICS, ANALYZE_POST_ACTIVITY, WEEKLY_REVIEW_ALL, DEMO_RESEED] as const;
