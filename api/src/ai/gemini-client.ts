import { ApiError, FinishReason, GoogleGenAI, ThinkingLevel, type Content, type GenerateContentParameters, type GenerateContentResponse, type Part } from '@google/genai';
import { LlmError, type LlmClient, type LlmMessage, type LlmMessageParam, type LlmRequest, type ModelProfile } from './llm-client.js';

/**
 * The only file that imports the Google Gen AI SDK. A second `LlmClient` behind the same interface
 * as Claude: the agent loop, tools, fact ledger and guardrails are unchanged. This adapter
 * translates the Messages-API shapes the loop speaks (tool_use / tool_result blocks, append-only
 * history) to Gemini function calling and back.
 *
 * Thought signatures: Gemini attaches an opaque `thoughtSignature` to parts and expects it back on
 * the next turn. The loop appends assistant content unchanged, so the signature rides along on the
 * converted block (`gemini_signature`) and is restored here. Claude never sees these blocks: the
 * provider is fixed per process, and chat history is stored as plain text.
 */

export type GeminiModels = { fast: string; smart: string };

/** Defaults for the Gemini API free tier; override with GEMINI_MODEL_FAST / GEMINI_MODEL_SMART. */
export const DEFAULT_GEMINI_MODELS: GeminiModels = { fast: 'gemini-2.5-flash-lite', smart: 'gemini-2.5-flash' };

type GenerateFn = (params: GenerateContentParameters) => Promise<GenerateContentResponse>;

/** Extra fields this adapter puts on Messages-API blocks so they survive the round trip. */
type GeminiExtras = { gemini_signature?: string };

const CALL_ID_PREFIX = 'gemini_call_';
const REFUSAL_REASONS = new Set<string>([FinishReason.SAFETY, FinishReason.PROHIBITED_CONTENT, FinishReason.BLOCKLIST, FinishReason.SPII, FinishReason.RECITATION, FinishReason.IMAGE_SAFETY]);

export class GeminiLlmClient implements LlmClient {
  private readonly generate: GenerateFn;
  private seq = 0;

  /** `generate` is injectable so tests can check the translation without the network. */
  constructor(
    opts: { apiKey: string; models?: Partial<GeminiModels>; timeoutMs?: number } | { generate: GenerateFn; models?: Partial<GeminiModels> },
  ) {
    this.models = { ...DEFAULT_GEMINI_MODELS, ...opts.models };
    if ('generate' in opts) {
      this.generate = opts.generate;
    } else {
      const ai = new GoogleGenAI({ apiKey: opts.apiKey, httpOptions: { timeout: opts.timeoutMs ?? 300_000 } });
      this.generate = (params) => ai.models.generateContent(params);
    }
  }

  readonly models: GeminiModels;

  modelFor(profile: ModelProfile): string {
    return profile.tier === 'fast' ? this.models.fast : this.models.smart;
  }

  async create(req: LlmRequest): Promise<LlmMessage> {
    const model = this.modelFor(req.profile);
    const params: GenerateContentParameters = {
      model,
      contents: toContents(req.messages),
      config: {
        systemInstruction: req.system.map((b) => b.text).join('\n\n'),
        tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.input_schema })) }],
        maxOutputTokens: req.profile.maxTokens,
        thinkingConfig: thinkingFor(model, req.profile.effort),
        // The loop runs the tools itself (and validates them); never let the SDK call anything.
        automaticFunctionCalling: { disable: true },
      },
    };
    let res: GenerateContentResponse;
    try {
      res = await this.generate(params);
    } catch (err) {
      throw toLlmError(err);
    }
    return this.toMessage(res, model);
  }

  private toMessage(res: GenerateContentResponse, model: string): LlmMessage {
    const candidate = res.candidates?.[0];
    const content: Record<string, unknown>[] = [];
    for (const part of candidate?.content?.parts ?? []) {
      if (part.thought) continue; // thought summaries are not requested; skip if any arrive
      const extras: GeminiExtras = part.thoughtSignature ? { gemini_signature: part.thoughtSignature } : {};
      if (part.functionCall) {
        content.push({ type: 'tool_use', id: part.functionCall.id ?? `${CALL_ID_PREFIX}${++this.seq}`, name: part.functionCall.name ?? '', input: part.functionCall.args ?? {}, ...extras });
      } else if (typeof part.text === 'string') {
        content.push({ type: 'text', text: part.text, citations: null, ...extras });
      }
    }

    const finish = candidate?.finishReason;
    let stop: string;
    if (!candidate && res.promptFeedback?.blockReason) stop = 'refusal';
    else if (content.some((b) => b.type === 'tool_use')) stop = 'tool_use';
    else if (finish === FinishReason.MAX_TOKENS) stop = 'max_tokens';
    else if (finish && REFUSAL_REASONS.has(finish)) stop = 'refusal';
    else stop = 'end_turn';

    const u = res.usageMetadata ?? {};
    const cached = u.cachedContentTokenCount ?? 0;
    return {
      id: res.responseId ?? `gemini_msg_${++this.seq}`,
      type: 'message',
      role: 'assistant',
      model: res.modelVersion ?? model,
      content,
      stop_reason: stop,
      stop_sequence: null,
      stop_details: stop === 'refusal' ? { type: 'refusal', category: (finish ?? res.promptFeedback?.blockReason ?? 'unspecified').toLowerCase(), explanation: null } : null,
      usage: {
        // Same meaning as Claude's usage: input excludes cache reads, output includes thinking.
        input_tokens: Math.max(0, (u.promptTokenCount ?? 0) - cached),
        output_tokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
        cache_read_input_tokens: cached,
        cache_creation_input_tokens: 0,
      },
    } as unknown as LlmMessage;
  }
}

