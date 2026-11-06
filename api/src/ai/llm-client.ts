import Anthropic from '@anthropic-ai/sdk';

/**
 * The only file that imports the Anthropic SDK. Everything else in ai/ talks to `LlmClient`,
 * which tests replace with a scripted fake. SDK types are re-exported (not redefined) so the
 * agent loop can pass assistant content back to the API unchanged, including thinking blocks.
 */
export type LlmMessage = Anthropic.Beta.BetaMessage;
export type LlmMessageParam = Anthropic.Beta.BetaMessageParam;
export type LlmContentBlock = Anthropic.Beta.BetaContentBlock;
export type LlmTool = Anthropic.Beta.BetaTool;
export type LlmToolUseBlock = Anthropic.Beta.BetaToolUseBlock;
export type LlmToolResultBlockParam = Anthropic.Beta.BetaToolResultBlockParam;
export type LlmTextBlockParam = Anthropic.Beta.BetaTextBlockParam;
export type LlmUsage = Anthropic.Beta.BetaUsage;

export type ModelProfile = {
  /** Claude model ID (the default provider). */
  model: string;
  /** Provider-neutral size class: other adapters map it to their own models (e.g. Gemini Flash-Lite / Flash). */
  tier: 'fast' | 'smart';
  effort: 'low' | 'medium' | 'high';
  maxTokens: number;
  /**
   * Server-side refusal fallback (`fallbacks: "default"`). Claude API only; not available for
   * Claude Haiku 5.5, so it is off for that profile.
   */
  refusalFallback: boolean;
};

export type LlmRequest = {
  profile: ModelProfile;
  system: LlmTextBlockParam[];
  tools: LlmTool[];
  messages: LlmMessageParam[];
};

export interface LlmClient {
  create(req: LlmRequest): Promise<LlmMessage>;
  /** The model this client actually calls for a profile (recorded in agent_runs). Defaults to `profile.model`. */
  modelFor?(profile: ModelProfile): string;
}

export type LlmErrorKind = 'rate_limited' | 'overloaded' | 'connection' | 'auth' | 'bad_request' | 'unknown';

/** SDK errors mapped to what the caller needs to decide: log, fail the run, or let the job retry. */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: LlmErrorKind,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
  }
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic;

  constructor(apiKey: string, opts: { timeoutMs?: number; maxRetries?: number } = {}) {
    // The SDK already retries 408/409/429/5xx and connection errors with backoff.
    this.client = new Anthropic({ apiKey, timeout: opts.timeoutMs ?? 300_000, maxRetries: opts.maxRetries ?? 3 });
  }

  modelFor(profile: ModelProfile): string {
    return profile.model;
  }

  async create(req: LlmRequest): Promise<LlmMessage> {
    const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
      model: req.profile.model,
      max_tokens: req.profile.maxTokens,
      system: req.system,
      tools: req.tools,
      messages: req.messages,
      // Adaptive thinking is the default on these models; effort is the depth/cost lever.
      output_config: { effort: req.profile.effort },
      // Automatic caching of the growing conversation, on top of the system breakpoints.
      cache_control: { type: 'ephemeral' },
      ...(req.profile.refusalFallback ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
    };
    try {
      return await this.client.beta.messages.create(params);
    } catch (err) {
      throw toLlmError(err);
    }
  }
}

function toLlmError(err: unknown): LlmError {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new LlmError(err.message, 'auth', false, err.status);
  }
  if (err instanceof Anthropic.RateLimitError) return new LlmError(err.message, 'rate_limited', true, err.status);
  if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.UnprocessableEntityError || err instanceof Anthropic.NotFoundError) {
    return new LlmError(err.message, 'bad_request', false, err.status);
  }
  if (err instanceof Anthropic.InternalServerError) return new LlmError(err.message, 'overloaded', true, err.status);
  if (err instanceof Anthropic.APIConnectionError) return new LlmError(err.message, 'connection', true);
  if (err instanceof Anthropic.APIError) return new LlmError(err.message, 'unknown', false, err.status);
  return new LlmError(err instanceof Error ? err.message : String(err), 'unknown', false);
}
