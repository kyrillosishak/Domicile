/**
 * HnswIndex benchmark — measures the pure-TS HNSW index against a brute-force
 * ground truth on synthetic corpora.
 *
 * PRODUCT_DESIGN.md A7 / B3 / TECHNICAL_VALIDATION.md §5. HNSW replaced the
 * previous WASM k-d tree (Voy) after winning the Phase-3 gate on (a) real
 * scores, (b) non-rebuilding delete, and (c) recall. Voy has since been
 * removed; this benchmark now characterizes HNSW alone — recall@k, search
 * latency (p50/p99), delete latency, insert throughput, and whether scores
 * are real (non-constant) — at the validation-plan scale points.
 *
 * It is pure-TS and deterministic (seeded RNG), so it runs in `vitest`
 * without a browser. The CLI's `domicile bench` (Phase 5) wraps this.
 */

import { HnswIndex } from './HnswIndex';
import type { Index, IndexHit } from '../core/contracts';
import type { VectorRecord } from '../storage/types';

export interface BenchmarkScalePoint {
  size: number;
  dimensions: number;
}

export interface IndexMetrics {
  /** recall@k vs brute force, in [0,1]. */
  recallAtK: number;
  /** search latency p50 / p99 in ms. */
  searchP50Ms: number;
  searchP99Ms: number;
  /** median delete latency in ms. */
  deleteMedianMs: number;
  /** mean insert throughput (vectors/sec). */
  insertThroughputPerSec: number;
  /** true if returned scores vary (not a hardcoded constant). */
  hasRealScores: boolean;
  /** peak RSS-ish: number of live index entries after deletes. */
  liveCount: number;
}

export interface BenchmarkResult {
  scale: BenchmarkScalePoint;
  hnsw: IndexMetrics;
  /** does HNSW satisfy the quality gate at this scale point? */
  pass: boolean;
}

export interface BenchmarkOptions {
  /** number of queries to run per scale point. Default 200. */
  queries?: number;
  /** k for recall@k. Default 10. */
  k?: number;
  /** fraction of vectors to delete when measuring delete latency. Default 0.05. */
  deleteFraction?: number;
  /** minimum recall@k required to pass. Default 0.9. */
  minRecall?: number;
  /** progress callback. */
  onProgress?: (msg: string) => void;
}

