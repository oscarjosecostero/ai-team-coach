import type { FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';
import type { Actor } from '../lib/actor.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { resolveSession } from '../services/auth.js';
import type { AppContext } from '../context.js';

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest('Invalid request', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

/** Authenticates the request from the session cookie and returns the current user. */
export async function requireActor(ctx: AppContext, req: FastifyRequest): Promise<Actor> {
  let payload: { sub?: string };
  try {
    payload = await req.jwtVerify<{ sub?: string }>({ onlyCookie: true });
  } catch {
    throw unauthorized();
  }
  const actor = payload.sub ? await resolveSession(ctx.db, payload.sub) : null;
  if (!actor) throw unauthorized();
  return actor;
}
