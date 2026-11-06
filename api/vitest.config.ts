import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Integration files share one Postgres database and truncate it, so they run one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
