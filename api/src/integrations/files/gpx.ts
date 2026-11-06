import { XMLParser } from 'fast-xml-parser';
import { createHash } from 'node:crypto';
import { ActivityParseError, type ParsedActivity } from '../activity-source.js';
import { toOneHertzHr } from './hr-series.js';

const SPORT_MAP: Record<string, ParsedActivity['sport']> = {
  running: 'run', run: 'run', '9': 'run',
  cycling: 'bike', biking: 'bike', bike: 'bike', '1': 'bike',
  swimming: 'swim', swim: 'swim',
};

type Pt = { '@_lat': string; '@_lon': string; ele?: number; time?: string; extensions?: Record<string, unknown> };

const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** Finds `hr` inside a Garmin TrackPointExtension regardless of namespace prefix. */
function extractHr(ext: Record<string, unknown> | undefined): number | undefined {
  const walk = (node: unknown): number | undefined => {
    if (!node || typeof node !== 'object') return undefined;
    for (const [k, v] of Object.entries(node)) {
      if (k.split(':').pop() === 'hr' && typeof v === 'number') return v;
      const found = walk(v);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return walk(ext);
}

export function parseGpx(content: Buffer, sportOverride?: ParsedActivity['sport']): ParsedActivity {
  let doc;
  try {
    doc = new XMLParser({ ignoreAttributes: false, parseAttributeValue: false, parseTagValue: true }).parse(content.toString('utf8'));
  } catch (err) {
    throw new ActivityParseError(`Invalid GPX file: ${err instanceof Error ? err.message : String(err)}`);
  }
  const trk = arr(doc?.gpx?.trk)[0];
  if (!trk) throw new ActivityParseError('GPX file has no track');

  const pts = arr<{ trkpt?: Pt | Pt[] }>(trk.trkseg).flatMap((seg) => arr(seg.trkpt));
  const timed = pts.filter((p) => typeof p.time === 'string' && !Number.isNaN(Date.parse(p.time)));
  if (timed.length < 2) throw new ActivityParseError('GPX track needs at least two timestamped points');

  const coords = timed.map((p) => ({ lat: Number(p['@_lat']), lon: Number(p['@_lon']), t: Date.parse(p.time!), ele: p.ele, hr: extractHr(p.extensions) }));
  let distanceM = 0;
  let gain = 0;
  let lastEle = coords[0]!.ele;
  for (let i = 1; i < coords.length; i++) {
    distanceM += haversineM(coords[i - 1]!, coords[i]!);
    const ele = coords[i]!.ele;
    // 3 m hysteresis filters GPS altitude noise.
    if (ele !== undefined && lastEle !== undefined && Math.abs(ele - lastEle) >= 3) {
      if (ele > lastEle) gain += ele - lastEle;
      lastEle = ele;
    }
  }

  const durationS = Math.round((coords.at(-1)!.t - coords[0]!.t) / 1000);
  const hrPoints = coords.filter((c) => c.hr !== undefined).map((c) => ({ t: c.t, hr: c.hr! }));
  const hrSamples = toOneHertzHr(hrPoints);
  const hrs = hrPoints.map((p) => p.hr);
  const typeKey = String(trk.type ?? '').toLowerCase();

  return {
    source: 'file',
    sourceId: `sha256:${createHash('sha256').update(content).digest('hex')}`,
    sport: sportOverride ?? SPORT_MAP[typeKey] ?? 'other',
    startedAt: new Date(coords[0]!.t),
    durationS,
    distanceM: Math.round(distanceM),
    elevationGainM: Math.round(gain),
    avgHr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : undefined,
    maxHr: hrs.length ? Math.max(...hrs) : undefined,
    hrSamples: hrSamples.length ? hrSamples : undefined,
    notes: typeof trk.name === 'string' ? trk.name : undefined,
    raw: { format: 'gpx', points: coords.length },
  };
}
