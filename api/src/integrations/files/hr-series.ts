/** Turns timestamped HR points into a 1 Hz series. Gaps longer than maxGapS (pauses) are skipped. */
export function toOneHertzHr(points: { t: number; hr: number }[], maxGapS = 30): number[] {
  const out: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const cur = points[i]!;
    const gap = Math.round((points[i + 1]!.t - cur.t) / 1000);
    if (gap <= 0 || gap > maxGapS) continue;
    for (let s = 0; s < gap; s++) out.push(cur.hr);
  }
  return out;
}
