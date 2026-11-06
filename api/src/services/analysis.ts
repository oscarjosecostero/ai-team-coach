import type { AnalysisKind, Fact } from '@coach/contracts';
import { runCoachAgent, type AgentResult } from '../ai/coach-agent.js';
import type { LlmClient } from '../ai/llm-client.js';
import { AGENT_PROFILES, type AgentKind } from '../ai/models.js';
import { KICKOFF } from '../ai/prompts/system.js';
import type { Db } from '../db/client.js';
import { toIsoDate } from '../domain/dates.js';
import type { EmbeddingProvider } from '../integrations/embeddings/embedding-provider.js';
import type { Actor, Clock } from '../lib/actor.js';
import { aiUnavailable } from '../lib/errors.js';
import { activitiesRepo } from '../repositories/activities.js';
import { agentRunsRepo, type AgentRunRow } from '../repositories/agent-runs.js';
import { proposalsRepo, type ProposalRow } from '../repositories/proposals.js';
import { authorizeAthleteAccess } from './access.js';
import { createCoachDataPort } from './coach-data.js';

/** What the AI use cases need. `llm` / `embeddings` are null when their API keys are not set. */
export type AiDeps = { db: Db; now: Clock; llm: LlmClient | null; embeddings: EmbeddingProvider | null; log?: (msg: string) => void };

/** Stored in agent_runs.tool_trace: the full tool trace plus the final reply and its resolved citations. */
export type StoredTrace = Pick<AgentResult, 'trace' | 'text' | 'citations' | 'unknownCitations' | 'turns' | 'proposalIds'>;

export type AgentRunOutcome = { run: AgentRunRow; result: AgentResult };

/**
 * Starts an agent run for one athlete and records it in agent_runs (status, model, tokens incl.
 * cache reads, tool trace, error). The caller must already have authorized access to the athlete.
 */
export async function runAgentForAthlete(
  deps: AiDeps,
  params: { athleteId: string; kind: AgentKind; trigger: string; userMessage: string; history?: { role: 'user' | 'assistant'; content: string }[] },
): Promise<AgentRunOutcome> {
  if (!deps.llm) throw aiUnavailable();
  const profile = AGENT_PROFILES[params.kind];
  const run = await agentRunsRepo.start(deps.db, { userId: params.athleteId, kind: params.kind, trigger: params.trigger, model: profile.model });
  const data = createCoachDataPort({ db: deps.db, now: deps.now, embeddings: deps.embeddings, log: deps.log });

  let result: AgentResult;
  try {
    result = await runCoachAgent(
      { llm: deps.llm, data },
      { kind: params.kind, athleteId: params.athleteId, runId: run.id, today: toIsoDate(deps.now()), userMessage: params.userMessage, history: params.history, profile },
    );
  } catch (err) {
    // Infrastructure failure inside a tool (e.g. the database): record it, then let it surface.
    await agentRunsRepo.finish(deps.db, run.id, {
      status: 'failed',
      toolTrace: null,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      error: `internal: ${(err as Error).message}`,
      finishedAt: deps.now(),
    });
    throw err;
  }

  const stored: StoredTrace = { trace: result.trace, text: result.text, citations: result.citations, unknownCitations: result.unknownCitations, turns: result.turns, proposalIds: result.proposalIds };
  const finished = await agentRunsRepo.finish(deps.db, run.id, {
    status: result.status,
    toolTrace: stored,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    cacheReadTokens: result.usage.cacheReadTokens,
    error: result.error ? `${result.error.code}: ${result.error.message}` : null,
    finishedAt: deps.now(),
  });
  if (result.status === 'failed') deps.log?.(`agent run ${run.id} (${params.kind}) failed: ${result.error?.code} ${result.error?.message}`);
  return { run: finished, result };
}

export type AnalysisResult = {
  runId: string;
  kind: AnalysisKind;
  model: string;
  status: 'succeeded' | 'failed';
  summary: string;
  citations: Fact[];
  proposals: ProposalRow[];
  error: string | null;
};

/** Post-activity check (Haiku) or weekly review (Sonnet) for one athlete. */
export async function runAnalysis(deps: AiDeps, params: { athleteId: string; kind: AnalysisKind; trigger: string; activityId?: string }): Promise<AnalysisResult> {
  let userMessage: string;
  if (params.kind === 'post_activity') {
    const activity = params.activityId ? await activitiesRepo.getById(deps.db, params.activityId) : (await activitiesRepo.listRecent(deps.db, params.athleteId, 1))[0];
    userMessage = KICKOFF.post_activity(activity && activity.userId === params.athleteId ? { activityDate: toIsoDate(activity.startedAt), sport: activity.sport } : null);
  } else {
    userMessage = KICKOFF.weekly();
  }

  const { run, result } = await runAgentForAthlete(deps, { athleteId: params.athleteId, kind: params.kind, trigger: params.trigger, userMessage });
  return {
    runId: run.id,
    kind: params.kind,
    model: run.model,
    status: result.status,
    summary: result.text,
    citations: result.citations,
    proposals: await proposalsRepo.listByRun(deps.db, run.id),
    error: run.error,
  };
}

/** The manual "Run analysis" button: the athlete for themselves, or a coach for a teammate. */
export async function runAnalysisAs(deps: AiDeps, actor: Actor, athleteId: string, kind: AnalysisKind): Promise<AnalysisResult> {
  const athlete = await authorizeAthleteAccess(deps.db, actor, athleteId);
  if (!deps.llm) throw aiUnavailable();
  const result = await runAnalysis(deps, { athleteId: athlete.id, kind, trigger: `manual:${actor.role}:${actor.id}` });
  // Proposals waiting on the coach stay invisible to the athlete.
  return actor.role === 'athlete' ? { ...result, proposals: result.proposals.filter((p) => p.status !== 'awaiting_coach') } : result;
}

export async function listRunsAs(deps: AiDeps, actor: Actor, athleteId: string, limit: number) {
  const athlete = await authorizeAthleteAccess(deps.db, actor, athleteId);
  const runs = await agentRunsRepo.listForUser(deps.db, athlete.id, limit);
  // The trace stays server-side (it can be large); the list shows what happened and what it cost.
  return runs.map(({ toolTrace, ...r }) => {
    const t = toolTrace as StoredTrace | null;
    return { ...r, summary: t?.text ?? null, citations: t?.citations ?? [], proposalIds: t?.proposalIds ?? [] };
  });
}
