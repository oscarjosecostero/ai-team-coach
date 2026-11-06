import { AnthropicLlmClient, type LlmClient } from '../ai/llm-client.js';
import type { EmbeddingProvider } from '../integrations/embeddings/embedding-provider.js';
import { VoyageEmbeddingProvider } from '../integrations/embeddings/voyage.js';
import type { Env } from './env.js';

/** Builds the AI adapters from env. Either can be null; the app degrades instead of crashing. */
export function createAiAdapters(env: Pick<Env, 'ANTHROPIC_API_KEY' | 'VOYAGE_API_KEY'>): { llm: LlmClient | null; embeddings: EmbeddingProvider | null } {
  return {
    llm: env.ANTHROPIC_API_KEY ? new AnthropicLlmClient(env.ANTHROPIC_API_KEY) : null,
    embeddings: env.VOYAGE_API_KEY ? new VoyageEmbeddingProvider(env.VOYAGE_API_KEY) : null,
  };
}
