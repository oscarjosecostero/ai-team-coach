import { describe, expect, it } from 'vitest';
import { runCoachAgent } from '../../../src/ai/coach-agent.js';
import { extractCitations, FactLedger, resolveCitations } from '../../../src/ai/facts.js';
import { LlmError, type LlmMessage } from '../../../src/ai/llm-client.js';
import type { CoachDataPort } from '../../../src/ai/ports.js';
import { dispatchTool, toolDefinitions, TOOL_NAMES } from '../../../src/ai/tools/registry.js';
import { formatPace } from '../../../src/ai/tools/read-tools.js';
import type { ToolContext } from '../../../src/ai/tools/types.js';
import { reply, ScriptedLlm, toolCalls } from '../../helpers/fake-llm.js';

/** In-memory port: enough data for the read tools, and a createProposal that must never be reached here. */
function fakePort(over: Partial<CoachDataPort> = {}): CoachDataPort {
  return {
    getAthlete: async (id) => ({
      id,
      name: 'Test Athlete',
      profile: { goal: 'Finish a sprint', raceName: 'Test Race', raceDate: '2026-12-01', raceType: 'sprint', level: 'beginner', availableDays: [2, 4, 6], maxHr: 190, lthr: 170, restingHrBaseline: 55, hrZones: { z1Max: 140, z2Max: 152, z3Max: 160, z4Max: 170 } },
    }),
    listWeeks: async () => [
      { weekStart: '2026-11-02', totalDurationS: 3600 * 5, totalDistanceBySport: { run: 30000 }, totalLoad: 400, loadChangePct: 12.5, atl: 60, ctl: 50, tsb: -10, acwr: 1.2, lowIntensityPct: 75, highIntensityPct: 25, hardSessions: 2, maxConsecutiveHardDays: 2, avgRestingHr: 57.25, restingHrDelta: 2.25 },
    ],
    listActivities: async () => [],
    listCheckins: async () => [],
    listPlannedWorkouts: async () => [],
    listOpenProposalWorkoutIds: async () => [],
    getInjurySignal: async () => ({ flag: false, reasons: [] }),
    searchNotes: async () => ({ hits: [], mode: 'text' }),
    createProposal: async () => {
      throw new Error('not expected');
    },
    ...over,
  };
}

const ctx = (data = fakePort()): ToolContext => ({ data, athleteId: 'a1', runId: 'r1', kind: 'weekly', today: '2026-11-06', ledger: new FactLedger(), maxProposals: 1, proposalIds: [] });

describe('FactLedger and citations', () => {
  it('resolves known ids and reports unknown ones (deduplicated)', () => {
    const l = new FactLedger();
    l.add({ id: 'wk:2026-11-02:acwr', label: 'ACWR', value: 1.2 });
    expect(l.resolve(['wk:2026-11-02:acwr', 'x:y', 'x:y'])).toEqual({ found: [{ id: 'wk:2026-11-02:acwr', label: 'ACWR', value: 1.2 }], unknown: ['x:y'] });
  });

  it('strips unknown inline citations and keeps punctuation tidy', () => {
    const l = new FactLedger();
    l.add({ id: 'wk:2026-11-02:acwr', label: 'ACWR', value: 1.2 });
    const text = 'Ratio [[wk:2026-11-02:acwr]], VO2 [[wk:2026-11-02:vo2]].';
    expect(extractCitations(text)).toEqual(['wk:2026-11-02:acwr', 'wk:2026-11-02:vo2']);
    expect(resolveCitations(text, l)).toMatchObject({ text: 'Ratio [[wk:2026-11-02:acwr]], VO2.', unknown: ['wk:2026-11-02:vo2'] });
  });
});

