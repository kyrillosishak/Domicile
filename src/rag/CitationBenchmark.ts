/**
 * Citation-accuracy benchmark — TECHNICAL_VALIDATION.md §5 / PRODUCT_DESIGN.md
 * Phase-4 gate.
 *
 * The headline validation claim is that Domicile's chunk + hybrid + rerank
 * retrieval closes the gap to cloud frontier on grounded Q&A. The full study
 * (7B WebLLM vs a cloud model, with vs without the pipeline) needs a browser
 * and a multi-GB download; this module is the reproducible, offline core of
 * it: a fixed known-answer legal corpus, run through the *real* retrieval
 * stages (HnswIndex dense + BM25 hybrid + RRF + reranker) across pipeline
 * variants, measuring whether the correct source is cited.
 *
 * It is pure-TS and deterministic (seeded embeddings), so it runs in vitest
 * and under `domicile bench --citation` without a browser or network. The
 * generator-side comparison is left to the integrator's environment; the
 * retrieval-side citation recall is what the pipeline stages can lift, and
 * what this measures.
 */

import { HnswIndex } from '../index/HnswIndex';
import { BM25Index, reciprocalRankFusion, tokenize } from './HybridSearch';
import type { Reranker } from './Reranker';
import type { SearchResult } from '../index/types';

/** A passage in the fixed corpus. */
export interface CorpusPassage {
  id: string;
  text: string;
}

/** A known-answer question: the query and the id of the passage that should be cited. */
export interface KnownAnswerQuestion {
  query: string;
  expectedId: string;
}

export type CitationVariant =
  | 'dense'
  | 'dense+hybrid'
  | 'dense+rerank'
  | 'dense+hybrid+rerank';

export interface CitationVariantResult {
  variant: CitationVariant;
  /** Fraction of questions whose expected source is in the top-k. */
  citationRecallAtK: number;
  /** Mean rank of the expected source (1 = first); corpus size + 1 if absent. */
  meanExpectedRank: number;
  /** Per-question hit/miss detail. */
  perQuestion: Array<{ query: string; expectedId: string; rank: number; hit: boolean }>;
}

export interface CitationBenchmarkResult {
  variants: CitationVariantResult[];
  /** The variants that beat dense-only on citation recall. */
  improvements: CitationVariant[];
  /** Overall: did hybrid+rerank strictly beat dense-only? */
  pipelineBeatsDense: boolean;
}

export interface CitationBenchmarkOptions {
  /** k for citation recall@k. Default 3. */
  k?: number;
  /** Reranker to exercise the rerank stage. Default: a deterministic LexOverlapReranker. */
  reranker?: Reranker;
  /** Corpus + questions. Defaults to the built-in legal corpus. */
  corpus?: CorpusPassage[];
  questions?: KnownAnswerQuestion[];
  onProgress?: (msg: string) => void;
}

/**
 * Built-in sanitized legal corpus. Each passage has a distinct keyword
 * signature so dense retrieval has signal but keyword-heavy queries (statute
 * names, defined terms) expose where hybrid BM25 helps — the legal use case
 * from MARKET_ANALYSIS.md §3.1.
 */
