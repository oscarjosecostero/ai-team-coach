import 'dotenv/config';
import { PgBoss } from 'pg-boss';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createDb } from './db/client.js';
import { PgBossPublisher } from './jobs/publisher.js';
import { ALL_QUEUES } from './jobs/definitions.js';

const env = loadEnv();
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
});

await app.listen({ port: env.PORT, host: '0.0.0.0' });
