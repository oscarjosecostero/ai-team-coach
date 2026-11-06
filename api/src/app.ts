import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import type { HealthResponse } from '@coach/contracts';
import type { AppContext } from './context.js';
import type { Database } from './db/client.js';
import { ActivityParseError } from './integrations/activity-source.js';
import { AppError } from './lib/errors.js';
import { registerAnalysisRoutes } from './routes/analysis.js';
import { registerAthleteDataRoutes } from './routes/athlete-data.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerProposalRoutes } from './routes/proposals.js';
import { registerTeamRoutes } from './routes/team.js';
import { registerUploadRoutes } from './routes/uploads.js';

export type AppDeps = {
  database: Database;
  jobs: AppContext['jobs'];
  jwtSecret: string;
  now?: AppContext['now'];
  demoLoginEnabled?: boolean;
  secureCookies?: boolean;
  llm?: AppContext['llm'];
  embeddings?: AppContext['embeddings'];
};

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  const ctx: AppContext = {
    db: deps.database.db,
    now: deps.now ?? (() => new Date()),
    jobs: deps.jobs,
    jwtSecret: deps.jwtSecret,
    demoLoginEnabled: deps.demoLoginEnabled ?? true,
    secureCookies: deps.secureCookies ?? false,
    llm: deps.llm ?? null,
    embeddings: deps.embeddings ?? null,
    log: (msg) => app.log.warn(msg),
  };

  app.register(cookie);
  app.register(jwt, { secret: deps.jwtSecret, cookie: { cookieName: 'session', signed: false } });
  app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    if (err instanceof ZodError) return reply.code(400).send({ error: { code: 'bad_request', message: 'Invalid request' } });
    if (err instanceof ActivityParseError) return reply.code(422).send({ error: { code: 'unparseable_file', message: err.message } });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.code(status).send({ error: { code: 'bad_request', message: (err as Error).message } });
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'internal', message: 'Internal server error' } });
  });

  app.get('/health', async (_req, reply) => {
    let db: HealthResponse['db'] = 'ok';
    try {
      await deps.database.sql`select 1`;
    } catch {
      db = 'down';
    }
    const body: HealthResponse = { status: db === 'ok' ? 'ok' : 'degraded', db };
    return reply.code(db === 'ok' ? 200 : 503).send(body);
  });

  registerAuthRoutes(app, ctx);
  registerAthleteDataRoutes(app, ctx);
  registerProposalRoutes(app, ctx);
  registerUploadRoutes(app, ctx);
  registerTeamRoutes(app, ctx);
  registerAnalysisRoutes(app, ctx);
  registerChatRoutes(app, ctx);

  return app;
}
