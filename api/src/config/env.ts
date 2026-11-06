import { z } from 'zod';

const optionalSecret = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(16),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** One-click demo logins (no password). Turn off for anything but the public demo. */
  DEMO_LOGIN_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  /** Public demo: the worker replaces all data with a fresh seed every day at 04:00 UTC. */
  DEMO_DAILY_RESEED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /** Password shared by all seeded demo accounts. */
  SEED_PASSWORD: z.string().min(8).default('demo-password'),
  /** Empty means "not configured": AI routes answer 503 and note search uses full-text only. */
  ANTHROPIC_API_KEY: optionalSecret,
  VOYAGE_API_KEY: optionalSecret,
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
