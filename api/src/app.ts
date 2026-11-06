import Fastify from 'fastify';
import type { HealthResponse } from '@coach/contracts';
import type { Database } from './db/client.js';

export function buildApp(deps: { database: Database }) {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  app.get('/health', async (_req, reply) => {
    let db: HealthResponse['db'] = 'ok';
    try {
      await deps.database.sql`select 1`;
    } catch {
      db = 'down';
    }
    const body: HealthResponse = { status: db === 'ok' ? 'ok' : 'degraded', db };
    return reply.code(db === 'ok' ? 200 : 503).send(body);
  });

  return app;
}
