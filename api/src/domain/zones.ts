export type HrZones = { z1Max: number; z2Max: number; z3Max: number; z4Max: number };

/** Upper HR bound (bpm, inclusive) of zones 1-4; zone 5 is everything above z4Max. */
export function computeHrZones(input: { lthr?: number | null; maxHr?: number | null }): HrZones {
  const { lthr, maxHr } = input;
  if (lthr && lthr > 0) {
    // Friel LTHR zones
    return {
      z1Max: Math.round(lthr * 0.85) - 1,
      z2Max: Math.round(lthr * 0.89),
      z3Max: Math.round(lthr * 0.94),
      z4Max: Math.round(lthr * 0.99),
    };
  }
  if (maxHr && maxHr > 0) {
    return {
      z1Max: Math.round(maxHr * 0.6),
      z2Max: Math.round(maxHr * 0.7),
      z3Max: Math.round(maxHr * 0.8),
      z4Max: Math.round(maxHr * 0.9),
    };
  }
  throw new Error('Either lthr or maxHr is required to compute HR zones');
}

export function zoneForHr(hr: number, zones: HrZones): 1 | 2 | 3 | 4 | 5 {
  if (hr <= zones.z1Max) return 1;
  if (hr <= zones.z2Max) return 2;
  if (hr <= zones.z3Max) return 3;
  if (hr <= zones.z4Max) return 4;
  return 5;
}

/** Seconds spent in each zone from a per-second (or fixed-interval) HR series. */
export function timeInZones(hrSamples: number[], zones: HrZones, sampleSeconds = 1): [number, number, number, number, number] {
  const out: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  for (const hr of hrSamples) out[zoneForHr(hr, zones) - 1]! += sampleSeconds;
  return out;
}
