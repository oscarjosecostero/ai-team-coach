import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export function createDb(url: string) {
  const sql = postgres(url, { max: 10 });
  return { sql, db: drizzle(sql) };
}
export type Database = ReturnType<typeof createDb>;
