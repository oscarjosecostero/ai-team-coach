/** Turns text into vectors for semantic search over the athlete's notes ("the brain"). */
export interface EmbeddingProvider {
  /** Identifier stored next to each vector, so a model change can be detected and re-embedded. */
  readonly model: string;
  readonly dimensions: number;
  /** `document` for stored notes, `query` for search text (asymmetric retrieval). */
  embed(texts: string[], kind: 'document' | 'query'): Promise<number[][]>;
}

/** Raised for any provider failure; callers degrade to full-text search instead of failing. */
export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}
