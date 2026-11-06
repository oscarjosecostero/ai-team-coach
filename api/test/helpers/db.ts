import { createDb } from '../../src/db/client.js';

const base = process.env.DATABASE_URL ?? 'postgres://coach:coach@localhost:5432/coach';

/** Integration tests that mutate data use their own database so the dev seed is never touched. */
export const TEST_DB_NAME = 'coach_test';

export function urlForDatabase(name: string): string {
  const u = new URL(base);
  u.pathname = `/${name}`;
  return u.toString();
}

export const TEST_DATABASE_URL = urlForDatabase(TEST_DB_NAME);

export function createTestDb() {
  return createDb(TEST_DATABASE_URL);
}
