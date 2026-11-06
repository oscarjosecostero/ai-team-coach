import 'dotenv/config';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createDb } from './db/client.js';

const env = loadEnv();
const database = createDb(env.DATABASE_URL);
const app = buildApp({ database });

await app.listen({ port: env.PORT, host: '0.0.0.0' });
