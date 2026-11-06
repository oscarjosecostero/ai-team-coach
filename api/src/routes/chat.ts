import { chatRequestSchema } from '@coach/contracts';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { getChat, sendChatMessage } from '../services/chat.js';
import { parse, requireActor } from './helpers.js';

export function registerChatRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/chat', async (req) => {
    const actor = await requireActor(ctx, req);
    return { messages: await getChat(ctx, actor) };
  });

  app.post('/chat', async (req) => {
    const actor = await requireActor(ctx, req);
    const { message } = parse(chatRequestSchema, req.body);
    return sendChatMessage(ctx, actor, message);
  });
}
