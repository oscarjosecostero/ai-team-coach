import type { AnalysisKind, Fact } from '@coach/contracts';
import { runCoachAgent, type AgentResult } from '../ai/coach-agent.js';
import type { LlmClient } from '../ai/llm-client.js';
import { AGENT_PROFILES, type AgentKind } from '../ai/models.js';
import { KICKOFF } from '../ai/prompts/system.js';
import type { Db } from '../db/client.js';
import { toIsoDate } from '../domain/dates.js';
import type { EmbeddingProvider } from '../integrations/embeddings/embedding-provider.js';
import type { Actor, Clock } from '../lib/actor.js';
import { aiUnavailable, notFound } from '../lib/errors.js';
import { activitiesRepo } from '../repositories/activities.js';
import { agentRunsRepo, type AgentRunRow } from '../repositories/agent-runs.js';
import { proposalsRepo, type ProposalRow } from '../repositories/proposals.js';
import { authorizeAthleteAccess } from './access.js';
import { createCoachDataPort } from './coach-data.js';
import { toProposalViews, type ProposalView } from './proposals.js';

/** What the AI use cases need. `llm` / `embeddings` are null when their API keys are not set. */
export type AiDeps = { db: Db; now: Clock; llm: LlmClient | null; embeddings: EmbeddingProvider | null; log?: (msg: string) => void };

/** Stored in agent_runs.tool_trace: the full tool trace plus the final reply and its resolved citations. */
export type StoredTrace = Pick<AgentResult, 'trace' | 'text' | 'citations' | 'unknownCitations' | 'turns' | 'proposalIds'>;

export type AgentRunOutcome = { run: AgentRunRow; result: AgentResult };

/** The model the configured provider will actually call (Claude ID, or e.g. a Gemini model). */
const modelName = (llm: LlmClient, kind: AgentKind) => llm.modelFor?.(AGENT_PROFILES[kind]) ?? AGENT_PROFILES[kind].model;

type AgentRunParams = { athleteId: string; kind: AgentKind; trigger: string; userMessage: string; history?: { role: 'user' | 'assistant'; content: string }[] };

/**
 * Runs the agent for one athlete and records it in agent_runs (status, model, tokens incl.
 * cache reads, tool trace, error). The caller must already have authorized access to the athlete.
 */
export async function runAgentForAthlete(deps: AiDeps, params: AgentRunParams): Promise<AgentRunOutcome> {
  if (!deps.llm) throw aiUnavailable();
  const run = await agentRunsRepo.start(deps.db, { userId: params.athleteId, kind: params.kind, trigger: params.trigger, model: modelName(deps.llm, params.kind) });
  return executeAgentRun(deps, run, params);
}

/** Runs the agent loop for a run row already in `running` state, then finishes the row. */
async function executeAgentRun(deps: AiDeps, run: AgentRunRow, params: AgentRunParams): Promise<AgentRunOutcome> {
  if (!deps.llm) throw aiUnavailable();
  const profile = AGENT_PROFILES[params.kind];
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

async function analysisKickoff(db: Db, params: { athleteId: string; kind: AnalysisKind; activityId?: string }): Promise<string> {
  if (params.kind === 'weekly') return KICKOFF.weekly();
  const activity = params.activityId ? await activitiesRepo.getById(db, params.activityId) : (await activitiesRepo.listRecent(db, params.athleteId, 1))[0];
  return KICKOFF.post_activity(activity && activity.userId === params.athleteId ? { activityDate: toIsoDate(activity.startedAt), sport: activity.sport } : null);
}

/** Post-activity check (Haiku) or weekly review (Sonnet) for one athlete. */
export async function runAnalysis(deps: AiDeps, params: { athleteId: string; kind: AnalysisKind; trigger: string; activityId?: string }): Promise<AnalysisResult> {
  const userMessage = await analysisKickoff(deps.db, params);
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

/** A run older than this that is still `running` was interrupted (e.g. a redeploy) and does not block a new one. */
const RUNNING_WINDOW_MS = 10 * 60_000;

/**
 * The manual "Run analysis" button: the athlete for themselves, or a coach for a teammate.
 * Asynchronous: creates the run row, starts the agent in the background and returns at once, so
 * no proxy timeout (Vercel rewrites wait at most 120 s) sits between the button and a long review.
 * The client polls `GET /analysis/runs/:id`. A second click while a run is in progress returns
 * that run instead of paying for another one.
 */
export async function startAnalysisAs(deps: AiDeps, actor: Actor, athleteId: string, kind: AnalysisKind): Promise<{ run: RunView; done: Promise<void> }> {
  const athlete = await authorizeAthleteAccess(deps.db, actor, athleteId);
  if (!deps.llm) throw aiUnavailable();
  const running = await agentRunsRepo.findRunningSince(deps.db, athlete.id, kind, new Date(deps.now().getTime() - RUNNING_WINDOW_MS));
  if (running) return { run: toRunView(running), done: Promise.resolve() };

  const params = { athleteId: athlete.id, kind, trigger: `manual:${actor.role}:${actor.id}` };
  const run = await agentRunsRepo.start(deps.db, { userId: athlete.id, kind, trigger: params.trigger, model: modelName(deps.llm, kind) });
  const done = analysisKickoff(deps.db, params)
    .then((userMessage) => executeAgentRun(deps, run, { ...params, userMessage }))
    .then(
      () => undefined,
      // executeAgentRun already marked the run failed; there is no request left to answer.
      (err: Error) => deps.log?.(`background analysis ${run.id} crashed: ${err.message}`),
    );
  return { run: toRunView(run), done };
}

export type RunView = Omit<AgentRunRow, 'toolTrace'> & { summary: string | null; citations: Fact[]; proposalIds: string[] };

// The trace stays server-side (it can be large); views show what happened and what it cost.
function toRunView({ toolTrace, ...r }: AgentRunRow, visibleProposalIds?: Set<string>): RunView {
  const t = toolTrace as StoredTrace | null;
  const ids = t?.proposalIds ?? [];
  return { ...r, summary: t?.text ?? null, citations: t?.citations ?? [], proposalIds: visibleProposalIds ? ids.filter((id) => visibleProposalIds.has(id)) : ids };
}

/** Proposals waiting on the coach stay invisible to the athlete, including their IDs. */
const visibleTo = (actor: Actor, rows: ProposalRow[]) => (actor.role === 'athlete' ? rows.filter((p) => p.status !== 'awaiting_coach') : rows);

export async function listRunsAs(deps: AiDeps, actor: Actor, athleteId: string, limit: number): Promise<RunView[]> {
  const athlete = await authorizeAthleteAccess(deps.db, actor, athleteId);
  const runs = await agentRunsRepo.listForUser(deps.db, athlete.id, limit);
  const visible = new Set(visibleTo(actor, await proposalsRepo.listByRuns(deps.db, runs.map((r) => r.id))).map((p) => p.id));
  return runs.map((r) => toRunView(r, visible));
}

/** One run with the proposals it created (what the "Run analysis" button polls). */
export async function getRunAs(deps: AiDeps, actor: Actor, runId: string): Promise<RunView & { proposals: ProposalView[] }> {
  const run = await agentRunsRepo.getById(deps.db, runId);
  if (!run) throw notFound('Analysis run');
  try {
    await authorizeAthleteAccess(deps.db, actor, run.userId);
  } catch {
    throw notFound('Analysis run'); // same answer whether it exists or not
  }
  const proposals = visibleTo(actor, await proposalsRepo.listByRun(deps.db, run.id));
  return { ...toRunView(run, new Set(proposals.map((p) => p.id))), proposals: await toProposalViews(deps.db, proposals) };
}
