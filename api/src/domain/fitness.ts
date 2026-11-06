/** Exponentially weighted average of a daily load series (oldest -> newest). */
export function ewma(dailyLoads: number[], days: number): number {
  const alpha = 2 / (days + 1);
  return dailyLoads.reduce((acc, load, i) => (i === 0 ? load : acc + alpha * (load - acc)), 0);
}

export function fitnessMetrics(dailyLoads: number[]) {
  const atl = ewma(dailyLoads, 7);
  const ctl = ewma(dailyLoads, 42);
  return { atl: r1(atl), ctl: r1(ctl), tsb: r1(ctl - atl) };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Acute (last 7d avg) : chronic (last 28d avg). Null when there is no chronic load. */
export function acwr(dailyLoads: number[]): number | null {
  const chronic = mean(dailyLoads.slice(-28));
  if (chronic === 0) return null;
  return Math.round((mean(dailyLoads.slice(-7)) / chronic) * 100) / 100;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
