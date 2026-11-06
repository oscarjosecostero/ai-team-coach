import { GeminiLlmClient } from '../ai/gemini-client.js';
import { AnthropicLlmClient, type LlmClient } from '../ai/llm-client.js';
import type { EmbeddingProvider } from '../integrations/embeddings/embedding-provider.js';
import { VoyageEmbeddingProvider } from '../integrations/embeddings/voyage.js';
import type { Env } from './env.js';

type AiEnv = Pick<Env, 'ANTHROPIC_API_KEY' | 'VOYAGE_API_KEY'> & Partial<Pick<Env, 'GEMINI_API_KEY' | 'GEMINI_MODEL_FAST' | 'GEMINI_MODEL_SMART' | 'LLM_PROVIDER'>>;

/** Which LLM provider to use. `auto` prefers Claude, then Gemini; null means AI routes answer 503. */
export function selectLlmProvider(env: AiEnv): 'anthropic' | 'gemini' | null {
  const provider = env.LLM_PROVIDER ?? 'auto';
  if (provider === 'anthropic') return env.ANTHROPIC_API_KEY ? 'anthropic' : null;
  if (provider === 'gemini') return env.GEMINI_API_KEY ? 'gemini' : null;
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  return env.GEMINI_API_KEY ? 'gemini' : null;
}

/** Builds the AI adapters from env. Either can be null; the app degrades instead of crashing. */
export function createAiAdapters(env: AiEnv): { llm: LlmClient | null; embeddings: EmbeddingProvider | null } {
  const provider = selectLlmProvider(env);
  let llm: LlmClient | null = null;
  if (provider === 'anthropic') llm = new AnthropicLlmClient(env.ANTHROPIC_API_KEY!);
  if (provider === 'gemini') {
    llm = new GeminiLlmClient({
      apiKey: env.GEMINI_API_KEY!,
      models: { ...(env.GEMINI_MODEL_FAST ? { fast: env.GEMINI_MODEL_FAST } : {}), ...(env.GEMINI_MODEL_SMART ? { smart: env.GEMINI_MODEL_SMART } : {}) },
    });
  }
  return { llm, embeddings: env.VOYAGE_API_KEY ? new VoyageEmbeddingProvider(env.VOYAGE_API_KEY) : null };
}
