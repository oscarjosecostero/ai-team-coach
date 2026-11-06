import { demoLoginRequestSchema, loginRequestSchema, type SessionUser } from '@coach/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '../context.js';
import { AppError } from '../lib/errors.js';
import { demoLogin, listDemoAccounts, login } from '../services/auth.js';
import { parse, requireActor } from './helpers.js';

const COOKIE = 'session';
const WEEK_S = 7 * 24 * 3600;

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const startSession = async (reply: FastifyReply, user: SessionUser) => {
    const token = await reply.jwtSign({ sub: user.id }, { expiresIn: WEEK_S });
    reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: ctx.secureCookies, path: '/', maxAge: WEEK_S });
    return { user };
  };

  app.post('/auth/login', async (req, reply) => {
    const body = parse(loginRequestSchema, req.body);
    return startSession(reply, await login(ctx.db, body.email, body.password));
  });

  if (ctx.demoLoginEnabled) {
    app.get('/auth/demo-accounts', async () => ({ accounts: await listDemoAccounts(ctx.db) }));
    app.post('/auth/demo-login', async (req, reply) => {
      const body = parse(demoLoginRequestSchema, req.body);
      return startSession(reply, await demoLogin(ctx.db, body.email));
    });
  } else {
    app.post('/auth/demo-login', async () => {
      throw new AppError(404, 'not_found', 'Demo login is disabled');
    });
  }

  app.post('/auth/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/auth/me', async (req) => ({ user: await requireActor(ctx, req) }));
}
