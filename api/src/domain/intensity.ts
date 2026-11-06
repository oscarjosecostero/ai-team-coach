import type { TimeInZones } from './load.js';

export type IntensityClass = 'easy' | 'moderate' | 'hard';

export function intensitySplit(zoneSeconds: TimeInZones): { lowPct: number; highPct: number } {
  const total = zoneSeconds.reduce((a, b) => a + b, 0);
  if (total === 0) return { lowPct: 0, highPct: 0 };
  const low = zoneSeconds[0] + zoneSeconds[1];
  return { lowPct: round1((low / total) * 100), highPct: round1(((total - low) / total) * 100) };
}

/** Hard if >= hardShare of time is in Z4+; easy if mostly Z1-Z2; otherwise moderate. */
export function classifyIntensity(zoneSeconds: TimeInZones, hardShare = 0.2): IntensityClass {
  const total = zoneSeconds.reduce((a, b) => a + b, 0);
  if (total === 0) return 'easy';
  if ((zoneSeconds[3] + zoneSeconds[4]) / total >= hardShare) return 'hard';
  return intensitySplit(zoneSeconds).lowPct >= 80 ? 'easy' : 'moderate';
}

/** Longest run of consecutive calendar days with at least one hard session. dates: ISO yyyy-mm-dd. */
export function maxConsecutiveHardDays(hardDates: string[]): number {
  const days = [...new Set(hardDates)].map((d) => Date.parse(`${d}T00:00:00Z`)).sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  days.forEach((t, i) => {
    run = i > 0 && t - days[i - 1]! === 86_400_000 ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return best;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