describe('tool registry', () => {
  it('exposes exactly the allowlist, in a fixed order, as plain JSON schema', () => {
    const defs = toolDefinitions();
    expect(defs.map((d) => d.name)).toEqual(TOOL_NAMES);
    expect(toolDefinitions()).toBe(defs); // built once: byte-identical across requests (prompt cache)
    const proposal = defs.find((d) => d.name === 'create_proposal')!;
    expect(proposal.input_schema).toMatchObject({ type: 'object', additionalProperties: false, required: ['workoutId', 'changeType', 'change', 'reason', 'evidenceFactIds', 'confidence'] });
    expect(JSON.stringify(defs)).not.toMatch(/9007199254740991|\$schema/);
  });

  it('returns errors (never throws) for unknown tools and invalid input', async () => {
    expect(await dispatchTool(ctx(), 'delete_plan', {})).toMatchObject({ isError: true });
    const bad = await dispatchTool(ctx(), 'get_history', { weeks: 99 });
    expect(bad.isError).toBe(true);
    expect(JSON.parse(bad.content).issues[0].path).toBe('weeks');
    expect(await dispatchTool(ctx(), 'get_history', 'not json')).toMatchObject({ isError: true });
  });

  it('registers returned facts in the ledger, with backend formatting', async () => {
    const c = ctx();
    const r = await dispatchTool(c, 'get_week_summary', {});
    expect(r.isError).toBe(false);
    expect(c.ledger.get('wk:2026-11-02:avg_resting_hr')?.value).toBe(57.3);
    expect(c.ledger.get('profile:days_to_race')?.value).toBe(25);
    expect(c.ledger.get('signal:injury')?.value).toBe('none');
    expect(formatPace(312)).toBe('5:12');
    expect(formatPace(359.7)).toBe('6:00');
  });

  it('refuses create_proposal before the model has seen the workout in get_calendar', async () => {
    const r = await dispatchTool(ctx(), 'create_proposal', {
      workoutId: '6f1c8a1e-6a5b-4d7f-9b0e-1c2d3e4f5a6b',
      changeType: 'rest',
      change: {},
      reason: 'Rest is needed after a hard week of training.',
      evidenceFactIds: ['signal:injury'],
      confidence: 0.5,
    });
    expect(JSON.parse(r.content).error).toMatch(/Unknown workoutId/);
  });
});

describe('agent loop', () => {
  it('passes assistant content back unchanged (thinking blocks included) and keeps history append-only', async () => {
    const thinking = { type: 'thinking', thinking: '', signature: 'sig-abc' };
    const first = toolCalls({ name: 'get_history', input: { weeks: 4 } });
    (first.content as unknown[]).unshift(thinking);
    const llm = new ScriptedLlm([() => first, reply('Steady progress [[wk:2026-11-02:ctl]].')]);

    const result = await runCoachAgent({ llm, data: fakePort() }, { kind: 'weekly', athleteId: 'a1', runId: 'r1', today: '2026-11-06', userMessage: 'Weekly review.' });
    expect(result).toMatchObject({ status: 'succeeded', turns: 2, text: 'Steady progress [[wk:2026-11-02:ctl]].' });
    expect(result.citations[0]).toMatchObject({ id: 'wk:2026-11-02:ctl', value: 50 });

    const [r1, r2] = llm.requests;
    expect(r2!.messages.slice(0, r1!.messages.length)).toEqual(r1!.messages); // prefix unchanged
    expect(r2!.messages[1]).toEqual({ role: 'assistant', content: first.content }); // thinking block kept as-is
    expect(r2!.messages[2]!.role).toBe('user');
    expect(r2!.system).toEqual(r1!.system);
    expect(r2!.tools).toEqual(r1!.tools);
    expect(result.usage).toEqual({ inputTokens: 2000, outputTokens: 200, cacheReadTokens: 1600, cacheWriteTokens: 0 });
  });

  it('turns API failures into a failed run with a retryable flag', async () => {
    const llm = { create: async (): Promise<LlmMessage> => { throw new LlmError('overloaded', 'overloaded', true, 529); } };
    const result = await runCoachAgent({ llm, data: fakePort() }, { kind: 'chat', athleteId: 'a1', runId: 'r1', today: '2026-11-06', userMessage: 'hi' });
    expect(result).toMatchObject({ status: 'failed', error: { code: 'llm_error', retryable: true } });
  });

  it('fails on max_tokens instead of running a possibly truncated tool call', async () => {
    const truncated = toolCalls({ name: 'create_proposal', input: { workoutId: 'x' } });
    (truncated as { stop_reason: string }).stop_reason = 'max_tokens';
    const llm = new ScriptedLlm([() => truncated]);
    const result = await runCoachAgent({ llm, data: fakePort() }, { kind: 'chat', athleteId: 'a1', runId: 'r1', today: '2026-11-06', userMessage: 'hi' });
    expect(result).toMatchObject({ status: 'failed', error: { code: 'max_tokens' } });
    expect(result.trace.filter((s) => s.type === 'tool')).toHaveLength(0);
  });

  it('drops a leading assistant turn from chat history (the API needs a user turn first)', async () => {
    const llm = new ScriptedLlm([reply('ok')]);
    await runCoachAgent(
      { llm, data: fakePort() },
      { kind: 'chat', athleteId: 'a1', runId: 'r1', today: '2026-11-06', userMessage: 'new', history: [{ role: 'assistant', content: 'orphan' }, { role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }] },
    );
    expect(llm.requests[0]!.messages.map((m) => m.content)).toEqual(['q', 'a', 'new']);
  });
});
