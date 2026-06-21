/**
 * HybridSearch — fuses dense (semantic) and sparse (BM25 keyword) retrieval
 * via Reciprocal Rank Fusion.
 *
 * Legal queries are keyword-heavy (statute names, case citations, defined
 * terms); dense-only retrieval misses exact-match recall. BM25 over an
 * in-memory inverted index is cheap and catches the keyword signal that
 * dense embeddings blur. RRF combines the two rank lists without needing
 * score calibration (PRODUCT_DESIGN.md B6, stage 2).
 */

export interface HybridSearchOptions {
  /** RRF damping constant. Default 60 (the standard value). */
  rrfK?: number;
  /** Weight on the dense rank. Default 0.5 (equal fusion). */
  denseWeight?: number;
  /** Weight on the BM25 rank. Default 0.5. */
  sparseWeight?: number;
}

export interface RankedDoc {
  id: string;
  /** Fused score (higher is better). */
  score: number;
  /** Original dense rank (1-based), undefined if not in dense results. */
  denseRank?: number;
  /** Original sparse rank (1-based), undefined if not in sparse results. */
  sparseRank?: number;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'by',
  'for', 'with', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'this',
  'that', 'these', 'those', 'it', 'its', 'as', 'from', 'which', 'who', 'whom',
  'shall', 'may', 'must', 'not', 'no', 'do', 'does', 'did', 'has', 'have',
]);

/** Tokenize for sparse indexing: lowercase, alnum, drop stopwords/empties. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * In-memory BM25 index over a corpus of {id, text}.
 * Rebuilt when documents change; cheap for the mid-corpus sizes Domicile targets.
 */
export class BM25Index {
  private docs: Map<string, string[]> = new Map(); // id → tokens
  private docFreq: Map<string, number> = new Map(); // term → # docs containing it
  private avgDocLen = 0;
  private k1 = 1.5;
  private b = 0.75;

  add(id: string, text: string): void {
    const tokens = tokenize(text);
    this.docs.set(id, tokens);
    const seen = new Set<string>();
    for (const t of tokens) {
      if (!seen.has(t)) {
        this.docFreq.set(t, (this.docFreq.get(t) ?? 0) + 1);
        seen.add(t);
      }
    }
    this.recomputeAvg();
  }

  remove(id: string): void {
    const tokens = this.docs.get(id);
    if (!tokens) return;
    const seen = new Set<string>();
    for (const t of tokens) {
      if (!seen.has(t)) {
        const c = this.docFreq.get(t);
        if (c !== undefined) {
          if (c <= 1) this.docFreq.delete(t);
          else this.docFreq.set(t, c - 1);
        }
        seen.add(t);
      }
    }
    this.docs.delete(id);
    this.recomputeAvg();
  }

  clear(): void {
    this.docs.clear();
    this.docFreq.clear();
    this.avgDocLen = 0;
  }

  size(): number {
    return this.docs.size;
  }

  /** Score every doc against the query; return ranked list (best first). */
  search(query: string): Array<{ id: string; score: number }> {
    const qTerms = tokenize(query);
    if (qTerms.length === 0 || this.docs.size === 0) return [];

    const N = this.docs.size;
    const scores = new Map<string, number>();

    for (const [id, docTokens] of this.docs) {
      const docLen = docTokens.length;
      const tf = new Map<string, number>();
      for (const t of docTokens) tf.set(t, (tf.get(t) ?? 0) + 1);

      let score = 0;
      for (const term of qTerms) {
        const f = tf.get(term);
        if (!f) continue;
        const df = this.docFreq.get(term) ?? 0;
        if (df === 0) continue;
        // BM25 with IDF (lucene-style, non-negative floor).
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const denom = f + this.k1 * (1 - this.b + this.b * (docLen / (this.avgDocLen || 1)));
        score += idf * (f * (this.k1 + 1)) / denom;
      }
      if (score > 0) scores.set(id, score);
    }

    return Array.from(scores.entries())
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score);
  }

  private recomputeAvg(): void {
    if (this.docs.size === 0) {
      this.avgDocLen = 0;
      return;
    }
    let total = 0;
    for (const tokens of this.docs.values()) total += tokens.length;
    this.avgDocLen = total / this.docs.size;
  }
}

/**
 * Reciprocal Rank Fusion of a dense and a sparse ranked list.
 * fused(d) = wD / (k + denseRank(d)) + wS / (k + sparseRank(d))
 */
export function reciprocalRankFusion(
  dense: Array<{ id: string }>,
  sparse: Array<{ id: string }>,
  options: HybridSearchOptions = {}
): RankedDoc[] {
  const { rrfK = 60, denseWeight = 0.5, sparseWeight = 0.5 } = options;

  const denseRank = new Map<string, number>();
  dense.forEach((d, i) => denseRank.set(d.id, i + 1));
  const sparseRank = new Map<string, number>();
  sparse.forEach((d, i) => sparseRank.set(d.id, i + 1));

  const allIds = new Set<string>([...denseRank.keys(), ...sparseRank.keys()]);
  const fused: RankedDoc[] = [];
  for (const id of allIds) {
    const dr = denseRank.get(id);
    const sr = sparseRank.get(id);
    let score = 0;
    if (dr) score += denseWeight / (rrfK + dr);
    if (sr) score += sparseWeight / (rrfK + sr);
    fused.push({ id, score, denseRank: dr, sparseRank: sr });
  }
  fused.sort((a, b) => b.score - a.score);
  return fused;
}
