import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('./migrations', import.meta.url));

/** Applies pending migrations (idempotent). The API runs it on start, before listening. */
export async function runMigrations(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await sql.end();
  }
}

/** Creates `database` on the server of `baseUrl` if missing, then applies all migrations. */
export async function ensureMigratedDatabase(baseUrl: string, database: string): Promise<string> {
  const admin = new URL(baseUrl);
  admin.pathname = '/postgres';
  const target = new URL(baseUrl);
  target.pathname = `/${database}`;

  const a = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    const exists = await a`select 1 from pg_database where datname = ${database}`;
    if (exists.length === 0) await a.unsafe(`create database "${database.replace(/"/g, '')}"`);
  } finally {
    await a.end();
  }
  await runMigrations(target.toString());
  return target.toString();
}