/** Minimal seeded RNG (mulberry32) so corpora are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  // Box-Muller.
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function makeVectors(count: number, dims: number, seed: number): Float32Array[] {
  const rng = mulberry32(seed);
  const out: Float32Array[] = [];
  for (let i = 0; i < count; i++) {
    const v = new Float32Array(dims);
    let norm = 0;
    for (let d = 0; d < dims; d++) {
      const g = gaussian(rng);
      v[d] = g;
      norm += g * g;
    }
    norm = Math.sqrt(norm) || 1;
    for (let d = 0; d < dims; d++) v[d] /= norm; // unit-norm → cosine = dot
    out.push(v);
  }
  return out;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot; // vectors are unit-norm
}

/** Brute-force top-k ground truth. */
function bruteForce(vectors: Float32Array[], query: Float32Array, k: number, live: Set<number>): number[] {
  const scored: Array<{ idx: number; s: number }> = [];
  for (let i = 0; i < vectors.length; i++) {
    if (!live.has(i)) continue;
    scored.push({ idx: i, s: cosine(query, vectors[i]) });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, k).map((s) => s.idx);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function measureIndex(
  impl: Index,
  vectors: Float32Array[],
  opts: Required<BenchmarkOptions>,
  scale: BenchmarkScalePoint,
  log: (m: string) => void
): Promise<IndexMetrics> {
  const { queries, k, deleteFraction } = opts;
  const ids = vectors.map((_, i) => `v${i}`);

  // --- Insert ---
  const records: VectorRecord[] = vectors.map((v, i) => ({
    id: ids[i],
    vector: v,
    metadata: { idx: i },
    timestamp: i,
  }));
  const insertStart = performance.now();
  await impl.addBatch(records);
  const insertMs = performance.now() - insertStart;
  const insertThroughputPerSec = (vectors.length / insertMs) * 1000;

  // --- Queries (recall + latency) ---
  const rng = mulberry32(scale.size + 7);
  const queryVecs: Float32Array[] = [];
  for (let i = 0; i < queries; i++) queryVecs.push(vectors[Math.floor(rng() * vectors.length)].slice());

  const latencies: number[] = [];
  const live = new Set(vectors.map((_, i) => i));
  let recallHits = 0;
  let scoreVariance = 0;
  let scoreMean = 0;
  let scoreCount = 0;
  let firstScores: number[] = [];

  for (let q = 0; q < queries; q++) {
    const truth = new Set(bruteForce(vectors, queryVecs[q], k, live));
    const t0 = performance.now();
    const hits: IndexHit[] = await impl.search(queryVecs[q], k);
    latencies.push(performance.now() - t0);

    for (const h of hits) {
      if (truth.has(Number(h.id.slice(1)))) recallHits++;
      scoreMean += h.score;
      scoreVariance += h.score * h.score;
      scoreCount++;
    }
    if (q === 0) firstScores = hits.map((h) => h.score);
  }
  scoreMean /= scoreCount || 1;
  const variance = (scoreVariance / (scoreCount || 1)) - scoreMean * scoreMean;
  // Real scores: not all identical (a constant-score index → variance ~0).
  const hasRealScores = firstScores.length > 1 && firstScores.some((s) => s !== firstScores[0]) && variance > 1e-9;

  latencies.sort((a, b) => a - b);
  const recallAtK = recallHits / (queries * k);

  // --- Delete latency ---
  const deleteCount = Math.max(1, Math.floor(vectors.length * deleteFraction));
  const deleteIds: string[] = [];
  for (let i = 0; i < deleteCount; i++) {
    deleteIds.push(ids[i]);
    live.delete(i);
  }
  const deleteLatencies: number[] = [];
  for (const id of deleteIds) {
    const t0 = performance.now();
    await impl.remove(id);
    deleteLatencies.push(performance.now() - t0);
  }
  deleteLatencies.sort((a, b) => a - b);

  log(`  recall@${k}=${recallAtK.toFixed(3)} p50=${percentile(latencies, 50).toFixed(2)}ms p99=${percentile(latencies, 99).toFixed(2)}ms delMedian=${median(deleteLatencies).toFixed(3)}ms realScores=${hasRealScores}`);

  return {
    recallAtK,
    searchP50Ms: percentile(latencies, 50),
    searchP99Ms: percentile(latencies, 99),
    deleteMedianMs: median(deleteLatencies),
    insertThroughputPerSec,
    hasRealScores,
    liveCount: live.size,
  };
}

/**
 * Run the HNSW benchmark at one scale point.
 */
export async function benchmarkIndex(
  scale: BenchmarkScalePoint,
  options: BenchmarkOptions = {}
): Promise<BenchmarkResult> {
  const opts: Required<BenchmarkOptions> = {
    queries: options.queries ?? 200,
    k: options.k ?? 10,
    deleteFraction: options.deleteFraction ?? 0.05,
    minRecall: options.minRecall ?? 0.9,
    onProgress: options.onProgress ?? (() => {}),
  };
  const log = (m: string) => opts.onProgress(m);

  log(`Building synthetic corpus: ${scale.size} × ${scale.dimensions} (seeded)`);
  const vectors = makeVectors(scale.size, scale.dimensions, 42);

  log(`HnswIndex:`);
  const hnsw = new HnswIndex({ dimensions: scale.dimensions, metric: 'cosine', m: 16, efConstruction: 200, efSearch: 64, seed: 42 });
  await hnsw.initialize();
  const hnswMetrics = await measureIndex(hnsw, vectors, opts, scale, log);
  await hnsw.clear();

  // Gate: real scores + recall at/above the floor. (Delete is mark-based by
  // construction — no rebuild — so there is no latency regression to gate on.)
  const pass = hnswMetrics.hasRealScores && hnswMetrics.recallAtK >= opts.minRecall;

  return { scale, hnsw: hnswMetrics, pass };
}

/**
 * Run the full validation suite across scale points and report a pass/fail.
 */
export async function benchmarkSuite(
  scales: BenchmarkScalePoint[] = [
    { size: 1000, dimensions: 128 },
    { size: 10000, dimensions: 128 },
  ],
  options: BenchmarkOptions = {}
): Promise<{ results: BenchmarkResult[]; overallPass: boolean }> {
  const results: BenchmarkResult[] = [];
  let overallPass = true;
  for (const scale of scales) {
    const r = await benchmarkIndex(scale, options);
    results.push(r);
    if (!r.pass) overallPass = false;
  }
  return { results, overallPass };
}
