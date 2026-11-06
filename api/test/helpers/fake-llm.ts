import type { LlmClient, LlmMessage, LlmRequest } from '../../src/ai/llm-client.js';

/** One scripted model turn. Gets the request (so it can read earlier tool results) and returns a response. */
export type Step = (req: LlmRequest) => LlmMessage;

/** Deterministic stand-in for Claude: plays a script of turns and records every request it got. */
export class ScriptedLlm implements LlmClient {
  readonly requests: LlmRequest[] = [];
  constructor(private readonly steps: Step[] | ((req: LlmRequest, turn: number) => LlmMessage)) {}

  async create(req: LlmRequest): Promise<LlmMessage> {
    this.requests.push(structuredClone(req));
    const turn = this.requests.length;
    if (typeof this.steps === 'function') return this.steps(req, turn);
    const step = this.steps[turn - 1];
    if (!step) throw new Error(`fake LLM script exhausted at turn ${turn}`);
    return step(req);
  }
}

let seq = 0;
function message(content: unknown[], stopReason: string, extra: Record<string, unknown> = {}): LlmMessage {
  return {
    id: `msg_fake_${++seq}`,
    type: 'message',
    role: 'assistant',
    model: 'fake-model',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 },
    ...extra,
  } as unknown as LlmMessage;
}

export const toolCalls = (...calls: { name: string; input: unknown }[]): LlmMessage =>
  message(
    calls.map((c) => ({ type: 'tool_use', id: `toolu_${++seq}`, name: c.name, input: c.input })),
    'tool_use',
  );

export const call = (name: string, input: unknown = {}): Step => () => toolCalls({ name, input });
export const reply = (text: string): Step => () => message([{ type: 'text', text }], 'end_turn');
export const refusal = (): Step => () => message([], 'refusal', { stop_details: { type: 'refusal', category: 'cyber', explanation: null } });

/** Tool results sent back in the latest user turn, parsed. */
export function lastToolResults(req: LlmRequest): { isError: boolean; body: Record<string, unknown> }[] {
  const last = req.messages.at(-1);
  if (!last || last.role !== 'user' || typeof last.content === 'string') return [];
  return last.content
    .filter((b) => b.type === 'tool_result')
    .map((b) => {
      const r = b as { is_error?: boolean; content?: unknown };
      return { isError: Boolean(r.is_error), body: JSON.parse(String(r.content)) as Record<string, unknown> };
    });
}

/** All tool results the model has received so far in this run, in order. */
export function allToolResults(req: LlmRequest) {
  return req.messages.flatMap((m) =>
    m.role === 'user' && typeof m.content !== 'string'
      ? m.content
          .filter((b) => b.type === 'tool_result')
          .map((b) => {
            const r = b as { is_error?: boolean; content?: unknown };
            return { isError: Boolean(r.is_error), body: JSON.parse(String(r.content)) as Record<string, unknown> };
          })
      : [],
  );
}

type CalendarWorkout = { workoutId: string; date: string; workoutType: string; title: string; durationMin: number };

/** Finds a workout in the latest get_calendar result. */
export function workoutFrom(req: LlmRequest, pick: (w: CalendarWorkout) => boolean): CalendarWorkout {
  const cal = allToolResults(req)
    .map((r) => r.body)
    .reverse()
    .find((b) => Array.isArray(b.workouts));
  const w = (cal?.workouts as CalendarWorkout[] | undefined)?.find(pick);
  if (!w) throw new Error('workout not found in calendar result');
  return w;
}
