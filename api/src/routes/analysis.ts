import { analysisRunRequestSchema } from '@coach/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { getRunAs, listRunsAs, startAnalysisAs } from '../services/analysis.js';
import { parse, requireActor } from './helpers.js';

const runsQuery = z.object({ athleteId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(50).default(10) });
const runParams = z.object({ id: z.string().uuid() });

export function registerAnalysisRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Background runs started by this process; closing the server waits for them (graceful redeploys, tests).
  const inFlight = new Set<Promise<void>>();
  app.addHook('onClose', async () => {
    await Promise.allSettled(inFlight);
  });

  /** Manual trigger (the "Run analysis" button). Returns 202 with the run; poll GET /analysis/runs/:id. */
  app.post('/analysis/run', async (req, reply) => {
    const actor = await requireActor(ctx, req);
    const body = parse(analysisRunRequestSchema, req.body ?? {});
    const { run, done } = await startAnalysisAs(ctx, actor, body.athleteId ?? actor.id, body.kind);
    inFlight.add(done);
    void done.finally(() => inFlight.delete(done));
    return reply.code(202).send({ run });
  });

  app.get('/analysis/runs', async (req) => {
    const actor = await requireActor(ctx, req);
    const q = parse(runsQuery, req.query);
    return { runs: await listRunsAs(ctx, actor, q.athleteId ?? actor.id, q.limit) };
  });

  app.get('/analysis/runs/:id', async (req) => {
    const actor = await requireActor(ctx, req);
    const { id } = parse(runParams, req.params);
    return { run: await getRunAs(ctx, actor, id) };
  });
}
