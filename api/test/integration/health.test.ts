import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createDb } from '../../src/db/client.js';

const database = createDb(process.env.DATABASE_URL ?? 'postgres://coach:coach@localhost:5432/coach');
const app = buildApp({ database, jobs: { enqueueMetricsRecompute: async () => {} }, jwtSecret: 'test-secret-test-secret' });

afterAll(async () => {
  await app.close();
  await database.sql.end();
});

describe('GET /health', () => {
  it('reports db ok against real Postgres', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'ok' });
  });
});
