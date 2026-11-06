import { EmbeddingError, type EmbeddingProvider } from './embedding-provider.js';

const ENDPOINT = 'https://api.voyageai.com/v1/embeddings';
const MAX_BATCH = 128;

type VoyageResponse = { data: { embedding: number[]; index: number }[] };

/** Voyage AI embeddings (Anthropic's recommended provider). voyage-3.5-lite, 1024 dimensions. */
export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 1024;

  constructor(
    private readonly apiKey: string,
    readonly model = 'voyage-3.5-lite',
    private readonly timeoutMs = 10_000,
  ) {}

  async embed(texts: string[], kind: 'document' | 'query'): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH) out.push(...(await this.batch(texts.slice(i, i + MAX_BATCH), kind)));
    return out;
  }

  private async batch(input: string[], kind: 'document' | 'query'): Promise<number[][]> {
    if (input.length === 0) return [];
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ input, model: this.model, input_type: kind, output_dimension: this.dimensions }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new EmbeddingError(`Voyage request failed: ${(err as Error).message}`, true);
    }
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      throw new EmbeddingError(`Voyage ${res.status}: ${body}`, res.status === 429 || res.status >= 500);
    }
    const json = (await res.json()) as VoyageResponse;
    const vectors = [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    if (vectors.length !== input.length || vectors.some((v) => v.length !== this.dimensions)) {
      throw new EmbeddingError('Voyage returned an unexpected embedding shape', false);
    }
    return vectors;
  }
}
