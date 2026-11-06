import { coachReviewRequestSchema, decisionRequestSchema, proposalStatusSchema } from '@coach/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { proposalService } from '../services/proposals.js';
import { parse, requireActor } from './helpers.js';

const idParams = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  status: z.string().optional().transform((v) => v?.split(',').filter(Boolean)).pipe(z.array(proposalStatusSchema).optional()),
  athleteId: z.string().uuid().optional(),
});

export function registerProposalRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/proposals', async (req) => {
    const actor = await requireActor(ctx, req);
    const q = parse(listQuery, req.query);
    return { proposals: await proposalService.list(ctx, actor, { status: q.status, athleteId: q.athleteId }) };
  });

  app.get('/proposals/:id', async (req) => {
    const actor = await requireActor(ctx, req);
    return { proposal: await proposalService.get(ctx, actor, parse(idParams, req.params).id) };
  });

  app.post('/proposals/:id/accept', async (req) => {
    const actor = await requireActor(ctx, req);
    const { note } = parse(decisionRequestSchema, req.body ?? {});
    return { proposal: await proposalService.accept(ctx, actor, parse(idParams, req.params).id, note) };
  });

  app.post('/proposals/:id/reject', async (req) => {
    const actor = await requireActor(ctx, req);
    const { note } = parse(decisionRequestSchema, req.body ?? {});
    return { proposal: await proposalService.reject(ctx, actor, parse(idParams, req.params).id, note) };
  });

  app.post('/proposals/:id/coach-review', async (req) => {
    const actor = await requireActor(ctx, req);
    const review = parse(coachReviewRequestSchema, req.body);
    return { proposal: await proposalService.coachReview(ctx, actor, parse(idParams, req.params).id, review) };
  });
}
