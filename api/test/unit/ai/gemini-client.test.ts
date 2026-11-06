import { ApiError, FinishReason, type GenerateContentParameters, type GenerateContentResponse } from '@google/genai';
import { describe, expect, it } from 'vitest';
import { GeminiLlmClient, toContents } from '../../../src/ai/gemini-client.js';
import { LlmError, type LlmMessageParam, type LlmRequest } from '../../../src/ai/llm-client.js';
import { AGENT_PROFILES } from '../../../src/ai/models.js';
import { selectLlmProvider } from '../../../src/config/ai.js';

const res = (r: object) => r as unknown as GenerateContentResponse;
const textResponse = (text: string, finishReason: string = FinishReason.STOP) => res({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason }] });

function client(responses: GenerateContentResponse[] | (() => Promise<GenerateContentResponse>)) {
  const calls: GenerateContentParameters[] = [];
  const queue = Array.isArray(responses) ? [...responses] : null;
  const llm = new GeminiLlmClient({
    generate: async (p) => {
      calls.push(structuredClone(p));
      if (!queue) return (responses as () => Promise<GenerateContentResponse>)();
      const next = queue.shift();
      if (!next) throw new Error('no scripted response');
      return next;
    },
  });
  return { llm, calls };
}

const request = (over: Partial<LlmRequest> = {}): LlmRequest => ({
  profile: AGENT_PROFILES.weekly,
  system: [
    { type: 'text', text: 'RULES' },
    { type: 'text', text: 'ATHLETE CONTEXT' },
  ],
  tools: [{ name: 'get_week_summary', description: 'Week summary', input_schema: { type: 'object', properties: { weekStart: { type: 'string' } }, additionalProperties: false } }],
  messages: [{ role: 'user', content: 'Review the week.' }],
  ...over,
});

