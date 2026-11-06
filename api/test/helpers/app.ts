import type { LlmClient } from '../../src/ai/llm-client.js';
import { buildApp } from '../../src/app.js';
import type { EmbeddingProvider } from '../../src/integrations/embeddings/embedding-provider.js';
import { recomputeWeeklyMetrics } from '../../src/services/metrics.js';
import { createTestDb } from './db.js';

export const TODAY = '2026-11-06';
export const PASSWORD = 'test-password';

export function createTestApp(opts: { llm?: LlmClient | null; embeddings?: EmbeddingProvider | null } = {}) {
  const database = createTestDb();
  const now = () => new Date(`${TODAY}T12:00:00Z`);
  const jobs = {
    // Runs inline so tests can assert on weekly_metrics without a worker.
    enqueueMetricsRecompute: async (userId: string, fromWeek: string) => void (await recomputeWeeklyMetrics(database.db, userId, fromWeek, TODAY)),
    enqueuePostActivityAnalysis: async () => {},
  };
  const app = buildApp({ database, jobs, now, jwtSecret: 'test-secret-test-secret', llm: opts.llm ?? null, embeddings: opts.embeddings ?? null });
  return { app, database, db: database.db };
}

export type TestApp = ReturnType<typeof createTestApp>['app'];

/** Logs in and returns the Cookie header to send on later requests. */
export async function loginCookie(app: TestApp, email: string, password = PASSWORD): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login failed for ${email}: ${res.statusCode} ${res.body}`);
  const c = res.cookies.find((x) => x.name === 'session');
  return `session=${c!.value}`;
}
