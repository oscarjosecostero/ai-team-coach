import { defineConfig, devices } from "@playwright/test";

/**
 * Happy path against real servers: the Fastify API on :4100 (fresh `coach_e2e` database, seeded by
 * api/test/e2e/seed-e2e.ts with one agent proposal) and Next.js on :3100 proxying /api to it.
 * No Anthropic key is involved. Set E2E_BASE_URL to run against a deployed web app instead.
 */
const API_PORT = 4100;
const WEB_PORT = 3100;
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: external ?? `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: external
    ? undefined
    : [
        {
          command: "npm run e2e:serve --workspace api",
          cwd: "..",
          port: API_PORT,
          reuseExistingServer: false,
          timeout: 120_000,
          env: {
            PORT: String(API_PORT),
            DATABASE_URL: `${(process.env.E2E_BASE_DATABASE_URL ?? "postgres://coach:coach@localhost:5432/coach").replace(/\/[^/]*$/, "")}/coach_e2e`,
            JWT_SECRET: "e2e-secret-e2e-secret-e2e-secret",
            ANTHROPIC_API_KEY: "",
            VOYAGE_API_KEY: "",
            NODE_ENV: "development",
          },
        },
        {
          command: `npx next dev --port ${WEB_PORT}`,
          port: WEB_PORT,
          reuseExistingServer: false,
          timeout: 120_000,
          env: { API_URL: `http://localhost:${API_PORT}` },
        },
      ],
});
