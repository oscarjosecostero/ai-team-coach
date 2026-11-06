import { classifyIntensity, type IntensityClass } from './intensity.js';
import { durationEstimateLoad, edwardsTrimp, type TimeInZones } from './load.js';
import { timeInZones, type HrZones } from './zones.js';

export type ActivityMetricsInput = {
  sport: string;
  durationS: number;
  movingTimeS?: number | null;
  distanceM?: number | null;
  hrSamples?: number[] | null;
  timeInZonesS?: TimeInZones | null;
  rpe?: number | null;
  zones: HrZones | null;
};

export type ActivityMetrics = {
  timeInZonesS: TimeInZones | null;
  trainingLoad: number;
  loadMethod: 'hr_trimp' | 'duration_estimate';
  intensityClass: IntensityClass;
  avgPaceSPerKm: number | null;
};

/** RPE-based class used when there is no heart-rate data. */
function intensityFromRpe(rpe?: number | null): IntensityClass {
  if (!rpe) return 'moderate';
  return rpe >= 7 ? 'hard' : rpe >= 5 ? 'moderate' : 'easy';
}

/**
 * Everything the backend derives from one activity. HR data (samples or pre-aggregated zones) gives
 * Edwards TRIMP; otherwise load falls back to duration x sport x intensity so every activity has a load.
 */
export function computeActivityMetrics(input: ActivityMetricsInput): ActivityMetrics {
  let zoneSeconds: TimeInZones | null = input.timeInZonesS ?? null;
  if (!zoneSeconds && input.hrSamples?.length && input.zones) zoneSeconds = timeInZones(input.hrSamples, input.zones);
  const hasHr = zoneSeconds !== null && zoneSeconds.some((s) => s > 0);

  const movingS = input.movingTimeS ?? input.durationS;
  const paceable = input.sport === 'run' || input.sport === 'swim';
  const avgPaceSPerKm = paceable && input.distanceM && input.distanceM > 0 ? Math.round(movingS / (input.distanceM / 1000)) : null;

  if (hasHr) {
    return {
      timeInZonesS: zoneSeconds,
      trainingLoad: edwardsTrimp(zoneSeconds!),
      loadMethod: 'hr_trimp',
      intensityClass: classifyIntensity(zoneSeconds!),
      avgPaceSPerKm,
    };
  }
  const intensityClass = intensityFromRpe(input.rpe);
  return {
    timeInZonesS: null,
    trainingLoad: durationEstimateLoad({ durationS: input.durationS, sport: input.sport, intensityClass, rpe: input.rpe }),
    loadMethod: 'duration_estimate',
    intensityClass,
    avgPaceSPerKm,
  };
}
