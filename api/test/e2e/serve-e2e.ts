/**
 * API server for the Playwright run (web/e2e): the production app wired to the e2e database and a
 * scripted model instead of Claude, so "Run analysis" and chat work without an API key. The model
 * reads the week summary, waits a few seconds (long enough for the web client to poll), then
 * replies citing a real fact. Run after seed-e2e.ts: tsx test/e2e/serve-e2e.ts
 */
import type { LlmClient, LlmRequest } from '../../src/ai/llm-client.js';
import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { createDb } from '../../src/db/client.js';
import { toIsoDate, weekStartOf } from '../../src/domain/dates.js';
import { lastToolResults, reply, toolCalls } from '../helpers/fake-llm.js';

const env = loadEnv();
const week = weekStartOf(toIsoDate(new Date()));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const llm: LlmClient = {
  async create(req: LlmRequest) {
    if (lastToolResults(req).length === 0) return toolCalls({ name: 'get_week_summary', input: {} });
    await sleep(Number(process.env.E2E_LLM_DELAY_MS ?? 3000));
    return reply(`Your acute:chronic load ratio is [[wk:${week}:acwr]]. Nothing else needs to change this week.`)(req);
  },
};

const app = buildApp({
  database: createDb(env.DATABASE_URL),
  jobs: { enqueueMetricsRecompute: async () => {}, enqueuePostActivityAnalysis: async () => {} },
  jwtSecret: env.JWT_SECRET,
  demoLoginEnabled: true,
  llm,
  embeddings: null,
});
await app.listen({ port: env.PORT, host: '127.0.0.1' });
