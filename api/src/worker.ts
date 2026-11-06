import 'dotenv/config';
import { PgBoss } from 'pg-boss';
import { loadEnv } from './config/env.js';
import { createDb } from './db/client.js';
import { startWorkers } from './jobs/worker-setup.js';

const env = loadEnv();
const { db, sql } = createDb(env.DATABASE_URL);
const boss = new PgBoss(env.DATABASE_URL);
boss.on('error', (err) => console.error('[pg-boss]', err));

await boss.start();
await startWorkers(boss, { db });
console.log('Worker started');

const shutdown = async () => {
  await boss.stop({ graceful: true });
  await sql.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