describe('GeminiLlmClient: request translation', () => {
  it('maps system, tools (JSON Schema), effort and the model tier, and never auto-calls functions', async () => {
    const { llm, calls } = client([textResponse('ok')]);
    await llm.create(request());
    const p = calls[0]!;
    expect(p.model).toBe('gemini-2.5-flash'); // weekly = smart tier
    expect(p.config?.systemInstruction).toBe('RULES\n\nATHLETE CONTEXT');
    expect(p.config?.tools).toEqual([
      { functionDeclarations: [{ name: 'get_week_summary', description: 'Week summary', parametersJsonSchema: { type: 'object', properties: { weekStart: { type: 'string' } }, additionalProperties: false } }] },
    ]);
    expect(p.config?.thinkingConfig).toEqual({ thinkingBudget: 4096 }); // effort medium on a 2.x model
    expect(p.config?.automaticFunctionCalling).toEqual({ disable: true });
    expect(p.contents).toEqual([{ role: 'user', parts: [{ text: 'Review the week.' }] }]);

    const fast = client([textResponse('ok')]);
    await fast.llm.create(request({ profile: AGENT_PROFILES.post_activity }));
    expect(fast.calls[0]!.model).toBe('gemini-2.5-flash-lite');
  });

  it('uses thinking levels on Gemini 3 models and honours model overrides', async () => {
    const calls: GenerateContentParameters[] = [];
    const llm = new GeminiLlmClient({ generate: async (p) => (calls.push(p), textResponse('ok')), models: { smart: 'gemini-3-flash' } });
    await llm.create(request({ profile: AGENT_PROFILES.chat }));
    expect(calls[0]!.model).toBe('gemini-3-flash');
    expect(calls[0]!.config?.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
    expect(llm.modelFor(AGENT_PROFILES.chat)).toBe('gemini-3-flash');
  });
});

describe('GeminiLlmClient: response translation', () => {
  it('turns function calls into tool_use blocks and keeps thought signatures for the next turn', async () => {
    const { llm } = client([
      res({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { functionCall: { name: 'get_week_summary', args: {} }, thoughtSignature: 'sig-1' },
                { functionCall: { name: 'get_calendar', args: { weeks: 2 } } },
              ],
            },
            finishReason: FinishReason.STOP,
          },
        ],
        usageMetadata: { promptTokenCount: 1200, cachedContentTokenCount: 1000, candidatesTokenCount: 40, thoughtsTokenCount: 60 },
        modelVersion: 'gemini-2.5-flash',
      }),
    ]);
    const msg = await llm.create(request());
    expect(msg.stop_reason).toBe('tool_use');
    expect(msg.content).toMatchObject([
      { type: 'tool_use', name: 'get_week_summary', input: {}, gemini_signature: 'sig-1' },
      { type: 'tool_use', name: 'get_calendar', input: { weeks: 2 } },
    ]);
    // Same meaning as Claude usage: input excludes cache reads; output includes thinking.
    expect(msg.usage).toMatchObject({ input_tokens: 200, cache_read_input_tokens: 1000, output_tokens: 100 });

    // The loop appends assistant content unchanged and answers with tool_result blocks.
    const [a, b] = msg.content as unknown as { id: string }[];
    const history = [
      { role: 'user', content: 'Review the week.' },
      { role: 'assistant', content: msg.content },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: a!.id, content: '{"facts":[{"id":"wk:2026-11-02:acwr","value":1.24}]}' },
          { type: 'tool_result', tool_use_id: b!.id, content: '{"error":"bad input"}', is_error: true },
        ],
      },
    ] as unknown as LlmMessageParam[];
    expect(toContents(history)).toEqual([
      { role: 'user', parts: [{ text: 'Review the week.' }] },
      {
        role: 'model',
        parts: [
          { functionCall: { name: 'get_week_summary', args: {} }, thoughtSignature: 'sig-1' },
          { functionCall: { name: 'get_calendar', args: { weeks: 2 } } },
        ],
      },
      {
        role: 'user',
        parts: [
          { functionResponse: { name: 'get_week_summary', response: { output: { facts: [{ id: 'wk:2026-11-02:acwr', value: 1.24 }] } } } },
          { functionResponse: { name: 'get_calendar', response: { error: { error: 'bad input' } } } },
        ],
      },
    ]);
  });

  it('passes Gemini-issued call ids back unchanged', () => {
    const contents = toContents([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call-abc', name: 'get_history', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-abc', content: '{"weeks":[]}' }] },
    ] as unknown as LlmMessageParam[]);
    expect(contents[0]!.parts![0]!.functionCall).toEqual({ id: 'call-abc', name: 'get_history', args: {} });
    expect(contents[1]!.parts![0]!.functionResponse).toEqual({ id: 'call-abc', name: 'get_history', response: { output: { weeks: [] } } });
  });

  it('maps finish reasons to the stop reasons the loop handles', async () => {
    const stop = async (r: GenerateContentResponse) => (await client([r]).llm.create(request())).stop_reason;
    expect(await stop(textResponse('Done.'))).toBe('end_turn');
    expect(await stop(textResponse('Cut', FinishReason.MAX_TOKENS))).toBe('max_tokens');
    expect(await stop(textResponse('', FinishReason.SAFETY))).toBe('refusal');
    expect(await stop(res({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }))).toBe('refusal');
    const refused = await client([textResponse('', FinishReason.SAFETY)]).llm.create(request());
    expect(refused.stop_details).toMatchObject({ type: 'refusal', category: 'safety' });
  });

  it('maps API errors to LlmError with the retry decision', async () => {
    const fail = (err: unknown) => client(async () => Promise.reject(err)).llm.create(request());
    await expect(fail(new ApiError({ message: 'quota', status: 429 }))).rejects.toMatchObject({ kind: 'rate_limited', retryable: true, status: 429 });
    await expect(fail(new ApiError({ message: 'bad', status: 400 }))).rejects.toMatchObject({ kind: 'bad_request', retryable: false });
    await expect(fail(new ApiError({ message: 'key', status: 403 }))).rejects.toMatchObject({ kind: 'auth', retryable: false });
    await expect(fail(new ApiError({ message: 'busy', status: 503 }))).rejects.toMatchObject({ kind: 'overloaded', retryable: true });
    await expect(fail(new TypeError('fetch failed'))).rejects.toBeInstanceOf(LlmError);
    await expect(fail(new TypeError('fetch failed'))).rejects.toMatchObject({ kind: 'connection', retryable: true });
  });
});

describe('provider selection', () => {
  it('prefers Claude, falls back to Gemini, and honours LLM_PROVIDER', () => {
    expect(selectLlmProvider({ ANTHROPIC_API_KEY: 'a', VOYAGE_API_KEY: undefined, GEMINI_API_KEY: 'g' })).toBe('anthropic');
    expect(selectLlmProvider({ ANTHROPIC_API_KEY: undefined, VOYAGE_API_KEY: undefined, GEMINI_API_KEY: 'g' })).toBe('gemini');
    expect(selectLlmProvider({ ANTHROPIC_API_KEY: 'a', VOYAGE_API_KEY: undefined, GEMINI_API_KEY: 'g', LLM_PROVIDER: 'gemini' })).toBe('gemini');
    expect(selectLlmProvider({ ANTHROPIC_API_KEY: undefined, VOYAGE_API_KEY: undefined, GEMINI_API_KEY: 'g', LLM_PROVIDER: 'anthropic' })).toBeNull();
    expect(selectLlmProvider({ ANTHROPIC_API_KEY: undefined, VOYAGE_API_KEY: undefined })).toBeNull();
  });
});
