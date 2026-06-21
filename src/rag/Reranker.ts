/**
 * Reranker — a cross-encoder re-scoring stage between retrieval and generation.
 *
 * Dense + BM25 retrieval is bi-encoder: query and doc are embedded
 * independently, so their interaction is only compared via cosine. A
 * cross-encoder scores the (query, doc) pair jointly, capturing token-level
 * interaction that bi-encoders miss. Re-ranking the top-K candidates with a
 * small cross-encoder materially lifts citation accuracy — the #1 deal-risk
 * metric for legal RAG (PRODUCT_DESIGN.md B6, stage 3).
 *
 * Powered by Transformers.js (text-classification / cross-encoder pipeline),
 * loaded lazily on first use so users who don't enable reranking pay no cost.
 */

import type { SearchResult } from '../index/types';

export interface RerankerOptions {
  /** Hugging Face cross-encoder model id. Default: a small MS-MARCO model. */
  model?: string;
  /** Device: 'webgpu' attempts GPU, falls back to 'wasm'. Default 'wasm'. */
  device?: 'wasm' | 'webgpu';
  /** Top-N from the candidate list to actually re-score (cost control). Default: all. */
  topN?: number;
}

export interface Reranker {
  /** Re-score and reorder candidates by query relevance. */
  rerank(query: string, candidates: SearchResult[]): Promise<SearchResult[]>;
  /** Whether a cross-encoder model is loaded and ready. */
  isReady(): boolean;
  dispose(): Promise<void>;
}

/**
 * A reranker backed by Transformers.js. The pipeline is loaded on first
 * `rerank()` call. If the model cannot be loaded, `rerank()` returns the
 * candidates unchanged (graceful degradation — reranking is an enhancement,
 * not a hard dependency).
 */
export class TransformersReranker implements Reranker {
  private options: Required<RerankerOptions>;
  private pipeline: any = null;
  private initError: Error | null = null;
  private initializing: Promise<void> | null = null;

  constructor(options: RerankerOptions = {}) {
    this.options = {
      model: options.model ?? 'Xenova/ms-marco-MiniLM-L-6-v2',
      device: options.device ?? 'wasm',
      topN: options.topN ?? 0, // 0 = rerank all
    };
  }

  isReady(): boolean {
    return this.pipeline !== null;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.pipeline || this.initError) return;
    if (this.initializing) return this.initializing;

    this.initializing = (async () => {
      try {
        const { pipeline, env } = await import('@huggingface/transformers');
        env.allowLocalModels = false;
        env.useBrowserCache = true;
        this.pipeline = await pipeline('text-classification', this.options.model, {
          quantized: true,
          device: this.options.device === 'webgpu' ? 'webgpu' : undefined,
        } as any);
      } catch (error) {
        // Graceful: mark as unavailable; rerank() will pass candidates through.
        this.initError = error instanceof Error ? error : new Error(String(error));
      } finally {
        this.initializing = null;
      }
    })();
    return this.initializing;
  }

  async rerank(query: string, candidates: SearchResult[]): Promise<SearchResult[]> {
    if (candidates.length <= 1) return candidates;

    await this.ensureLoaded();

    // If the cross-encoder could not load, pass through unchanged.
    if (!this.pipeline) {
      return candidates;
    }

    const toScore = this.options.topN > 0 ? candidates.slice(0, this.options.topN) : candidates;
    const tail = this.options.topN > 0 ? candidates.slice(this.options.topN) : [];

    try {
      const pairs = toScore.map((c) => ({ text: query, text_pair: this.snippet(c) }));
      const outputs = await this.pipeline(pairs);
      // Cross-encoder text-classification returns a score per pair (relevance).
      const scored = this.normalizeOutputs(outputs, toScore);
      scored.sort((a, b) => b.score - a.score);
      return [...scored, ...tail];
    } catch {
      // If scoring fails at runtime, pass through unchanged rather than failing the query.
      return candidates;
    }
  }

  /** Extract a scoring snippet from a search result. */
  private snippet(c: SearchResult): string {
    const content = c.metadata?.content;
    if (typeof content === 'string') return content.slice(0, 512);
    if (typeof c.metadata?.title === 'string') return c.metadata.title;
    return '';
  }

  /**
   * Transformers.js text-classification returns either a single object,
   * an array of objects, or a tensor depending on version/input shape.
   * Normalize to an array of { score } aligned with the candidate order.
   */
  private normalizeOutputs(outputs: any, candidates: SearchResult[]): SearchResult[] {
    const scores: number[] = [];
    if (Array.isArray(outputs)) {
      for (const o of outputs) {
        scores.push(this.extractScore(o));
      }
    } else {
      scores.push(this.extractScore(outputs));
    }
    return candidates.map((c, i) => ({ ...c, score: scores[i] ?? c.score }));
  }

  private extractScore(o: any): number {
    if (typeof o === 'number') return o;
    if (Array.isArray(o) && o.length > 0) return this.extractScore(o[0]);
    if (o && typeof o === 'object') {
      if (typeof o.score === 'number') return o.score;
      // { label, score } form — take the positive-label score if present.
      if (Array.isArray(o) ) return this.extractScore(o[0]);
      const vals = Object.values(o);
      for (const v of vals) {
        if (v && typeof v === 'object' && typeof (v as any).score === 'number') {
          return (v as any).score;
        }
      }
    }
    return 0;
  }

  async dispose(): Promise<void> {
    this.pipeline = null;
    this.initError = null;
  }
}

/**
 * A no-op reranker that preserves input order. Used as the default when
 * reranking is disabled, so the pipeline stages are uniform.
 */
export class NoopReranker implements Reranker {
  isReady(): boolean { return true; }
  async rerank(_query: string, candidates: SearchResult[]): Promise<SearchResult[]> {
    return candidates;
  }
  async dispose(): Promise<void> {}
}
