import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import * as schema from './schema.js';

export function createDb(url: string) {
  const sql = postgres(url, { max: 10 });
  return { sql, db: drizzle(sql, { schema }) };
}
export type Database = ReturnType<typeof createDb>;

/** Both the top-level database and a transaction satisfy this, so repositories work in either. */
export type Db = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;
