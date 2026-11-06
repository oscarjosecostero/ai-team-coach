import type { Sport } from '../db/schema.js';

/**
 * Source-agnostic activity as produced by an adapter. Adapters never compute load, zones or
 * intensity: the ingestion service does that with the athlete's zones via domain/ functions.
 */
export type ParsedActivity = {
  source: 'seed' | 'file' | 'strava';
  /** Stable id within the source; (source, sourceId) makes ingestion idempotent. */
  sourceId: string;
  sport: Sport;
  startedAt: Date;
  durationS: number;
  movingTimeS?: number;
  distanceM?: number;
  elevationGainM?: number;
  avgHr?: number;
  maxHr?: number;
  avgPowerW?: number;
  /** 1 Hz heart-rate series (preferred for files). */
  hrSamples?: number[];
  /** Pre-aggregated seconds per HR zone (used by synthetic data). */
  timeInZonesS?: [number, number, number, number, number];
  rpe?: number;
  notes?: string;
  raw?: Record<string, unknown>;
};

export class ActivityParseError extends Error {
  override name = 'ActivityParseError';
}

export interface ActivitySource {
  readonly source: ParsedActivity['source'];
  fetchActivities(): Promise<ParsedActivity[]>;
}
