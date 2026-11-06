import type { Db } from './db/client.js';
import type { JobPublisher } from './jobs/publisher.js';
import type { Clock } from './lib/actor.js';

/** Everything the HTTP layer needs, injected so tests can swap the clock and the job publisher. */
export type AppContext = {
  db: Db;
  now: Clock;
  jobs: JobPublisher;
  jwtSecret: string;
  demoLoginEnabled: boolean;
  secureCookies: boolean;
};
