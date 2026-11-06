import { FitBaseType, FitEncoder } from 'fit-file-parser';
import { describe, expect, it } from 'vitest';
import { ActivityParseError } from '../../../src/integrations/activity-source.js';
import { FileActivitySource } from '../../../src/integrations/files/file-source.js';

const START = new Date('2026-11-03T07:00:00Z');

function buildFit(seconds = 120): Buffer {
  const enc = new FitEncoder();
  enc.writeMessage(0, [
    { number: 0, size: 1, baseType: FitBaseType.Enum, value: 4 }, // type = activity
    { number: 1, size: 2, baseType: FitBaseType.Uint16, value: 1 },
  ]);
  for (let s = 0; s < seconds; s++) {
    enc.writeMessage(20, [
      { number: 253, size: 4, baseType: FitBaseType.Uint32, value: FitEncoder.toFitTimestamp(new Date(START.getTime() + s * 1000)) },
      { number: 3, size: 1, baseType: FitBaseType.Uint8, value: s < 60 ? 130 : 170 },
      { number: 5, size: 4, baseType: FitBaseType.Uint32, value: Math.round(s * 3 * 100) }, // 3 m/s, scale 100
    ], 1);
  }
  enc.writeMessage(18, [
    { number: 253, size: 4, baseType: FitBaseType.Uint32, value: FitEncoder.toFitTimestamp(new Date(START.getTime() + seconds * 1000)) },
    { number: 2, size: 4, baseType: FitBaseType.Uint32, value: FitEncoder.toFitTimestamp(START) },
    { number: 5, size: 1, baseType: FitBaseType.Enum, value: 1 }, // running
    { number: 7, size: 4, baseType: FitBaseType.Uint32, value: seconds * 1000 },
    { number: 8, size: 4, baseType: FitBaseType.Uint32, value: seconds * 1000 },
    { number: 9, size: 4, baseType: FitBaseType.Uint32, value: seconds * 3 * 100 },
    { number: 16, size: 1, baseType: FitBaseType.Uint8, value: 150 },
    { number: 17, size: 1, baseType: FitBaseType.Uint8, value: 170 },
  ], 2);
  return Buffer.from(enc.close());
}

const gpx = (type = 'running') => `<?xml version="1.0"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <trk><name>Morning run</name><type>${type}</type><trkseg>
    <trkpt lat="40.0000" lon="-3.0000"><ele>600</ele><time>2026-11-03T07:00:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>140</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
    <trkpt lat="40.0010" lon="-3.0000"><ele>610</ele><time>2026-11-03T07:00:30Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>150</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
    <trkpt lat="40.0020" lon="-3.0000"><ele>605</ele><time>2026-11-03T07:01:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>160</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
  </trkseg></trk>
</gpx>`;

describe('FileActivitySource', () => {
  it('parses a FIT file into a normalized activity with a 1 Hz HR series', async () => {
    const [a] = await new FileActivitySource({ name: 'run.fit', content: buildFit() }).fetchActivities();
    expect(a).toMatchObject({ source: 'file', sport: 'run', durationS: 120, avgHr: 150, maxHr: 170, distanceM: 360 });
    expect(a!.startedAt.toISOString()).toBe('2026-11-03T07:00:00.000Z');
    expect(a!.hrSamples).toHaveLength(119);
    expect(a!.hrSamples!.slice(0, 60).every((hr) => hr === 130)).toBe(true);
    expect(a!.sourceId).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('gives the same sourceId for the same bytes (idempotent re-upload)', async () => {
    const fit = buildFit();
    const [a] = await new FileActivitySource({ name: 'a.fit', content: fit }).fetchActivities();
    const [b] = await new FileActivitySource({ name: 'b.fit', content: Buffer.from(fit) }).fetchActivities();
    expect(a!.sourceId).toBe(b!.sourceId);
  });

  it('rejects a corrupt FIT file', async () => {
    const bad = buildFit();
    bad[bad.length - 1] = bad[bad.length - 1]! ^ 0xff; // break the CRC
    await expect(new FileActivitySource({ name: 'bad.fit', content: bad }).fetchActivities()).rejects.toBeInstanceOf(ActivityParseError);
    await expect(new FileActivitySource({ name: 'junk.fit', content: Buffer.from('not a fit file') }).fetchActivities()).rejects.toBeInstanceOf(ActivityParseError);
  });

  it('parses a GPX track: distance, elevation, HR from the Garmin extension', async () => {
    const [a] = await new FileActivitySource({ name: 'run.gpx', content: Buffer.from(gpx()) }).fetchActivities();
    expect(a).toMatchObject({ source: 'file', sport: 'run', durationS: 60, avgHr: 150, maxHr: 160, notes: 'Morning run', elevationGainM: 10 });
    expect(a!.distanceM).toBeGreaterThan(215);
    expect(a!.distanceM).toBeLessThan(230); // 2 x 0.001 deg latitude ~ 222 m
    expect(a!.hrSamples).toHaveLength(60);
  });

  it('honors a sport override and rejects unsupported or empty files', async () => {
    const [a] = await new FileActivitySource({ name: 'x.gpx', content: Buffer.from(gpx('other')) }, 'swim').fetchActivities();
    expect(a!.sport).toBe('swim');
    await expect(new FileActivitySource({ name: 'x.tcx', content: Buffer.from('<x/>') }).fetchActivities()).rejects.toBeInstanceOf(ActivityParseError);
    await expect(new FileActivitySource({ name: 'x.gpx', content: Buffer.from('<gpx></gpx>') }).fetchActivities()).rejects.toBeInstanceOf(ActivityParseError);
  });
});