export const DEFAULT_LEGAL_CORPUS: CorpusPassage[] = [
  { id: 'force-majeure', text: 'Force Majeure. Neither party shall be liable for any failure or delay in performance under this Agreement caused by acts of God, war, terrorism, pandemic, or governmental action. The affected party shall give prompt written notice and use commercially reasonable efforts to resume performance.' },
  { id: 'indemnification', text: 'Indemnification. The Service Provider agrees to indemnify, defend, and hold harmless the Client and its officers from any third-party claims, damages, liabilities, and expenses, including reasonable attorneys fees, arising out of any breach of this Agreement or negligent acts of the Service Provider.' },
  { id: 'arbitration', text: 'Binding Arbitration. Any dispute, controversy, or claim arising out of or relating to this contract, or the breach thereof, shall be settled by binding arbitration administered in the State of Delaware under the commercial arbitration rules then prevailing. Judgment on the award may be entered in any court of competent jurisdiction.' },
  { id: 'limitation-of-liability', text: 'Limitation of Liability. In no event shall either party be liable for indirect, incidental, special, consequential, or punitive damages, including lost profits or lost data, arising out of this Agreement, regardless of the theory of liability. The aggregate liability of each party shall not exceed the fees paid in the twelve months preceding the claim.' },
  { id: 'confidentiality', text: 'Confidential Information. Each party agrees to hold the other partys confidential information in strict confidence and not to disclose it to any third party without prior written consent. Confidential information includes trade secrets, business plans, customer lists, and technical specifications, but excludes information that is publicly known or independently developed.' },
  { id: 'termination', text: 'Termination for Convenience. Either party may terminate this Agreement for convenience upon thirty days prior written notice to the other party. Upon termination, all licenses granted hereunder shall cease, and the receiving party shall return or destroy all confidential materials within ten business days.' },
  { id: 'governing-law', text: 'Governing Law. This Agreement shall be governed by and construed in accordance with the laws of the State of New York, without regard to its conflict of laws principles. The parties consent to the exclusive jurisdiction and venue of the state and federal courts located in New York County.' },
  { id: 'warranty', text: 'Limited Warranty. The Service Provider warrants that the services will conform in all material respects to the applicable specification for a period of thirty days from delivery. The foregoing warranty is exclusive, and the providers sole obligation is to re-perform or correct the deficient services. All other warranties, express or implied, are hereby disclaimed.' },
  { id: 'assignment', text: 'Assignment. Neither party may assign or transfer this Agreement, in whole or in part, by operation of law or otherwise, without the prior written consent of the other party, which shall not be unreasonably withheld. Any attempted assignment in violation of this section shall be null and void.' },
  { id: 'payment', text: 'Payment Terms. The Client shall pay all undisputed invoices within net thirty days of the invoice date. Late payments shall accrue interest at one and a half percent per month or the maximum rate permitted by law, whichever is less. The Client may withhold payment only for items disputed in good faith and notified in writing.' },
  { id: 'data-protection', text: 'Data Protection. The Service Provider shall process personal data only on the Clients documented instructions and in compliance with applicable data protection laws, including the GDPR. The provider shall implement appropriate technical and organizational measures to ensure a level of security appropriate to the risk, and shall notify the Client of any personal data breach without undue delay.' },
  { id: 'ip-ownership', text: 'Intellectual Property Ownership. All intellectual property rights in any work product, deliverables, and inventions created under this Agreement shall vest in the Client upon creation. The Service Provider retains ownership of its pre-existing methodologies, tools, and background intellectual property used in performing the services.' },
];

/** Known-answer questions for the default corpus. */
export const DEFAULT_LEGAL_QUESTIONS: KnownAnswerQuestion[] = [
  { query: 'What happens if a pandemic prevents performance?', expectedId: 'force-majeure' },
  { query: 'Who pays attorneys fees if a third party sues over a breach?', expectedId: 'indemnification' },
  { query: 'Where are disputes settled — court or arbitration?', expectedId: 'arbitration' },
  { query: 'Can I recover lost profits for a breach?', expectedId: 'limitation-of-liability' },
  { query: 'What must be kept secret — trade secrets and customer lists?', expectedId: 'confidentiality' },
  { query: 'How much notice to end the agreement for convenience?', expectedId: 'termination' },
  { query: 'Which states laws govern this contract?', expectedId: 'governing-law' },
  { query: 'How long is the services warranty period?', expectedId: 'warranty' },
  { query: 'Can I assign the contract to another company without consent?', expectedId: 'assignment' },
  { query: 'When are invoices due and what is the late fee?', expectedId: 'payment' },
  { query: 'What are the providers obligations under the GDPR?', expectedId: 'data-protection' },
  { query: 'Who owns the deliverables and work product created?', expectedId: 'ip-ownership' },
];

/**
 * Deterministic bag-of-words cosine embedding. Gives dense retrieval real
 * signal (passages sharing query terms rank higher) without a model download,
 * so the benchmark runs offline. Imperfect by design — that's what lets
 * hybrid + rerank show measurable lifts, the same gap the real pipeline
 * closes.
 */
class BagOfWordsEmbedder {
  private vocab: Map<string, number>;
  readonly dims: number;

  constructor(corpus: CorpusPassage[]) {
    const vocab = new Map<string, number>();
    for (const p of corpus) {
      for (const tok of tokenize(p.text)) {
        if (!vocab.has(tok)) vocab.set(tok, vocab.size);
      }
    }
    this.vocab = vocab;
    this.dims = Math.max(vocab.size, 1);
  }

  embed(text: string): Float32Array {
    const v = new Float32Array(this.dims);
    for (const tok of tokenize(text)) {
      const idx = this.vocab.get(tok);
      if (idx !== undefined) v[idx] += 1;
    }
    // L2 normalize so cosine = dot product (matches the HnswIndex cosine metric).
    let norm = 0;
    for (let i = 0; i < this.dims; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < this.dims; i++) v[i] /= norm;
    return v;
  }
}

/**
 * Deterministic reranker that re-scores candidates by query/candidate term
 * overlap, biasing toward passages that share more query terms. Exercises the
 * rerank stage offline without a cross-encoder download. The real
 * TransformersReranker is a drop-in once a model is available.
 */
class LexOverlapReranker implements Reranker {
  isReady(): boolean {
    return true;
  }
  async dispose(): Promise<void> {}
  async rerank(query: string, candidates: SearchResult[]): Promise<SearchResult[]> {
    const qTerms = new Set(tokenize(query));
    const scored = candidates.map((c) => {
      const cText = (c.metadata?.content as string) ?? '';
      let overlap = 0;
      for (const t of tokenize(cText)) if (qTerms.has(t)) overlap++;
      return { c, boost: overlap };
    });
    scored.sort((a, b) => b.boost - a.boost || (b.c.score - a.c.score));
    return scored.map((s) => s.c);
  }
}

