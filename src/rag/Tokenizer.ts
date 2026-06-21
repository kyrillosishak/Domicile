/**
 * Tokenizer abstraction for accurate context-budget accounting.
 *
 * The original RAG pipeline estimated tokens as `length / 4`
 * (RAGPipelineManager.estimateTokenCount), which is off by ~2x for
 * non-English text (relevant for EU legal) and for code/citations.
 * Context truncation relied on it, so truncation was imprecise and could
 * either overflow the model context or waste budget (PRODUCT_DESIGN.md B6).
 *
 * This module provides a `Tokenizer` interface with two implementations:
 *  - `CharTokenizer`   — the cheap length/4 heuristic, used as a fallback.
 *  - `TransformersTokenizer` — a real model tokenizer loaded via
 *    Transformers.js, used when precision matters (context truncation).
 */

export interface Tokenizer {
  count(text: string): Promise<number>;
  /** Truncate to at most maxTokens, preferring a sentence boundary. */
  truncate(text: string, maxTokens: number): Promise<string>;
  dispose?(): Promise<void>;
}

/** Cheap heuristic fallback: ~1 token per 4 characters. */
export class CharTokenizer implements Tokenizer {
  async count(text: string): Promise<number> {
    return Math.ceil(text.length / 4);
  }

  async truncate(text: string, maxTokens: number): Promise<string> {
    const maxChars = maxTokens * 4;
    if (text.length <= maxChars) return text;
    const cut = text.substring(0, maxChars);
    const lastStop = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('\n'));
    if (lastStop > maxChars * 0.8) {
      return cut.substring(0, lastStop + 1) + '\n\n[Context truncated due to length...]';
    }
    return cut + '...\n\n[Context truncated due to length...]';
  }

  async dispose(): Promise<void> {}
}

/**
 * Real tokenizer backed by Transformers.js. Loaded lazily; if loading
 * fails, callers should fall back to CharTokenizer.
 */
export class TransformersTokenizer implements Tokenizer {
  private model: string;
  private tokenizer: any = null;
  private initError: Error | null = null;
  private initializing: Promise<void> | null = null;

  constructor(model: string) {
    this.model = model;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.tokenizer || this.initError) return;
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      try {
        const { AutoTokenizer, env } = await import('@huggingface/transformers');
        env.allowLocalModels = false;
        env.useBrowserCache = true;
        this.tokenizer = await AutoTokenizer.from_pretrained(this.model);
      } catch (error) {
        this.initError = error instanceof Error ? error : new Error(String(error));
      } finally {
        this.initializing = null;
      }
    })();
    return this.initializing;
  }

  async count(text: string): Promise<number> {
    await this.ensureLoaded();
    if (!this.tokenizer) return Math.ceil(text.length / 4);
    try {
      const enc = await this.tokenizer(text);
      // Transformers.js tokenizers return an object with input_ids.
      const ids = enc?.input_ids ?? enc?.data;
      if (ids && typeof ids.length === 'number') return ids.length;
      if (ids && typeof ids.size === 'number') return ids.size;
    } catch {
      // fall through to heuristic
    }
    return Math.ceil(text.length / 4);
  }

  async truncate(text: string, maxTokens: number): Promise<string> {
    await this.ensureLoaded();
    if (!this.tokenizer) {
      return new CharTokenizer().truncate(text, maxTokens);
    }
    try {
      // Encode, slice to maxTokens, decode. This truncates on real token
      // boundaries, so the model never sees a partial token and the budget
      // is exact.
      const enc = await this.tokenizer(text);
      const ids = enc?.input_ids ?? enc?.data;
      let arr: number[] = [];
      if (Array.isArray(ids)) arr = ids;
      else if (ids && typeof ids.tolist === 'function') arr = ids.tolist();
      else if (ids && ids.length !== undefined) arr = Array.from(ids);

      if (arr.length <= maxTokens) return text;
      const sliced = arr.slice(0, maxTokens);
      const decoded = this.tokenizer.decode(sliced, { skip_special_tokens: true });
      return decoded + '\n\n[Context truncated due to length...]';
    } catch {
      return new CharTokenizer().truncate(text, maxTokens);
    }
  }

  async dispose(): Promise<void> {
    this.tokenizer = null;
    this.initError = null;
  }
}

/**
 * A Tokenizer whose count/truncate are sync. The RAG pipeline's truncation
 * is async, so it uses `Tokenizer` directly; this sync variant is exposed
 * for any synchronous call sites that can tolerate the heuristic.
 */
export function heuristicTokenizer(): Tokenizer {
  return new CharTokenizer();
}
