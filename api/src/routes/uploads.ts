import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { badRequest } from '../lib/errors.js';
import { uploadActivityFile } from '../services/uploads.js';
import { parse, requireActor } from './helpers.js';

const sportField = z.enum(['run', 'bike', 'swim', 'strength', 'other']).optional();

export function registerUploadRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/uploads/activity', async (req, reply) => {
    const actor = await requireActor(ctx, req);
    const file = await req.file();
    if (!file) throw badRequest('Expected a multipart "file" field with a .fit or .gpx file');
    const sportRaw = file.fields.sport;
    const sport = parse(sportField, sportRaw && 'value' in sportRaw ? sportRaw.value || undefined : undefined);
    const content = await file.toBuffer(); // throws if the size limit is exceeded
    const result = await uploadActivityFile(ctx, actor, { name: file.filename, content }, sport);
    return reply.code(result.created ? 201 : 200).send(result);
  });
}
