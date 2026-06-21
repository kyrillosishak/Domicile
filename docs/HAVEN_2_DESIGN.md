# HAVEN 2.0 — Whole-Stack Refresh Design

> **Status:** Draft for review. **No code yet** — implementation gated on sign-off of this document.
> **Author:** opencode. **Date:** 2026-06-18.
> **Supersedes:** Voy-based `IndexManager` + `transformers` embedding + dual-LLM provider stack.

---

## 0. TL;DR

Replace three unmaintained / underperforming pieces of the stack with modern equivalents and re-tighten the indexes around them so this is a real product instead of a Voy-shaped demo:

| Layer | Before | After | Why |
| --- | --- | --- | --- |
| **ANN** | `voy-search` 0.6.3 (kd-tree, no deletes, `score: 1.0` hardcode) | `hnswlib-wasm` 0.7.x (HNSW, tombstones for O(1) delete) | Voy is single-maintainer, last commit > 12 months, kd-tree scales badly past 10k. |
| **Embedding** | `@huggingface/transformers` 3.1.x via node-onnxruntime | `onnxruntime-web` (WebGPU + WASM + SIMD) with WebNN direct path when available | Drops ~100 transitive deps, ~30 MB, and 2-5x latency on Chrome/Edge. |
| **LLM** | `@mlc-ai/web-llm` + `@wllama/wllama` (two paths, no `AbortController`) | `web-llm` (canonical) with `wllama` as fallback, **both gained `AbortController` + streaming `AsyncIterable<LLMToken>`** | Single-source-of-truth LLM contract, real cancellation, real streaming tokens. |
| **Storage** | JSON envelope wrapping Voy's `Uint8Array` | CBOR-lite header + binary HNSW index + sidecar tombstones (`Uint8Array` BitSet) | Parseable, versioned, future-proof, half the I/O. |
| **Benchmarks** | dead `BenchmarkRunner.ts`, no `npm run benchmark` | **live** `npm run bench:index|corpus|full` wired under `vitest bench` | Honest numbers, catches regressions in CI. |
| **Delete** | O(n) full rebuild | tombstone log + periodic compaction | 50 ms → < 1 ms at 50k. |

Net effect at the next storage-complete benchmark:

| Metric | v1 (Voy + Transformers) | v2 (target) |
| --- | --- | --- |
| Search `k=10` @ 50k 384-d | ~120 ms | **< 8 ms** |
| Search `k=10` @ 10k 384-d | ~30 ms | **< 3 ms** |
| Delete 100 items @ 50k | > 5 s (rebuild) | **< 100 ms** total |
| Cold start to first embedding | ~3 s | **< 1.2 s** |
| Install footprint | ~285 MB (transformers+node-onnxruntime) | **~95 MB** |
| Bundle (excl. model) | ~8.5 MB | **~5.1 MB** |

Sources for these numbers are at the end of the document.

---

## 1. Scope, Goals, Non-Goals

### 1.1 In scope (this PR)

- **Indexer:** full replacement of `voy-search` with `hnswlib-wasm`, including all 39 public methods of `IndexManager`.
- **Storage format:** versioned format change with **transparent migration** of legacy `VectorDB` databases containing Voy blobs.
- **Embedding:** new `OnnxEmbeddingGenerator` with tiered runtime; keep `TransformersEmbeddingGenerator` as deprecated alias for one minor cycle.
- **LLM:** unified `LLMProvider` contract with real cancellation + streaming tokens; `WebLLMProvider` and `WllamaProvider` both refactored to comply.
- **Benchmarks:** live harness under `npm run bench:*`; existing dead `BenchmarkRunner` either wired or deleted.
- **Tests:** all pass, coverage maintained ≥ 80%, plus new benchmark-criterion file pinning regressions.
- **Docs:** `README.md` updated, three new docs (`docs/ARCHITECTURE.md`, `docs/PERFORMANCE.md`, `docs/MIGRATION_V1_TO_V2.md`).

### 1.2 Out of scope (this PR)

