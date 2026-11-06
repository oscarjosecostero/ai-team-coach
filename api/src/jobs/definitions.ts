import { z } from 'zod';

/** Recompute weekly_metrics for one athlete from a given Monday through the current week. */
export const RECOMPUTE_METRICS = 'metrics.recompute';
export const recomputeMetricsPayload = z.object({
  userId: z.string().uuid(),
  fromWeekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type RecomputeMetricsPayload = z.infer<typeof recomputeMetricsPayload>;

/** Daily sweep: ATL/CTL decay on rest days even when nothing was ingested. */
export const RECOMPUTE_ALL_METRICS = 'metrics.recompute-all';

export const ALL_QUEUES = [RECOMPUTE_METRICS, RECOMPUTE_ALL_METRICS] as const;
