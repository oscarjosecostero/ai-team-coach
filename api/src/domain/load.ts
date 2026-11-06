export type TimeInZones = readonly [number, number, number, number, number];

/** Edwards TRIMP: minutes in each zone weighted by the zone number (1-5). */
export function edwardsTrimp(zoneSeconds: TimeInZones): number {
  return Math.round(zoneSeconds.reduce((sum, s, i) => sum + (s / 60) * (i + 1), 0) * 10) / 10;
}

const SPORT_FACTOR: Record<string, number> = { run: 1, bike: 0.8, swim: 1, strength: 0.7, other: 0.6 };
const INTENSITY_FACTOR = { easy: 1.5, moderate: 2.5, hard: 4 } as const;

/** Fallback when no HR data: duration x sport factor x intensity (or RPE when present). */
export function durationEstimateLoad(input: {
  durationS: number;
  sport: string;
  intensityClass?: keyof typeof INTENSITY_FACTOR;
  rpe?: number | null;
}): number {
  const minutes = input.durationS / 60;
  const sport = SPORT_FACTOR[input.sport] ?? SPORT_FACTOR.other!;
  const intensity = input.rpe ? Math.max(1, Math.min(10, input.rpe)) * 0.5 : INTENSITY_FACTOR[input.intensityClass ?? 'moderate'];
  return Math.round(minutes * sport * intensity * 10) / 10;
}
