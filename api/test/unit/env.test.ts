import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';

describe('loadEnv', () => {
  it('parses a valid environment', () => {
    const env = loadEnv({ DATABASE_URL: 'postgres://u:p@localhost:5432/d', JWT_SECRET: 'x'.repeat(16) });
    expect(env.PORT).toBe(4000);
  });
  it('rejects a missing DATABASE_URL', () => {
    expect(() => loadEnv({ JWT_SECRET: 'x'.repeat(16) })).toThrow();
  });
});
