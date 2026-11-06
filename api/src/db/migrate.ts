import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';

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
  const sql = postgres(target.toString(), { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: fileURLToPath(new URL('./migrations', import.meta.url)) });
  } finally {
    await sql.end();
  }
  return target.toString();
}
