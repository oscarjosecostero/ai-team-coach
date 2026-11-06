import { checkinRequestSchema } from '@coach/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { submitCheckin } from '../services/checkins.js';
import { getCalendar, getDashboard, listActivities } from '../services/dashboard.js';
import { parse, requireActor } from './helpers.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const athleteQuery = z.object({ athleteId: z.string().uuid().optional() });
const calendarQuery = athleteQuery.extend({ from: isoDate, to: isoDate });
const activitiesQuery = athleteQuery.extend({ limit: z.coerce.number().int().min(1).max(100).default(20) });

/** `athleteId` defaults to the caller; coaches pass it to look at a teammate. Access is checked in the service. */
export function registerAthleteDataRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/dashboard', async (req) => {
    const actor = await requireActor(ctx, req);
    const q = parse(athleteQuery, req.query);
    return getDashboard(ctx, actor, q.athleteId ?? actor.id);
  });

  app.get('/activities', async (req) => {
    const actor = await requireActor(ctx, req);
    const q = parse(activitiesQuery, req.query);
    return { activities: await listActivities(ctx, actor, q.athleteId ?? actor.id, q.limit) };
  });

  app.get('/calendar', async (req) => {
    const actor = await requireActor(ctx, req);
    const q = parse(calendarQuery, req.query);
    return { workouts: await getCalendar(ctx, actor, q.athleteId ?? actor.id, q.from, q.to) };
  });

  app.post('/checkins', async (req, reply) => {
    const actor = await requireActor(ctx, req);
    const checkin = await submitCheckin(ctx, actor, parse(checkinRequestSchema, req.body));
    return reply.code(201).send({ checkin });
  });
}
