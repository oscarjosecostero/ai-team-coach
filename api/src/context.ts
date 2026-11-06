import type { LlmClient } from './ai/llm-client.js';
import type { Db } from './db/client.js';
import type { EmbeddingProvider } from './integrations/embeddings/embedding-provider.js';
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
  /** null when ANTHROPIC_API_KEY is not set: AI routes answer 503, everything else works. */
  llm: LlmClient | null;
  /** null when VOYAGE_API_KEY is not set: note search falls back to full-text. */
  embeddings: EmbeddingProvider | null;
  log: (msg: string) => void;
};
