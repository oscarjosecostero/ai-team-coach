import type { Fact } from '@coach/contracts';
import { FactLedger, resolveCitations } from './facts.js';
import type { LlmClient, LlmMessage, LlmMessageParam, LlmTextBlockParam, LlmToolResultBlockParam, LlmToolUseBlock } from './llm-client.js';
import { LlmError } from './llm-client.js';
import { AGENT_PROFILES, type AgentKind, type AgentProfile } from './models.js';
import type { CoachDataPort } from './ports.js';
import { buildAthleteContext } from './prompts/athlete-context.js';
import { CHAT_INSTRUCTIONS, COACH_SYSTEM_PROMPT } from './prompts/system.js';
import { dispatchTool, toolDefinitions } from './tools/registry.js';
import type { ToolContext } from './tools/types.js';

export type TraceStep =
  | { type: 'model'; turn: number; stopReason: string | null; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }
  | { type: 'tool'; turn: number; tool: string; input: unknown; isError: boolean; output: string; ms: number };

export type AgentUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };

export type AgentResult = {
  status: 'succeeded' | 'failed';
  model: string;
  /** Final reply to the athlete, with unknown [[fact-id]] citations removed. */
  text: string;
  citations: Fact[];
  unknownCitations: string[];
  proposalIds: string[];
  trace: TraceStep[];
  usage: AgentUsage;
  turns: number;
  error?: { code: AgentErrorCode; message: string; retryable: boolean };
};

export type AgentErrorCode = 'max_turns' | 'refusal' | 'max_tokens' | 'llm_error' | 'no_athlete' | 'empty_reply';

export type AgentRunInput = {
  kind: AgentKind;
  athleteId: string;
  runId: string;
  today: string;
  /** The task (analysis kickoff) or the athlete's new chat message. */
  userMessage: string;
  /** Earlier chat turns, oldest first (plain text). */
  history?: { role: 'user' | 'assistant'; content: string }[];
  profile?: AgentProfile;
};

const OUTPUT_PREVIEW = 4_000;

/** System blocks: static rules (cached for everyone), athlete context (cached per athlete/day), chat mode. */
export function buildSystem(kind: AgentKind, athleteContext: string): LlmTextBlockParam[] {
  const blocks: LlmTextBlockParam[] = [
    { type: 'text', text: COACH_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: athleteContext, cache_control: { type: 'ephemeral' } },
  ];
  if (kind === 'chat') blocks.push({ type: 'text', text: CHAT_INSTRUCTIONS });
  return blocks;
}

function buildMessages(input: AgentRunInput): LlmMessageParam[] {
  const history = (input.history ?? []).filter((m) => m.content.trim().length > 0);
  while (history.length && history[0]!.role !== 'user') history.shift(); // the API requires a user turn first
  return [...history.map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: input.userMessage }];
}

/**
 * The tool-use loop. Model calls are bounded by `maxTurns`; a rejected tool call goes back to the
 * model as `is_error` so it can correct itself. The history is append-only (assistant content is
 * passed back unchanged, thinking blocks included), which keeps both the prompt cache and the
 * model's reasoning valid across turns.
 */
export async function runCoachAgent(deps: { llm: LlmClient; data: CoachDataPort }, input: AgentRunInput): Promise<AgentResult> {
  const profile = input.profile ?? AGENT_PROFILES[input.kind];
  const ledger = new FactLedger();
  const trace: TraceStep[] = [];
  const usage: AgentUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const ctx: ToolContext = {
    data: deps.data,
    athleteId: input.athleteId,
    runId: input.runId,
    kind: input.kind,
    today: input.today,
    ledger,
    maxProposals: profile.maxProposals,
    proposalIds: [],
  };

  const result = (status: AgentResult['status'], turns: number, text = '', error?: AgentResult['error']): AgentResult => {
    const resolved = resolveCitations(text, ledger);
    return {
      status,
      model: profile.model,
      text: resolved.text.trim(),
      citations: resolved.citations,
      unknownCitations: resolved.unknown,
      proposalIds: ctx.proposalIds,
      trace,
      usage,
      turns,
      ...(error ? { error } : {}),
    };
  };

  const athlete = await deps.data.getAthlete(input.athleteId);
  if (!athlete) return result('failed', 0, '', { code: 'no_athlete', message: 'Athlete not found', retryable: false });

  const system = buildSystem(input.kind, buildAthleteContext(athlete, input.today));
  const tools = toolDefinitions();
  const messages = buildMessages(input);

  for (let turn = 1; turn <= profile.maxTurns; turn++) {
    let response: LlmMessage;
    try {
      response = await deps.llm.create({ profile, system, tools, messages });
    } catch (err) {
      // llm-client maps every SDK/network failure to LlmError; anything else is a bug and must surface.
      if (!(err instanceof LlmError)) throw err;
      return result('failed', turn, '', { code: 'llm_error', message: `${err.kind}: ${err.message}`, retryable: err.retryable });
    }
    addUsage(usage, response);
    trace.push({
      type: 'model',
      turn,
      stopReason: response.stop_reason,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    switch (response.stop_reason) {
      case 'refusal': {
        const category = response.stop_details?.category ?? 'unspecified';
        return result('failed', turn, '', { code: 'refusal', message: `Model declined (${category})`, retryable: false });
      }
      case 'max_tokens':
        // A tool input cut off here may parse as a valid partial object; never run it.
        return result('failed', turn, '', { code: 'max_tokens', message: 'Response hit max_tokens', retryable: false });
      case 'tool_use':
        break;
      default: {
        // end_turn / stop_sequence: the model is done.
        if (!text && ctx.proposalIds.length === 0) return result('failed', turn, '', { code: 'empty_reply', message: 'Model ended without a reply', retryable: true });
        return result('succeeded', turn, text);
      }
    }

    const calls = response.content.filter((b): b is LlmToolUseBlock => b.type === 'tool_use');
    messages.push({ role: 'assistant', content: response.content });

    // Sequential on purpose: create_proposal writes, and a later call may depend on an earlier one.
    const results: LlmToolResultBlockParam[] = [];
    for (const call of calls) {
      const started = Date.now();
      const r = await dispatchTool(ctx, call.name, call.input);
      trace.push({ type: 'tool', turn, tool: call.name, input: call.input, isError: r.isError, output: r.content.slice(0, OUTPUT_PREVIEW), ms: Date.now() - started });
      results.push({ type: 'tool_result', tool_use_id: call.id, content: r.content, ...(r.isError ? { is_error: true } : {}) });
    }
    // All results of a turn go back in one user message.
    messages.push({ role: 'user', content: results });
  }

  return result('failed', profile.maxTurns, '', { code: 'max_turns', message: `No final answer after ${profile.maxTurns} model turns`, retryable: false });
}

function addUsage(u: AgentUsage, r: LlmMessage): void {
  u.inputTokens += r.usage.input_tokens;
  u.outputTokens += r.usage.output_tokens;
  u.cacheReadTokens += r.usage.cache_read_input_tokens ?? 0;
  u.cacheWriteTokens += r.usage.cache_creation_input_tokens ?? 0;
}
