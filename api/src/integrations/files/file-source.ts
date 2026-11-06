import type { ActivitySource, ParsedActivity } from '../activity-source.js';
import { ActivityParseError } from '../activity-source.js';
import { parseFit } from './fit.js';
import { parseGpx } from './gpx.js';

/** One uploaded FIT or GPX file exposed through the same interface as any other source. */
export class FileActivitySource implements ActivitySource {
  readonly source = 'file' as const;

  constructor(
    private readonly file: { name: string; content: Buffer },
    private readonly sportOverride?: ParsedActivity['sport'],
  ) {}

  async fetchActivities(): Promise<ParsedActivity[]> {
    const ext = this.file.name.toLowerCase().split('.').pop();
    if (ext === 'fit') return [await parseFit(this.file.content, this.sportOverride)];
    if (ext === 'gpx') return [parseGpx(this.file.content, this.sportOverride)];
    throw new ActivityParseError(`Unsupported file type ".${ext}" (expected .fit or .gpx)`);
  }
}
