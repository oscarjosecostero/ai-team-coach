import 'dotenv/config';
import { PgBoss } from 'pg-boss';
import { buildApp } from './app.js';
import { createAiAdapters } from './config/ai.js';
import { loadEnv } from './config/env.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { PgBossPublisher } from './jobs/publisher.js';
import { ALL_QUEUES } from './jobs/definitions.js';

const env = loadEnv();
await runMigrations(env.DATABASE_URL);
const database = createDb(env.DATABASE_URL);

// The API only publishes jobs; the worker process consumes them.
const boss = new PgBoss(env.DATABASE_URL);
boss.on('error', (err) => console.error('[pg-boss]', err));
await boss.start();
for (const q of ALL_QUEUES) await boss.createQueue(q);

const app = buildApp({
  database,
  jobs: new PgBossPublisher(boss),
  jwtSecret: env.JWT_SECRET,
  demoLoginEnabled: env.DEMO_LOGIN_ENABLED,
  secureCookies: env.NODE_ENV === 'production',
  ...createAiAdapters(env),
});

await app.listen({ port: env.PORT, host: '0.0.0.0' });

// Graceful stop on redeploys: finish in-flight requests and background analyses, then close pools.
const shutdown = async () => {
  await app.close();
  await boss.stop({ graceful: true });
  await database.sql.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
