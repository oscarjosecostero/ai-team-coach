import type { Fact } from '@coach/contracts';
import type { Actor } from '../lib/actor.js';
import { aiFailed } from '../lib/errors.js';
import { agentRunsRepo } from '../repositories/agent-runs.js';
import { chatMessagesRepo, type ChatMessageRow } from '../repositories/chat-messages.js';
import { proposalsRepo } from '../repositories/proposals.js';
import { requireAthlete } from './access.js';
import { runAgentForAthlete, type AiDeps, type StoredTrace } from './analysis.js';

/** Turns of earlier conversation sent with each new message (text only, oldest first). */
const HISTORY_TURNS = 20;

export type ChatMessageView = Pick<ChatMessageRow, 'id' | 'role' | 'content' | 'createdAt'> & { citations: Fact[] };

async function withCitations(deps: AiDeps, rows: ChatMessageRow[]): Promise<ChatMessageView[]> {
  const runIds = [...new Set(rows.map((r) => r.agentRunId).filter((x): x is string => Boolean(x)))];
  const runs = new Map((await agentRunsRepo.listByIds(deps.db, runIds)).map((r) => [r.id, r]));
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    createdAt: r.createdAt,
    citations: r.agentRunId ? ((runs.get(r.agentRunId)?.toolTrace as StoredTrace | null)?.citations ?? []) : [],
  }));
}

/** Chat is the athlete's own conversation with the coach agent. */
export async function getChat(deps: AiDeps, actor: Actor): Promise<ChatMessageView[]> {
  requireAthlete(actor);
  return withCitations(deps, await chatMessagesRepo.listAll(deps.db, actor.id));
}

export async function sendChatMessage(deps: AiDeps, actor: Actor, message: string) {
  requireAthlete(actor);
  const history = await chatMessagesRepo.listRecent(deps.db, actor.id, HISTORY_TURNS);
  await chatMessagesRepo.insert(deps.db, { userId: actor.id, role: 'user', content: message });

  const { run, result } = await runAgentForAthlete(deps, {
    athleteId: actor.id,
    kind: 'chat',
    trigger: 'chat',
    userMessage: message,
    history: history.map((m) => ({ role: m.role, content: m.content })),
  });
  if (result.status === 'failed') throw aiFailed('The coach could not answer right now. Please try again.', { runId: run.id, code: result.error?.code });

  const reply = await chatMessagesRepo.insert(deps.db, { userId: actor.id, role: 'assistant', content: result.text, agentRunId: run.id });
  return {
    message: { id: reply.id, role: reply.role, content: reply.content, createdAt: reply.createdAt, citations: result.citations } satisfies ChatMessageView,
    // Proposals waiting on the coach stay invisible to the athlete.
    proposals: (await proposalsRepo.listByRun(deps.db, run.id)).filter((p) => p.status !== 'awaiting_coach'),
    runId: run.id,
  };
}
