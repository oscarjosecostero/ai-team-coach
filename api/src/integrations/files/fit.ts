import FitParser from 'fit-file-parser';
import { createHash } from 'node:crypto';
import { ActivityParseError, type ParsedActivity } from '../activity-source.js';
import { toOneHertzHr } from './hr-series.js';

const SPORT_MAP: Record<string, ParsedActivity['sport']> = {
  running: 'run',
  cycling: 'bike',
  swimming: 'swim',
  training: 'strength',
  fitness_equipment: 'strength',
};

export async function parseFit(content: Buffer, sportOverride?: ParsedActivity['sport']): Promise<ParsedActivity> {
  let fit;
  try {
    fit = await new FitParser({ force: false, speedUnit: 'm/s', lengthUnit: 'm' }).parseAsync(content as Buffer<ArrayBuffer>);
  } catch (err) {
    throw new ActivityParseError(`Invalid FIT file: ${err instanceof Error ? err.message : String(err)}`);
  }
  const session = fit.sessions?.[0];
  if (!session?.start_time) throw new ActivityParseError('FIT file has no session with a start time');

  const points = (fit.records ?? [])
    .filter((r) => r.timestamp && typeof r.heart_rate === 'number')
    .map((r) => ({ t: r.timestamp!.getTime(), hr: r.heart_rate! }));
  const hrSamples = toOneHertzHr(points);

  const durationS = Math.round(session.total_elapsed_time ?? session.total_timer_time ?? 0);
  if (durationS <= 0) throw new ActivityParseError('FIT file has no duration');

  return {
    source: 'file',
    sourceId: `sha256:${createHash('sha256').update(content).digest('hex')}`,
    sport: sportOverride ?? SPORT_MAP[String(session.sport)] ?? 'other',
    startedAt: session.start_time,
    durationS,
    movingTimeS: session.total_timer_time ? Math.round(session.total_timer_time) : undefined,
    distanceM: session.total_distance,
    elevationGainM: session.total_ascent,
    avgHr: session.avg_heart_rate,
    maxHr: session.max_heart_rate,
    avgPowerW: session.avg_power,
    hrSamples: hrSamples.length ? hrSamples : undefined,
    raw: { format: 'fit', sport: session.sport, subSport: session.sub_sport, records: fit.records?.length ?? 0 },
  };
}