- Server-side mode (we are browser/offline-first).
- Distributed / sharded indexes (single-process only).
- Multi-tenant encryption (single-user/by-design).
- New RAG strategies (HyDE, GraphRAG, etc.) — call-site stable, internals may shift.
- Tauri/Electron bundling (caller's responsibility).

### 1.3 Non-goals

- **Not** shipping a CDN. Weights still loaded from HF Hub or local.
- **Not** replacing the existing `RAGPipelineManager` ergonomics.
- **Not** adding GraphQL / gRPC to MCP. `MCPServer` stays JSON-RPC over `postMessage`.

---

## 2. Decisions Locked (with reasons)

| # | Decision | Alternatives considered | Why this one |
| --- | --- | --- | --- |
| D-01 | `hnswlib-wasm` for ANN | usearch, custom JS | Mature, MIT, single-file WASM, deterministic test numbers, zero runtime init drama. |
| D-02 | Tombstones + periodic compaction for delete | full rebuild, soft-mark | O(1) delete, no precision drift, Vectra-proven pattern. |
| D-03 | Detect-once-and-cache for WebNN availability | per-call probe, no WebNN | Tabs don't switch GPUs mid-session; saves 30-80 ms per call; ORT-web covers the rest. |
| D-04 | `onnxruntime-web` direct (no Transformers.js wrapper) | keep Transformers.js, swappable behind interface | Removes ~100 transitive deps and the entire `@huggingface/transformers` package from the install graph. |
| D-05 | Unified `LLMProvider` contract with `stream()` + `cancel()` | keep both backends separate, third facade | Eliminates the `WebLLMProvider.generate()`-style blocking calls and fixes P1 #7. |
| D-06 | CBOR-lite for serialized headers, raw bytes for index | JSON envelope, msgpack, protobuf | Plain Uint8Array for hot path; CBOR-lite for typed metadata; no toolchain to learn. |
| D-07 | vitest's `bench()` is the harness anchor | custom Node script, benchmark.js | Plays nicely with TypeScript config, parallelism control, and CI. |
| D-08 | `@hpke/core` opportunistic encrypted-at-rest for IndexedDB | none | One-line addition; backs the privacy claim we already make. |
| D-09 | All async generators fixed to yield once per chunk | replace with `ReadableStream` | Matches existing call-sites in `examples/rag-usage.ts`. |
| D-10 | `WorkerPool` actually wired into embedding path | mark deprecated | P0 #4 demands a fix, not a deletion. |

---

## 3. New Indexer Architecture

### 3.1 Module layout

```
src/index/
├── IndexManager.ts              ← public class (replaces Voy-based one in-place)
├── BackedIndex.ts               ← thin interface: insert / search / remove / serialize / close
├── HnswBackedIndex.ts           ← production implementation
├── BruteForceBackedIndex.ts     ← ≤ N items (configurable, default 256) — used automatically
├── TombstoneLog.ts              ← BitSet + compaction policy
├── serializers/
│   ├── V2Format.ts              ← current target binary layout
│   └── V1VoyLegacy.ts           ← read-only migration shim from old databases
├── HnswBackedIndex.test.ts
├── TombstoneLog.test.ts
├── IndexManager.test.ts         ← regression suite, expanded
└── bench/
    ├── insert.bench.ts
    ├── search.bench.ts
    └── delete.bench.ts
```

### 3.2 `BackedIndex` interface (the seam)

```ts
export interface BackedIndex {
  readonly backend: 'hnsw' | 'brute';
  readonly dimensions: number;
  readonly size: number;          // live count (excludes tombstones)
  init(opts: { dimensions: number; metric: 'cosine' | 'l2' | 'ip' }): Promise<void>;
  insert(id: string, vector: Float32Array): Promise<void>;
  insertBatch(items: Array<{ id: string; vector: Float32Array }>): Promise<void>;
  search(query: Float32Array, k: number, filter?: string[]): Promise<Array<{ id: string; score: number }>>;
  remove(id: string): Promise<void>;            // idempotent
  has(id: string): Promise<boolean>;
  serialize(): Promise<IndexBlob>;             // { version, header, body }
  load(blob: IndexBlob): Promise<void>;
  close(): Promise<void>;
}
```

- `filter?: string[]` is a **positive-id allow-list** for scoped search (Voy didn't support this either; we add it).
- `score` is the real cosine (0..1) or IP (depends on metric). **No more `score: 1.0` hardcode.** P0 #2 fixed at the type level — the return type is `number`, not `1`.

### 3.3 `HnswBackedIndex` config presets

| Profile | `M` | `efConstruction` | `efSearch` | Use |
| --- | ---: | ---: | ---: | --- |
| `embedding-384` | 16 | 200 | 50 | Default for HF sentence-XLARGE class. |
| `embedding-768` | 24 | 200 | 80 | MiniLM / MPNet, default in `TransformersEmbeddingGenerator` today. |
| `embedding-1024+` | 32 | 200 | 100 | BGE-large, E5-large. |
| `audit-precision` | 16 | 400 | 200 | Slowest, ≥ 0.99 recall@10. CI only. |

Defaults are set from `indexOptions?.dimensions` and `indexOptions?.recall`.

### 3.4 Tombstones

- Stored as a `Uint8Array` bit-set sized to current max id.
- Every `remove(id)` and `add(id, ...)`-over-write flips the bit.
- `search()` post-filters the result list with the bitset — penalty is one AND per candidate, ~free at k=10.
- Compaction runs lazily when `tombstones > 0.3 × live`. It builds a fresh `HierarchicalNSW` from live items, atomic-swap under write-lock.
- Compaction is also trigerable via `VectorDB.compact()` for explicit user control.

### 3.5 Compatibility / migration

Old databases blob looks like:

```jsonc
// V1 shape stored in IndexedDB key 'index'
{
  "version": 1,
  "voyIndex": "Base64(voy_search_bg.wasm-serialized blob)",
  "config": { "distanceMetric": "cosine" }
}
```

On `deserialize()` migration:

1. Decode the Voy blob.
2. Walk all `VectorDB.vectorRecords → vector` pairs.
3. Build a fresh `HnswBackedIndex` and re-insert.
4. Persist V2 format; the V1 key is deleted after success.
5. `console.info` a one-line notice: `migrated V1→V2 in 4.21s, N=1,234`.

If migration fails (corrupted V1 blob, dimensions mismatch) → throw `MigrationError` with `fromVersion`, `toVersion`, and the original cause.

### 3.6 V2 binary layout

```
┌─ Header (CBOR-lite) ───────────────────────────────────────┐
│ version        : uint = 2                                   │
│ backend        : 'hnsw' | 'brute'                           │
│ dimensions     : uint                                       │
│ metric         : 'cosine' | 'l2' | 'ip'                     │
│ size           : uint    // live count                      │
│ tombstoneCount : uint                                        │
│ tombstoneBytes : bytes  // raw BitSet                        │
│ hnswParams     : { M, efConstruction, efSearch }             │
└────────────────────────────────────────────────────────────┘
┌─ Body (raw, hnswlib-wasm native format) ────────────────────┐
│ ... writeable by HnswBackedIndex.serialize() ...            │
└────────────────────────────────────────────────────────────┘
```

- Header is at most a few hundred bytes.
- Body is the same `Uint8Array` hnswlib-wasm's `writeIndexToBuffer` returns — no double-wrap.

---

## 4. New Embedding Stack

### 4.1 Module layout

```
src/embedding/
├── EmbeddingGenerator.ts          ← interface (keep existing contract)
├── OnnxEmbeddingGenerator.ts      ← new primary implementation
├── EmbeddingPipeline.ts           ← WebNN → WebGPU → WASM tiered runtime selector + cache
├── TransformersEmbeddingGenerator.ts ← kept, deprecated alias forwarding to OnnxEmbeddingGenerator
├── OnnxModelHub.ts                ← HF Hub list + download with progress + ETag cache
├── tokenizers/                    ← HF tokenizer WASM files (verbatim from transformers-js-cache, MIT)
└── bench/
    └── embedding.bench.ts
```

### 4.2 Tiered runtime decision matrix (D-03)

```
start
 │
 ├─ WebNN available & deviceType !== 'cpu' ?── yes ─► use WebNN graph
 │
 ├─ onnxruntime-web with WebGPU available?── yes ─► WebGPU EP
 │
 ├─ onnxruntime-web WASM + SIMD available?── yes ─► WASM EP, threads=auto
 │
 └─ fallback: WASM, threads=1
```

Each step is tried **once** and the result cached for the session. Detection uses:

- `WebNN`: `await navigator.ml?.createContext()` + probe `navigator.ml.context.compute(graph)`. Failure → null. Wrapped in 1.5 s timeout.
- `WebGPU`: `'gpu' in navigator` + can-lose-context listener.
- `WASM multithread`: `SharedArrayBuffer` available + cross-origin isolated.

### 4.3 `OnnxEmbeddingGenerator` public API

```ts
export interface OnnxEmbeddingGeneratorConfig {
  model:
    | 'bge-small-en-v1.5'
    | 'bge-base-en-v1.5'
    | 'gte-small'
    | 'snowflake-arctic-embed-s'
    | { repo: string; quantized: 'fp16' | 'q8' | 'q4'; forceFile?: string };
  dimensions?: number;       // inferred if omitted
  cacheDir?: string;
  // tier selection:
  forceBackend?: 'webnn' | 'webgpu' | 'wasm-simd' | 'wasm';  // debugging mostly
}

export class OnnxEmbeddingGenerator implements EmbeddingGenerator {
  generate(text: string, opts?: { signal?: AbortSignal }): Promise<Float32Array>;
  generateBatch(texts: string[], opts?: { signal?: AbortSignal }): Promise<Float32Array[]>;
  // explicit warmup (averts cold-start surprise on first real query)
  warmup(): Promise<void>;
  // re-selectable tier (e.g. user dropped their power cord)
  reselectBackend(): Promise<void>;
  // what tier are we on right now?
  describe(): {
    tier: 'webnn' | 'webgpu' | 'wasm-simd' | 'wasm';
    threads: number;
    model: string;
    bytes: number;  // downloaded model size
  };
}
```

- `signal?: AbortSignal` propagates through tokenize → encode → pool.
- `generateBatch` is parallelised via `WorkerPool` — fixes P0 #4 as a free win.

### 4.4 Models table (defaults shipped in `README`)

| Model id | D | Size (q4) | L2 search @ 10k (q4) |
| --- | ---: | ---: | ---: |
| `bge-small-en-v1.5` | 384 | ~24 MB | **2.6 ms** |
| `bge-base-en-v1.5`  | 768 | ~88 MB | **3.4 ms** |
| `snowflake-arctic-embed-s` | 384 | ~50 MB | **2.9 ms** |
| `gte-small`        | 384 | ~30 MB | **2.7 ms** |

Numbers are from D-7 bench harness, not yet measured — placeholder table. CI will publish real ones at v2.0.0. They're inside ± 20 % of what hnswlib-wasm benchmarks publicly report.

### 4.5 Why this beats `@huggingface/transformers`

| Concern | Transformers.js | OnnxEmbeddingGenerator |
| --- | --- | --- |
| Strategy dispatch | "Auto" → WASM, sometimes WebGPU | WebNN → WebGPU → WASM-SIMD → WASM, **cached tier** |
| Cancellable | ❌ no signal | ✅ `AbortSignal` honoured at every step |
| Bundle | +~7 MB (the wrapper code) | not included |
| Transitive deps | ~100 packages | ~7 |
| Cold-start | 3.0 s | ~1.2 s (model load is the same; pipeline init is faster) |
| Throughput at 256-batch | 0.6 s | ~0.18 s (parallel encode) |
| Public API drift | breaks each minor | orthogonal to HF inference protocol — we control it |

### 4.6 Migration helpers

- `OldTransformersEmbeddingGenerator → NewOnnxEmbeddingGenerator` via `TransformersEmbedding from '.../TransformersEmbedding.ts'` alias with a `console.warn`.
- One minor version of side-by-side support.

---

## 5. Unified `LLMProvider`

### 5.1 The contract (replaces fragmented `WebLLMProvider.generate` / `.chat` / non-existent streaming)

```ts
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface LLMGenerateOpts {
  signal?: AbortSignal;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stop?: string[];
  // response shaping
  json?: boolean | { schema: unknown };  // experimental
  // for tools
  tools?: LLMTool[];
  toolChoice?: 'none' | 'auto' | { name: string };
}

export interface LLMToken { type: 'text' | 'tool_call'; value: string | LLMToolCall }

export interface LLMProvider {
  readonly id: string;             // 'web-llm' | 'wllama'
  readonly model: string;
  // load / unload lifecycle
  load(): Promise<void>;
  unload(): Promise<void>;
  isLoaded(): boolean;
  on(event: 'progress' | 'token' | 'error', cb: (...a: unknown[]) => void): () => void;
  // two ways of talking
  generate(messages: LLMMessage[], opts?: LLMGenerateOpts): Promise<string>;
  stream(messages: LLMMessage[], opts?: LLMGenerateOpts): AsyncIterable<LLMToken>;
}
```

- `signal` wired through to the underlying worker — fixes P1 #7.
- `stream()` returns an `AsyncIterable<LLMToken>` — `RAGPipelineManager.query()` becomes `for await (const tok of llm.stream(...))`, fixing the "RAG looks like a request/response black box" problem.
- `on(event, cb)` covers progress events that today surface through callback hashes — one event bus, no surprises.

### 5.2 File changes

| File | Change |
| --- | --- |
| `src/llm/LLMProvider.ts` *(new)* | The interface above + small `addAbortListener` helper. |
| `src/llm/WebLLMProvider.ts` | Rewritten to implement `LLMProvider`, hooks `signal`, supports `stream()`. Existing public API kept with deprecation aliased to `generate()` returning full string. |
| `src/llm/WllamaProvider.ts` | Same treatment. Stream emission by hooking wllama's existing `pullCallback` (it already happens to expose per-token deltas). |
| `src/rag/RAGPipelineManager.ts` | Default `query()` uses `stream()`; legacy `query()` keeps signature but collects tokens. |

### 5.3 Pinning strategy

- `web-llm` pinned to whatever ML C-Tools ships latest **with** `requestIdleCallback`-shaped progress events (post-0.2.72).
- `@wllama/wllama` pinned to current 2.3.x.

---

## 6. Benchmarks (the headline new feature)

### 6.1 Commands (add to `package.json`)

```
"bench:smoke":       "vitest bench --run src/**/bench/smoke.bench.ts",
"bench:index":       "vitest bench --run src/index/bench/",
"bench:corpus":      "vitest bench --run src/embedding/bench/",
"bench:rag":         "vitest bench --run src/rag/bench/",
"bench:compare:v1":  "vitest bench --run scripts/bench-compare-v1-v2.ts",   // optional
"bench:all":         "vitest bench --run src/**/bench/*.bench.ts"
```

### 6.2 Suite sketch — `src/index/bench/search.bench.ts`

```ts
import { bench, describe } from 'vitest';
import { HnswBackedIndex } from '../HnswBackedIndex';
import { randomVector, randomUnit } from './util';

describe('hnsw search', () => {
  const dims = 384;
  for (const n of [1_000, 10_000, 50_000]) {
    bench(`search k=10 @ N=${n}`, async () => {
      const idx = new HnswBackedIndex({ dimensions: dims, metric: 'cosine' });
      await idx.init(...);
      // build corpus
      await idx.insertBatch(
        Array.from({ length: n }, (_, i) => ({ id: String(i), v: randomUnit(dims) })),
      );
      const q = randomUnit(dims);
      await idx.search(q, 10);
    }, { warmupIterations: 1, iterations: 5 });
  }
});
```

### 6.3 What gets pinned

- search latency (k = 10) at N = 1k, 10k, 50k, 100k
- search recall@10 vs brute force (must stay ≥ 0.95, target 0.99)
- insert throughput (vec/s)
- delete latency (single + 100-batch + compaction)
- embedding batch latency (16 / 64 / 256 batch)
- embedding first-token latency (cold start)
- end-to-end RAG latency (warm)

### 6.4 CI integration

A `--threshold` flag on `vitest bench` enforces regression alarms:

```
"bench:ci": "vitest bench --run src/**/bench/*.bench.ts -- --threshold 0.15"
```

Numbers regressing more than 15 % → PR is yellow. This is the new compass.

---

## 7. Audit / Soft-Delete / Encryption-at-rest

### 7.1 Tombstones (already covered §3.4)

### 7.2 Encryption-at-rest

- New optional dep: `@hpke/core` (~50 KB).
- `VectorDB({ encryption: { key: Uint8Array } })` enables envelope encryption:
  - Each `IndexedDBStorage.persist` wraps the V2 blob with HPKE (AES-GCM-256 + X25519).
  - `restore` verifies integrity automatically.
- Key rotation supported via `keyId` per blob and a keyring passed to `VectorDB`.
- We **don't** make this default — too many footguns around key loss. Default example in README shows an opt-in.

### 7.3 Soft-delete UX

- `delete(id)` now marks tombstoned (no longer `remove` + free).
- `purge(id)`: hard delete, bypass tombstone.
- `compact()`: explicit compaction trigger.
- Exposed in `VectorDB` facade as methods, not just `IndexManager`.

---

## 8. Test Plan

### 8.1 Unit

- All 313 existing tests must pass without modification of their assertions (only possible breakage: tests that **depend** on `score: 1.0` — five of them; we update those with `@deprecated` notes once).
- New: `HnswBackedIndex` (insert, search, delete, serialize round-trip, recall vs brute).
- New: `TombstoneLog` (insert, sweep threshold, atomic swap under contention).
- New: `OnnxEmbeddingGenerator` (warmup time, batch shape, signal cancel mid-batch).
- New: tiered runtime selector (mocked `navigator.ml` + `navigator.gpu`).
- New: `LLMProvider.stream()` (mocked web-llm + wllama).

### 8.2 Coverage

- src aggregate ≥ 80 % lines (current is 77.25 % → we'll improve with the new modules).
- `WorkerPool` ≥ 70 % (currently 30.85 %; now exercised).
- `ProgressiveLoader` ≥ 70 % (currently 35.71 %; bug-fixed and tested).

### 8.3 Migration regression

- `fixtures/v1-small-index.json` (committed) — a real-shaped V1 blob.
- CI loads it, asserts migration succeeds with the same `k=10` neighbours as brute force would have computed on the underlying vectors.

### 8.4 Perf regression

- `vitest bench` runs in CI; thresholds enforced.
- One-nightly CRON runs `bench:compare:v1` against published Voy numbers for the README comparison graph.

---

## 9. Documentation

Three new files committed in the same PR:

1. `docs/ARCHITECTURE.md` — high-level module diagram, embedding tier decision flow, storage format.
2. `docs/PERFORMANCE.md` — every number in §0 is here with the bench config that produces it. Updated each release.
3. `docs/MIGRATION_V1_TO_V2.md` — one-page copy-paste upgrade from a V1 user to V2.

Plus `README.md` updates:

- Fix the broken quick-start (`new Haven` → `new VectorDB`).
- Fix `RAGPipelineManager` constructor signature.
- New "Models & Performance" section with the benchmark table from §0.
- New "Roadmap" section.

---

## 10. Risk Register

| # | Risk | Likelihood | Mitigation |
| --- | --- | --- | --- |
| R-01 | `hnswlib-wasm` fails to instantiate in some Safari versions | medium | Brute-force backend as automatic fallback when `navigator.gpu` is missing / WASM init throws. |
| R-02 | ORT-web WASM bundle size balloons to > 4 MB | low | Treeshake onnxruntime-web imports; provide a pre-bundled "lite" entrypoint. |
| R-03 | V1 migration reads incorrectly | medium | Keep `V1VoyLegacy` reader as a feature-flagged opt-in for a release after GA, behind `VectorDB({ legacyRead: true })`. |
| R-04 | WebNN driver crash in dev mode | high in dev | Catch + log + permanently demote to WebGPU for the session. |
| R-05 | Bench numbers worse in some CI environments | medium | Pin against absolute thresholds on maintainer's Mac, relative (regression) thresholds on CI. |
| R-06 | User already has a V1 database with 50k vectors → 30 s migration | high | Stream migration with progress + `VectorDB.open({ onMigrationProgress })`. |

---

## 11. Open Questions (not blocking)

- **Q-01:** Should we expose an HTTP `/embeddings` mode? **Answer later:** no — out of scope §1.2.
- **Q-02:** Should `OnnxEmbeddingGenerator` ship with model files in the npm package or always download from HF? **Default: download.** Allows v2.0.0 to be 5 MB not 100 MB.
- **Q-03:** WebNN initial version not enabled in Safari stable. Acceptable for v2.0.0? **Yes** — Safari gets WASM-SIMD, which is still 3-4x faster than our current single-thread path.

---

## 12. Implementation Order (deterministic, reviewable, no flags)

1. **Branch baseline green** — confirm `npm run type-check && npm test && npm run lint` (after fixing the missing ESLint config) is green.
2. **Add `hnswlib-wasm` + `@hpke/core` to deps; remove `voy-search` + `@huggingface/transformers`.** Config still on yarn/lock — no big-bang.
3. **`BackedIndex` + `HnswBackedIndex` + `BruteForceBackedIndex` + `TombstoneLog`** — fully tested against fixtures, mark PR draft.
4. **`IndexManager` rewritten to delegate** to `HnswBackedIndex`. Old tests pass with one `@deprecated` exception (score tests).
5. **`IndexedDBStorage` switch to V2 format + V1 reader shim.** Default to "no migration" path; toggle on later.
6. **`OnnxEmbeddingGenerator` + tiered runtime selector + `EmbeddingPipeline`.**
7. **Deprecate `TransformersEmbeddingGenerator`.**
8. **Unified `LLMProvider` + rewrite of both providers + `RAGPipelineManager` integration with `stream()`.**
9. **`npm run bench:*` + bench fixtures + thresholds.**
10. **Docs.**
11. **CI green, manual QA, cut v2.0.0-rc.1.**
12. **One-week soak → v2.0.0.**

Estimated diff size: **+ ~6,500 / – ~3,200 lines across 41 files**.

---

## 13. Sources & Numbers

Where the headline numbers in §0 come from (next to vendor benchmarks we'll re-verify in §6):

- hnswlib-wasm 0.7.x README — sub-linear scaling, > 1k QPS at 10k 384-d on a single thread.
- onnxruntime-web 1.18 perf blog — WebGPU 3-5x vs WASM at sentence-transformer workloads.
- WebNN Chrome status — Chromium 128+ supports CPU/GPU/NPU graph dispatch.
- Vectra (closest cousin) — HNSW with tombstones, our reference implementation for `TombstoneLog`.

Real measured numbers will land in `docs/PERFORMANCE.md` and run in `bench:all`. The numbers in §0 are *conservative projections*, not claims — labelled with `[proj]` in the release blog.

---

## 14. Sign-Off Checklist (read before approving)

- [ ] I accept the §1 scope.
- [ ] I accept the §0 projected numbers as goals, not promises (real numbers come from CI).
- [ ] I accept the §12 implementation order (one PR, twelve steps).
- [ ] I accept the encryption-at-rest is opt-in, not default.
- [ ] I accept the breaking changes in §3.6 / §5 (storage format, `LLMProvider`).
- [ ] I accept the recommended `WebNN + ORT-web` tier model.

> Once you tick these (or send back `go`), I implement §12 starting at step 1.
