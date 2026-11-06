import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { TEST_DATABASE_URL, TEST_DB_NAME, urlForDatabase } from './helpers/db.js';

/** Creates the isolated test database if missing and brings it to the latest migration. */
export default async function setup() {
  const admin = postgres(urlForDatabase('postgres'), { max: 1 });
  try {
    const exists = await admin`select 1 from pg_database where datname = ${TEST_DB_NAME}`;
    if (exists.length === 0) await admin.unsafe(`create database ${TEST_DB_NAME}`);
  } finally {
    await admin.end();
  }

  const sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  } finally {
    await sql.end();
  }
}