/** Effort → Gemini thinking: levels on Gemini 3 and later, token budgets on 2.x. */
function thinkingFor(model: string, effort: ModelProfile['effort']) {
  if (/^gemini-[12]\./.test(model)) return { thinkingBudget: { low: 1024, medium: 4096, high: 8192 }[effort] };
  return { thinkingLevel: { low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM, high: ThinkingLevel.HIGH }[effort] };
}

type Block = { type: string; [k: string]: unknown };

/** Messages-API history → Gemini contents. Tool results need the function name, so track ids. */
export function toContents(messages: LlmMessageParam[]): Content[] {
  const names = new Map<string, string>();
  const contents: Content[] = [];
  for (const m of messages) {
    const blocks: Block[] = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (m.content as unknown as Block[]);
    const parts: Part[] = [];
    for (const b of blocks) {
      const signature = (b as GeminiExtras).gemini_signature;
      const sig = signature ? { thoughtSignature: signature } : {};
      if (b.type === 'text') {
        parts.push({ text: String(b.text ?? ''), ...sig });
      } else if (b.type === 'tool_use') {
        const id = String(b.id);
        names.set(id, String(b.name));
        // Our own placeholder ids are not Gemini's; send them only when Gemini issued them.
        parts.push({ functionCall: { name: String(b.name), args: (b.input ?? {}) as Record<string, unknown>, ...(id.startsWith(CALL_ID_PREFIX) ? {} : { id }) }, ...sig });
      } else if (b.type === 'tool_result') {
        const id = String(b.tool_use_id);
        const body = parseToolOutput(b.content);
        parts.push({
          functionResponse: { name: names.get(id) ?? 'unknown_tool', ...(id.startsWith(CALL_ID_PREFIX) ? {} : { id }), response: b.is_error ? { error: body } : { output: body } },
        });
      }
      // thinking / redacted_thinking blocks are Claude-only and never produced by this adapter.
    }
    if (parts.length) contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
  }
  return contents;
}

/** Tool results are JSON strings (see tools/registry.ts); Gemini wants a JSON value, not text. */
function parseToolOutput(content: unknown): unknown {
  const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((c: { text?: string }) => c.text ?? '').join('') : '';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toLlmError(err: unknown): LlmError {
  if (err instanceof ApiError) {
    const s = err.status;
    if (s === 429) return new LlmError(err.message, 'rate_limited', true, s);
    if (s === 401 || s === 403) return new LlmError(err.message, 'auth', false, s);
    if (s === 400 || s === 404 || s === 422) return new LlmError(err.message, 'bad_request', false, s);
    if (s >= 500) return new LlmError(err.message, 'overloaded', true, s);
    return new LlmError(err.message, 'unknown', false, s);
  }
  const msg = err instanceof Error ? err.message : String(err);
  // fetch failures and timeouts surface as plain errors from the SDK.
  if (/fetch failed|ECONN|ETIMEDOUT|timeout|aborted/i.test(msg)) return new LlmError(msg, 'connection', true);
  return new LlmError(msg, 'unknown', false);
}
