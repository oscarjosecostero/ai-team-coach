import 'dotenv/config';
import { PgBoss } from 'pg-boss';
import { createAiAdapters } from './config/ai.js';
import { loadEnv } from './config/env.js';
import { createDb } from './db/client.js';
import { PgBossPublisher } from './jobs/publisher.js';
import { startWorkers } from './jobs/worker-setup.js';

const env = loadEnv();
const { db, sql } = createDb(env.DATABASE_URL);
const boss = new PgBoss(env.DATABASE_URL);
boss.on('error', (err) => console.error('[pg-boss]', err));

await boss.start();
const { llm, embeddings } = createAiAdapters(env);
if (!llm) console.warn('ANTHROPIC_API_KEY not set: analysis jobs will be skipped.');
await startWorkers(boss, { db, llm, embeddings, publisher: new PgBossPublisher(boss), log: (m) => console.warn(m) });
console.log('Worker started');

const shutdown = async () => {
  await boss.stop({ graceful: true });
  await sql.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
