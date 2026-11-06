import { analysisRunRequestSchema } from '@coach/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { listRunsAs, runAnalysisAs } from '../services/analysis.js';
import { parse, requireActor } from './helpers.js';

const runsQuery = z.object({ athleteId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(50).default(10) });

export function registerAnalysisRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Manual trigger (the demo's "Run analysis" button). Synchronous: returns the summary and any proposals. */
  app.post('/analysis/run', async (req) => {
    const actor = await requireActor(ctx, req);
    const body = parse(analysisRunRequestSchema, req.body ?? {});
    return { analysis: await runAnalysisAs(ctx, actor, body.athleteId ?? actor.id, body.kind) };
  });

  app.get('/analysis/runs', async (req) => {
    const actor = await requireActor(ctx, req);
    const q = parse(runsQuery, req.query);
    return { runs: await listRunsAs(ctx, actor, q.athleteId ?? actor.id, q.limit) };
  });
}
