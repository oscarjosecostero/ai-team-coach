import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { teamRanking } from '../services/team.js';
import { requireActor } from './helpers.js';

export function registerTeamRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/team/ranking', async (req) => {
    const actor = await requireActor(ctx, req);
    return { ranking: await teamRanking(ctx, actor) };
  });
}
