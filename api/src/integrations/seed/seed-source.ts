import type { ActivitySource, ParsedActivity } from '../activity-source.js';

/** Serves a pre-generated list of synthetic activities through the standard adapter interface. */
export class SeedActivitySource implements ActivitySource {
  readonly source = 'seed' as const;

  constructor(private readonly activities: ParsedActivity[]) {}

  async fetchActivities(): Promise<ParsedActivity[]> {
    return this.activities;
  }
}