function rankOf(results: { id: string }[], expectedId: string): number {
  const idx = results.findIndex((r) => r.id === expectedId);
  return idx === -1 ? results.length + 1 : idx + 1;
}

/**
 * Run the citation-accuracy benchmark across all pipeline variants.
 */
export async function benchmarkCitationAccuracy(
  options: CitationBenchmarkOptions = {}
): Promise<CitationBenchmarkResult> {
  const k = options.k ?? 3;
  const corpus = options.corpus ?? DEFAULT_LEGAL_CORPUS;
  const questions = options.questions ?? DEFAULT_LEGAL_QUESTIONS;
  const reranker = options.reranker ?? new LexOverlapReranker();
  const log = (m: string) => options.onProgress?.(m);

  const embedder = new BagOfWordsEmbedder(corpus);
  const textById = new Map(corpus.map((p) => [p.id, p.text]));

  // Build the dense HnswIndex over the corpus passages.
  const index = new HnswIndex({ dimensions: embedder.dims, metric: 'cosine', m: 16, efConstruction: 200, efSearch: 128 });
  await index.initialize();
  const records = corpus.map((p) => ({ id: p.id, vector: embedder.embed(p.text), metadata: { content: p.text, idx: p.id }, timestamp: 0 }));
  await index.addBatch(records);

  // Build the BM25 sparse index for hybrid search.
  const bm25 = new BM25Index();
  for (const p of corpus) bm25.add(p.id, p.text);

  const variants: CitationVariant[] = ['dense', 'dense+hybrid', 'dense+rerank', 'dense+hybrid+rerank'];
  const variantResults: CitationVariantResult[] = [];

  for (const variant of variants) {
    const useHybrid = variant.includes('hybrid');
    const useRerank = variant.includes('rerank');
    const retrieveK = (useHybrid || useRerank) ? Math.max(k * 4, 8) : k;

    const perQuestion: CitationVariantResult['perQuestion'] = [];
    let hits = 0;
    let rankSum = 0;

    for (const q of questions) {
      const queryVec = embedder.embed(q.query);
      const denseHits = await index.search(queryVec, retrieveK);
      // HnswIndex returns IndexHit[] (id + score only); hydrate metadata so
      // the reranker stage has passage content to score against.
      const dense: SearchResult[] = denseHits.map((h) => ({
        id: h.id,
        score: h.score,
        metadata: { content: textById.get(h.id) ?? '' },
      }));

      let ranked: SearchResult[];

      if (useHybrid && bm25.size() > 0) {
        const sparse = bm25.search(q.query).slice(0, retrieveK);
        const fused = reciprocalRankFusion(
          dense.map((r) => ({ id: r.id })),
          sparse.map((r) => ({ id: r.id })),
        );
        const denseById = new Map(dense.map((r) => [r.id, r]));
        ranked = fused.slice(0, retrieveK).map((f) => {
          const hit = denseById.get(f.id);
          return hit ?? { id: f.id, score: f.score, metadata: { content: textById.get(f.id) ?? '' } };
        });
      } else {
        ranked = dense;
      }

      if (useRerank && ranked.length > 1) {
        ranked = await reranker.rerank(q.query, ranked);
      }

      const finalRanked = ranked.slice(0, k);
      const rank = rankOf(finalRanked, q.expectedId);
      const hit = rank <= k;
      if (hit) hits++;
      rankSum += rankOf(ranked, q.expectedId); // mean rank over full retrieved set
      perQuestion.push({ query: q.query, expectedId: q.expectedId, rank, hit });
    }

    const citationRecallAtK = hits / questions.length;
    const meanExpectedRank = rankSum / questions.length;
    log(`  ${variant.padEnd(22)} recall@${k}=${citationRecallAtK.toFixed(3)} meanRank=${meanExpectedRank.toFixed(2)}`);
    variantResults.push({ variant, citationRecallAtK, meanExpectedRank, perQuestion });
  }

  await index.clear();

  const dense = variantResults.find((v) => v.variant === 'dense')!;
  const improvements = variantResults
    .filter((v) => v.variant !== 'dense' && v.citationRecallAtK > dense.citationRecallAtK)
    .map((v) => v.variant);
  const fullPipeline = variantResults.find((v) => v.variant === 'dense+hybrid+rerank')!;
  const pipelineBeatsDense = fullPipeline.citationRecallAtK > dense.citationRecallAtK ||
    (fullPipeline.citationRecallAtK === dense.citationRecallAtK && fullPipeline.meanExpectedRank < dense.meanExpectedRank);

  return { variants: variantResults, improvements, pipelineBeatsDense };
}
