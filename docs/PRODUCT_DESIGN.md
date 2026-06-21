# Domicile — Product Design (HLD + LLD)

**Status:** Proposed · **Author:** senior architecture review · **Scope:** the full Domicile product — brand unification, platform architecture, and low-level design of every component.

> **Implementation status (2026-06):** the engine redesign described here is
> largely implemented — the seam contracts, `createDomicile()` factory,
> HnswIndex, RAG pipeline, MCP server, CLI, React hooks, and desktop/web
> playgrounds all ship. One divergence from the plan below: the `index-voy`
> legacy package was **not** retained — HnswIndex won the benchmark gate
> (TECHNICAL_VALIDATION.md §2.2) and Voy was removed outright, so `index-hnsw`
> is the only index. The planned pnpm workspace split (Part A4) is future work;
> the code currently lives flat in `src/`.

This document supersedes the single-library framing. Domicile is not one npm package; it is a **private-AI custody platform** whose centerpiece is an in-browser engine, surrounded by SDKs, a CLI, a standalone MCP server, and a reference desktop app. It operationalizes `TECHNICAL_VALIDATION.md` (what to fix/replace/build) and `MARKET_ANALYSIS.md` (who buys and why) into a concrete architecture and per-component low-level design.

**Reading order:** Part A is the senior-architect high-level design (vision, full product surface, system architecture, monorepo, roadmap). Part B is the senior-engineer low-level design — one section per package/component, with contracts, types, data flow, failure modes, and tests.

---

# PART A — HIGH-LEVEL DESIGN (Architect)

## A1. The rebrand: Haven → Domicile

The repo and npm package are named **Haven** (`package.json` name `haven`, README headline "Haven", Vite lib name `BrowserVectorDB`, `src/index.ts` `VERSION = '0.1.0'`). The public website (`showcase/index.html`) has already rebranded to **Domicile**: title "Domicile — On-prem privacy, in the browser", `npm install domicile`, `import Domicile from 'domicile'`, `new Domicile({...})`, footer "MIT © 2024 Domicile". The market analysis (§4 Weaknesses, §8.1) flags this split as unresolved positioning that must be fixed.

**Decision: unify on Domicile.** Rationale:
- The website is the brand authority and it has chosen. The repo trailing it is pure drift, not a deliberate dual-brand.
- "Domicile" carries the product thesis literally — *data domiciled on the device* — which is the moat ("architectural privacy," MARKET_ANALYSIS.md §5). "Haven" is generic and does not encode the residency argument.
- The legal/editorial identity already built (oxblood + parchment, Fraunces serif, "privilege is a boundary you build") is Domicile's. Throwing it away to keep "Haven" would discard finished brand work.

**Rename scope (executed in Phase 0, §A7):**
- GitHub repo rename `Haven` → `domicile` (redirect preserved). Site links already point at `github.com/kyrillosishak/Haven` — update.
- npm: publish `domicile` as the primary package; `haven` becomes a deprecated stub that re-exports `domicile` with a one-time deprecation notice, held for two majors then retired. (Avoids breaking the existing `npm install haven` install path during transition.)
- Code: `package.json` `name` → `domicile`; Vite `build.lib.name` `BrowserVectorDB` → `Domicile`; default export `Domicile`; class `VectorDB` remains the internal facade name but the umbrella re-exports it as `Domicile`. `src/index.ts` `VERSION` bump to `0.2.0` (the rename + restructure is a minor; API shape preserved by the seam work).
- Docs/site: already Domicile; align README and all `docs/*.md` headers.
- Scope packages under `@domicile/*` (not `@haven/*`).

The rename is mechanical and must land *first*, before the restructure, so the workspace is born under the right name.

## A2. Product vision

**One sentence:** Domicile is the architecturally-private AI custody layer — vector store, RAG, and local LLM that run entirely on the user's device — productized as a library, SDKs, a CLI, an MCP server, and a reference desktop app, sold through integrators into regulated verticals starting with legal.

**The full product surface** (this is what "the full product" means — not just the library):

| Product | Audience | Form | Status |
|---|---|---|---|
| **Domicile Core** (engine) | developers, integrators | npm packages `@domicile/*` | exists (as `haven`), needs restructure |
| **Domicile CLI** | integrators | `npx domicile` binary | new — build |
| **Domicile MCP Server** | agent ecosystems | standalone runnable + lib | exists as tool registry; needs transport — build |
| **Domicile Desktop** | law firms (end users) | Tauri/Electron reference app | new — build (the showcase becomes a product) |
| **Domicile React** | web developers | `@domicile/react` hooks | new — build |
| **Domicile Python** | data/legal-ops | PyScript bindings | roadmap (README already lists it) |
| **Domicile Studio** (docs + showcase + playground) | all | static site | exists as `showcase/`; expand |
| **Integrator Pack** | integrators/channel | templates, residency profiles, hand-off tooling | new — build |

The strategic logic (from MARKET_ANALYSIS.md §3): **demand-side** (law firms) buy outcomes — they get Desktop; **supply-side/channel** (integrators) buy a platform — they get Core + CLI + MCP + Integrator Pack. The library alone serves neither fully; the platform serves both.

## A3. System architecture

A strictly-layered, residency-bounded system. All compute happens on-device; the boundary is architectural (MARKET_ANALYSIS.md §5). Data flows down through the layers; answers flow up. No layer above may be imported by a layer below.

```
┌─────────────────────────────────────────────────────────────────┐
│  SURFACE            Desktop app · CLI · MCP server · React hooks │
├─────────────────────────────────────────────────────────────────┤
│  PROTOCOL           @domicile/mcp  (tools + wire transport)      │
├─────────────────────────────────────────────────────────────────┤
│  INTELLIGENCE       @domicile/rag  (chunk · retrieve · rerank ·  │
│                     hybrid · prompt · generate · cite)           │
├─────────────────────────────────────────────────────────────────┤
│  RUNTIME            @domicile/llm-*   (webllm · wllama · fallback)│
│                     @domicile/embedding-transformers              │
├─────────────────────────────────────────────────────────────────┤
│  RETRIEVAL          @domicile/index-hnsw  (default) / index-voy   │
├─────────────────────────────────────────────────────────────────┤
│  CUSTODY            @domicile/storage-indexeddb  (IndexedDB)      │
├─────────────────────────────────────────────────────────────────┤
│  CONTRACTS          @domicile/core  (interfaces · facade · errors)│
├─────────────────────────────────────────────────────────────────┤
│  ACCELERATION       WebGPU · WASM/SIMD · Workers (SharedArrayBuffer)│
└─────────────────────────────────────────────────────────────────┘
            ↑ everything above this line runs on-device; zero egress ↑
```

Three architectural invariants, enforced by review + tests:
1. **`@domicile/core` depends on nothing.** It is pure types + the facade. Every other package depends on it; it depends on none. This is what makes any runtime component swappable.
2. **The facade (`Domicile`/`VectorDB`) is constructed from injected interfaces.** No concrete adapter is imported by core. (Today `core/VectorDB.ts:5-8` hard-imports `IndexedDBStorage`, `IndexManager`, `TransformersEmbedding` — this is the #1 thing to fix.)
3. **The residency boundary is never pierced.** No package initiates outbound network for user data. Model-weight downloads (Transformers.js, WebLLM, wllama) are the *only* egress, are cache-once, and are configurable to a self-hostable origin. A test asserts no `fetch`/`XMLHttpRequest` to non-allowlisted hosts outside the model loader.

## A4. Monorepo decision

**Decision: pnpm workspace monorepo, one package per versionable boundary.** This is not ceremony for a 50-file codebase — it is the mechanism that makes the seam work in Part B real. With everything in one flat `src/`, "program to interfaces" is an aspiration; with `@domicile/core` as a dependency-zero package, it is enforced by the import graph.

**Why not stay single-package:** the current shape hard-couples the facade to concrete adapters (A3 invariant #2 is violated in code today), exposes one giant barrel (`src/index.ts` re-exports ~40 symbols with no stable/internal distinction), and makes it impossible to install "just the vector DB" without dragging in WebLLM + wllama + Transformers.js. The market analysis (§5) says the moat is integration + positioning, not any component — so we should be free to swap any component, which requires seams, which require package boundaries.

**Why not polyrepo (many repos):** too early. The team is small; the packages co-evolve (a `core` interface change ripples through adapters); cross-repo version skew would kill velocity. One repo, many packages, independent versioning via changesets. Polyrepo is an exit option if a package (e.g. Desktop) grows a separate team.

**Workspace layout:**

```
domicile/
├── packages/
│   ├── core/                      # contracts + facade. ZERO deps.
│   ├── storage-indexeddb/         # StorageManager impl
│   ├── index-hnsw/                # Index impl (DEFAULT) — hnswlib-wasm
│   ├── index-voy/                 # Index impl (LEGACY) — voy, deprecated
│   ├── embedding-transformers/    # EmbeddingGenerator — @huggingface/transformers
│   ├── llm-webllm/                # LLMProvider (WebGPU) — @mlc-ai/web-llm
│   ├── llm-wllama/                # LLMProvider (WASM) — @wllama/wllama
│   ├── llm-fallback/              # LLMProvider cascade (WebGPU → WASM)
│   ├── rag/                       # chunk · retrieve · rerank · hybrid · prompt · generate
│   ├── mcp/                       # tool registry + stdio/SSE transport
│   ├── performance/               # LRU · memory · workers · batch · true streaming
│   ├── cli/                       # `domicile` binary
│   ├── desktop/                   # Tauri reference app
│   ├── react/                     # `@domicile/react` hooks
│   └── domicile/                  # umbrella: re-exports stable API + createDomicile()
├── apps/
│   └── studio/                    # docs + showcase + playground (the current showcase/, expanded)
├── examples/                      # consumer demos
├── docs/
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── changeset/                     # changesets config
└── package.json                   # root: scripts, devDeps, workspace
```

**Dependency direction (enforced):** `domicile` (umbrella) → `{rag, mcp, performance}` → `{core}`; adapters `{storage-indexeddb, index-*, embedding-*, llm-*}` → `{core}`. `desktop`, `cli`, `react` → umbrella or selected packages. **No lateral imports** (e.g. `rag` may not import `index-hnsw`; it goes through the `Index` interface in `core`). A `dpdm`/`madge` lint rule in CI asserts this.

## A5. Component responsibility matrix (HLD)

| Component | Owns | Does NOT own | Build/Buy/Replace |
|---|---|---|---|
| `core` | contracts, facade, errors, ID gen | any runtime | keep (refactor) |
| `storage-indexeddb` | persistence, quota, streaming export | indexing | keep (fix) |
| `index-hnsw` | ANN with real scores, incremental delete | persistence | **build (new default)** |
| `index-voy` | (legacy) | — | replace-default, then deprecate |
| `embedding-transformers` | text/image embeddings, batching, model cache | model files | buy (Transformers.js) + own batching |
| `llm-webllm` | GPU generation | model files | buy (WebLLM) |
| `llm-wllama` | CPU generation, streaming | model files | buy (wllama) + fix streaming |
| `llm-fallback` | WebGPU→WASM cascade | inference | **build (new)** |
| `rag` | chunk, retrieve, rerank, hybrid, prompt, cite | storage, inference | **build (the moat)** |
| `mcp` | tool registry + wire transport + matter scoping | RAG logic | build (finish) |
| `performance` | caches, memory, workers, batch, streaming | business logic | keep (fix fake-stream) |
| `cli` | scaffold, config, serve MCP, benchmark, export/import | runtime | **build (new)** |
| `desktop` | reference app UX | engine | **build (new)** |
| `react` | hooks binding | engine | **build (new)** |
| `domicile` (umbrella) | stable API surface + default factory | internals | keep |

Principle recap (TECHNICAL_VALIDATION.md §3): **own the seams, custody, orchestration, and quality layers; buy the inference and embedding primitives; replace only the index, because Voy's limits leak into product quality.**

## A6. Cross-cutting concerns

**A6.1 Residency boundary.** A single `ResidencyGuard` in `core` (test-only, tree-shaken in prod builds) instruments all outbound I/O. Model-weight fetches go through a `ModelSource` abstraction with an allowlist; any other egress throws `ResidencyViolationError`. This makes the architectural-privacy claim (MARKET_ANALYSIS.md §5) machine-checkable, not rhetorical — a selling point for regulated buyers.

**A6.2 Capability detection.** One `detectCapabilities()` in `core` returns `{ webgpu, wasm, simd, sharedArrayBuffer, indexedDB, deviceMemory, maxTextureSize }`. Every adapter probes it; `createDomicile()` uses it to pick WebLLM vs wllama, and the Desktop app renders the device matrix (the showcase already shows a capability panel — `showcase/index.html` lines 456-462). Today capability checks are scattered (`WebLLMProvider.checkWebGPUAvailability`, inline in showcase). Centralize.

**A6.3 Versioning & release.** Changesets per package; independent semver. `@domicile/core` is the strictest — a breaking type change bumps every dependent and the umbrella major. Adapter swaps that don't change the public API (Voy→hnsw) are a *minor* umbrella bump, because the facade contract is unchanged — that is the entire payoff of the seam work. The deprecated `haven` npm stub tracks `domicile` majors.

**A6.4 The model strategy.** A `ModelRegistry` in `core` (data in `embedding-transformers`/`llm-*`) maps model IDs → `{ dimensions, sizeMB, deviceTier, license }`. `createDomicile()` picks a model tier from `detectCapabilities().deviceMemory`. This closes the "model swap silently bricks the index" bug (TECHNICAL_VALIDATION.md §2.3) and the "4GB model OOMs a laptop" risk (§2.4) with one mechanism.

## A7. Phased roadmap (shippable at each gate)

- **Phase 0 — Rename + scaffold.** Haven→Domicile everywhere; pnpm workspace; `tsconfig.base.json`; changesets; `haven` npm stub. *Gate: build + tests green; `npm install domicile` works.*
- **Phase 1 — Extract `core`, decouple facade.** Move interfaces to `@domicile/core`; refactor `VectorDB` to injection; land low-risk fixes (real cosine scores, native typed-array persistence, true-streaming export, wllama peerDep). *Gate: facade imports zero concrete adapters.*
- **Phase 2 — Split adapters into packages; build `llm-fallback`.** One package per adapter; fix wllama streaming; fix `embedBatch` true batching. *Gate: forced-WebGPU-off cascades to wllama without throwing.*
- **Phase 3 — Replace index.** Build `index-hnsw`; benchmark vs voy on 10K/50K/100K; flip default; deprecate `index-voy`. *Gate: hnsw wins on score + delete + filtered recall.*
- **Phase 4 — Build the RAG moat.** Chunking, reranker, hybrid search, real-tokenizer truncation, configurable prompt, model registry + re-embed migration. *Gate: citation-accuracy benchmark closes the gap to cloud frontier on grounded Q&A.*
- **Phase 5 — Finish MCP + build CLI.** Real MCP transport (stdio/SSE); matter scoping; `domicile` CLI (scaffold/serve/bench/export/import). *Gate: Claude Desktop talks to a Domicile MCP server.*
- **Phase 6 — Desktop + React.** Tauri reference app (the showcase becomes a product); `@domicile/react` hooks. *Gate: a lawyer can load a matter folder and ask grounded questions with citations, offline.*
- **Phase 7 — Studio + Integrator Pack.** Expand docs/playground site; residency-profile templates; hand-off export tooling. *Gate: an integrator can scaffold a branded custody deployment from a template.*

---

# PART B — LOW-LEVEL DESIGN (Senior Engineer)

One section per component. Each gives: responsibility, public contract (the stable API), internal structure, data flow, failure modes + fixes (tied to `TECHNICAL_VALIDATION.md`), tests, dependencies, versioning.

## B1. `@domicile/core` — contracts, facade, errors

**Responsibility.** Define every seam (`StorageManager`, `Index`, `EmbeddingGenerator`, `LLMProvider`, `Filter`, `VectorRecord`), the `Domicile`/`VectorDB` facade that orchestrates them, the error hierarchy, ID generation, capability detection, and the residency guard. **Zero runtime dependencies.**

**Public contract (the API we semver-lock):**

```ts
// types.ts
export interface VectorRecord { id: string; vector: Float32Array; metadata: Record<string, unknown>; timestamp: number; }
export type Filter = MetadataFilter | CompoundFilter;
export interface MetadataFilter { field: string; operator: 'eq'|'ne'|'gt'|'gte'|'lt'|'lte'|'in'|'contains'; value: unknown; }
export interface CompoundFilter { operator: 'and'|'or'; filters: Filter[]; }

export interface StorageManager { /* B2 */ }
export interface Index { /* B3 */ }
export interface EmbeddingGenerator { /* B4 */ }
export interface LLMProvider { /* B5 */ }

export interface DomicileConfig {
  storage: StorageManager;
  index: Index;
  embedding?: EmbeddingGenerator;   // optional if caller supplies vectors directly
  performance?: PerformanceConfig;  // from @domicile/performance
  residency?: ResidencyConfig;
}

export class Domicile {                       // re-exported as `Domicile` by umbrella
  constructor(config: DomicileConfig);
  initialize(): Promise<void>;
  insert(data: InsertData): Promise<string>;
  insertBatch(data: InsertData[]): Promise<string[]>;
  search(query: SearchQuery): Promise<SearchResult[]>;
  delete(id: string): Promise<boolean>;
  update(id: string, data: Partial<InsertData>): Promise<boolean>;
  clear(): Promise<void>;
  size(): Promise<number>;
  export(options?: ExportOptions): Promise<ExportData>;
  exportStream(options?: ExportOptions): AsyncGenerator<ExportChunk>;
  import(data: ExportData, options?: ImportOptions): Promise<void>;
  dispose(): Promise<void>;
}
```

**Internal structure.** `types.ts`, `Domicile.ts` (facade, ~lean — moves all current concrete wiring out), `errors.ts` (keep the existing `VectorDBError`/`StorageQuotaError`/`DimensionMismatchError`/`IndexCorruptedError` hierarchy, add `ResidencyViolationError`), `ids.ts` (extract `generateId` — currently `${Date.now()}-${Math.random()...}` in `VectorDB.ts:932`; replace with `crypto.randomUUID()` where available for collision safety), `capabilities.ts` (`detectCapabilities()`), `residency.ts` (the guard).

**Critical refactor vs today.** `core/VectorDB.ts:50-83` hard-instantiates `IndexedDBStorage`, `IndexManager`, `TransformersEmbedding`. In core, the constructor *receives* them; instantiation moves to the umbrella's `createDomicile()` factory (B14). This is the single highest-leverage change in the whole redesign.

**Failure modes.** None new — core is types. Risk is *contract drift*: an adapter violating an interface. Mitigation: each interface has a corresponding `__type` test fixture and an `invariant` dev-mode check.

**Tests.** Contract tests (each interface has a shared test suite every adapter must pass — `test/StorageManager.contract.test.ts` etc., run against every implementation). Facade orchestration tests with mock adapters. Residency-guard tests asserting no egress.

**Deps.** none. **Versioning.** strictest semver in the repo.

## B2. `@domicile/storage-indexeddb` — custody

**Responsibility.** Persistent on-device storage of `VectorRecord`s + serialized index, quota-aware, with true streaming.

**Public contract.** Implements `StorageManager` (B1). Adds an optional `stream()` for true export.

```ts
export interface IndexedDBStorageConfig { dbName: string; version?: number; }
export class IndexedDBStorage implements StorageManager {
  initialize(): Promise<void>;
  put(record): Promise<void>; putBatch(records): Promise<void>;
  get(id): Promise<VectorRecord|null>; getBatch(ids): Promise<VectorRecord[]>;
  getAll(): Promise<VectorRecord[]>; stream(): AsyncIterable<VectorRecord>;
  delete(id): Promise<boolean>; clear(): Promise<void>; count(): Promise<number>;
  filter(predicate: Filter): Promise<VectorRecord[]>;
  saveIndex(serialized: string): Promise<void>; loadIndex(): Promise<string|null>;
  close(): Promise<void>; destroy(): Promise<void>;
}
```

**Internal structure.** Mirrors current `src/storage/IndexedDBStorage.ts` (three object stores: `vectors`, `index`, `metadata`), but: (a) `serializeRecord` stores the `Float32Array` buffer natively (structured clone handles `ArrayBuffer`) instead of `Array.from` — fixes the memory-doubling bug, TECHNICAL_VALIDATION.md §2.1; (b) `stream()` is a cursor-backed async iterator yielding records one at a time, which `exportStream` consumes directly.

**Failure modes & fixes.**
- *Full-table scans on filter/delete* (§2.1): add IndexedDB indexes for hot fields (`matter`, `category`, `date`); for arbitrary filters keep the cursor scan but cap + document. Maintain an in-memory `id → {vectorRef}` map so `Index.remove` doesn't force `getAll()` (see B3).
- *Batch transaction timeout* on huge inserts: chunk via `chunkSize` (already in `PerformanceConfig`); surface progress.
- *No schema migration*: real `onupgradeneeded` switch keyed on `oldVersion → newVersion`; index-rebuild is the fallback for breaking changes (already partially handled via `IndexCorruptedError`).

**Tests.** The shared `StorageManager.contract.test.ts` + quota-exceeded simulation (fake-indexeddb, already a devDep) + streaming-correctness test (stream yields same set as `getAll`, no double-load).

**Deps.** `@domicile/core`. **Versioning.** independent.

## B3. `@domicile/index-hnsw` (default) and `@domicile/index-voy` (legacy)

**Responsibility.** Approximate nearest-neighbour search with **real scores** and **non-rebuilding delete**.

**Public contract.** Implements `Index` (B1). Non-negotiables:

```ts
export interface Index {
  initialize(): Promise<void>;
  add(vector: VectorRecord): Promise<void>;
  addBatch(vectors: VectorRecord[]): Promise<void>;
  remove(id: string): Promise<void>;                 // MUST NOT rebuild the whole index
  search(query: Float32Array, k: number, filter?: Filter): Promise<IndexHit[]>;
  serialize(): Promise<SerializedIndex>;
  deserialize(data: SerializedIndex): Promise<void>;
  clear(): Promise<void>;
  stats(): IndexStats;
}
export interface IndexHit { id: string; score: number; }  // real similarity, never placeholder
```

**Why replace Voy.** `src/index/IndexManager.ts:286` hardcodes `score: 1.0` ("Voy doesn't expose distance/score"); `remove()` (line 214) calls `storage.getAll()` + full `build()` on every delete; `persistIndex()` (line 144) re-serializes the *entire* index on every single `add`; filtered search is post-hoc with N storage round-trips (line 271). These leak straight into product quality (no ranking signal for citations — fatal for the legal value prop, MARKET_ANALYSIS.md §3.1). The interface makes the contract explicit so no adapter can regress to placeholder scores.

**`index-hnsw` internal structure.** Thin wrapper over `hnswlib-wasm` (vendored). Maintains `id ↔ internalLabel` map. `remove` uses hnswlib's marked-deletion / lazy-removal (no rebuild). `search` returns true cosine distance → score. Persistence: serialize the hnsw graph to a binary `ArrayBuffer` stored by `StorageManager.saveIndex` — *not* a JSON string (Voy's path), so it's compact and incrementally updateable. Filtered search: over-fetch `k * f` (f from filter selectivity estimate) then apply filter; if under-filled, re-search with larger f (bounded retries) — guarantees recall where Voy's `k*3` heuristic does not.

**`index-voy` internal structure.** The current `IndexManager` behind the new `Index` interface, with the **immediate fix**: compute cosine scores in-wrapper from the stored query vector + each candidate vector (one dot product per candidate) so scores are real even before the hnsw swap. This is a Phase-1 fix that ships value without waiting for Phase 3.

**Failure modes & fixes.**
- *Full-reserialize on every insert* (§2.2): debounce/batch persistence — don't `persistIndex()` per `add()`; flush on batch completion or idle. Both adapters.
- *Filtered-search under-fill*: bounded re-search (hnsw); documented ceiling (voy).

**Tests.** Shared `Index.contract.test.ts` (every impl passes): add/search/remove/recall. Recall test: insert N synthetic vectors, assert top-k recall ≥ 0.95 vs brute force. Delete test: assert `remove` is O(1)-ish (bench, not full rebuild). Score test: assert returned scores are real distances, not `1.0`.

**Deps.** `@domicile/core`; `hnswlib-wasm` (hnsw) / `voy-search` (voy). **Versioning.** independent; the umbrella default flip (voy→hnsw) is a minor umbrella bump.

## B4. `@domicile/embedding-transformers`

**Responsibility.** Text + image embeddings via Transformers.js, WebGPU→WASM fallback, **true batched** inference, model cache.

**Public contract.** Implements `EmbeddingGenerator` (B1):

```ts
export interface TransformersEmbeddingConfig {
  model: string; device?: 'wasm'|'webgpu'; cache?: boolean; quantized?: boolean;
  maxRetries?: number; retryDelay?: number; modelSource?: ModelSource; // residency-allowlisted origin
}
export class TransformersEmbedding implements EmbeddingGenerator {
  initialize(): Promise<void>;
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;   // TRUE batch — one pipeline call
  embedImage?(image: ImageData|Blob): Promise<Float32Array>;
  getDimensions(): number;
  dispose(): Promise<void>;
}
```

**Internal structure.** Current `src/embedding/TransformersEmbedding.ts` is correct in shape (pipeline init, retry/backoff, mean-pool+normalize, WebGPU→WASM fallback, image via canvas→Blob). **Fix `embedBatch`** (line 128): it loops `for (const text of texts)` — replace with a single batched pipeline call; `extractEmbedding` already has a 2D-array branch (`data[0]`) so the plumbing exists. Plumb `modelSource` through `env` so weight fetches respect the residency allowlist (A6.1).

**Failure modes & fixes.**
- *Model swap bricks index* (§2.3): `ModelRegistry` (A6.4) validates `model.dimensions === index.dimensions` on init; `createDomicile()` offers a re-embed migration path.
- *First-load blocks on multi-MB download*: pre-warm on app idle (not first search); surface `initProgressCallback`; `useBrowserCache` already set.
- *Non-English token heuristic* (affects RAG, not embeddings): handled in B6.

**Tests.** `EmbeddingGenerator.contract.test.ts` + dimension-consistency test + batch-equivalence test (`embedBatch([a,b])` equals `[embed(a), embed(b)]`).

**Deps.** `@domicile/core`, `@huggingface/transformers`. **Versioning.** independent.

## B5. `@domicile/llm-webllm`, `@domicile/llm-wllama`, `@domicile/llm-fallback`

**Responsibility.** Local generation (GPU + CPU) with a transparent fallback cascade.

**Public contract.** Implements `LLMProvider` (B1):

```ts
export interface LLMProvider {
  initialize(): Promise<void>;
  generate(prompt: string, options?: GenerateOptions): Promise<string>;
  generateStream(prompt: string, options?: GenerateOptions): AsyncGenerator<string>;
  isAvailable(): Promise<boolean>;    // NEW: non-throwing capability probe
  dispose(): Promise<void>;
}
export interface GenerateOptions { maxTokens?: number; temperature?: number; topP?: number; topK?: number; stopSequences?: string[]; }
```

**`llm-webllm`.** Current `src/llm/WebLLMProvider.ts`, mostly keep. Add `isAvailable()` (wraps `checkWebGPUAvailability`, non-throwing). Add `canRunModel(modelId)` using `ModelRegistry` size vs `detectCapabilities().deviceMemory`/GPU limits — prevents the opaque GPU-OOM on low-RAM devices (§2.4). Keep `initProgressCallback`.

**`llm-wllama`.** Current `src/llm/WllamaProvider.ts`. **Two fixes:** (1) `generateStream` (line 132) silently no-ops — `createCompletion` returns a string, so it hits the `else` branch yielding the whole string at once. Use wllama v2's real streaming API (`onToken` callback or streaming variant). (2) Fix the packaging bug: `package.json` peerDep `@wllama/wllama ^1.0.0` vs devDep `^2.3.6` — align peer to `^2.0.0`. Add `isAvailable()` (always true where WASM exists).

**`llm-fallback` (new).** The thing the README promises but the code doesn't deliver ("automatic fallback"). Holds an ordered `[LLMProvider]`; `initialize()` probes `isAvailable()` in order, keeps the first available; `generate`/`generateStream` route to the active provider. If the active provider throws at call time, cascade to the next available. This closes the README-vs-reality gap (TECHNICAL_VALIDATION.md §2.4) — today WebGPU failure just throws.

**Tests.** `LLMProvider.contract.test.ts` (shared). Fallback test: mock WebLLM `isAvailable()→false`, assert Wllama is used; mock WebLLM throws at `generate`, assert cascade. Streaming test: assert `generateStream` yields >1 chunk for wllama (catches the no-op regression).

**Deps.** `@domicile/core`; `@mlc-ai/web-llm` / `@wllama/wllama`. **Versioning.** independent.

## B6. `@domicile/rag` — the moat

**Responsibility.** Turn retrieval + generation into a citation-grade, passage-level pipeline. This is the layer that makes the model-quality objection (MARKET_ANALYSIS.md §3.1, §7) manageable. Today's `src/rag/RAGPipelineManager.ts` is a 30-line scaffold (embed → top-K → template → single prompt → generate); it must become a real RAG stack.

**Public contract.**

```ts
export interface RAGConfig {
  vectorDB: Domicile;                  // or { search } minimal interface
  llmProvider: LLMProvider;
  embeddingGenerator: EmbeddingGenerator;
  chunker?: Chunker;                   // default SentenceChunker
  reranker?: Reranker;                 // optional, default none
  hybrid?: HybridSearchConfig;         // optional BM25+dense
  promptTemplate?: PromptTemplate;
  maxContextTokens?: number;
  tokenizer?: Tokenizer;               // real tokenizer for truncation
}
export class RAGPipelineManager {
  query(query: string, options?: RAGOptions): Promise<RAGResult>;
  queryStream(query: string, options?: RAGOptions): AsyncGenerator<RAGStreamChunk>;
}
export interface RAGResult { answer: string; sources: Citation[]; metadata: RAGMetadata; }
export interface Citation { id: string; score: number; snippet: string; metadata: Record<string, unknown>; }
```

**Internal structure — five stages, each swappable:**

1. **Chunker** (new). `SentenceChunker`: sliding window (e.g. 256 tokens) with overlap (e.g. 32), respecting sentence/section boundaries. Documents are chunked *before* embedding at insert time (changes `Domicile.insert` to chunk long docs and store chunks as separate records linked by `parentDocId` in metadata). This is the single biggest RAG-quality lever — today a 40-page contract is one embedding, destroying retrieval granularity.
2. **Retriever.** Embed query → `vectorDB.search` top-K (now passage-level, not doc-level). Supports hybrid: a `BM25Index` (in-memory JS inverted index, cheap) fused with dense via Reciprocal Rank Fusion. Legal queries are keyword-heavy (statute names, citations); dense-only misses exact-match recall. Promote from README roadmap.
3. **Reranker** (new, optional). A small cross-encoder via Transformers.js (`embed-rerank`-class) re-scores the top-K candidates. Materially lifts citation accuracy — the #1 deal-risk metric.
4. **Prompt builder.** Configurable `PromptTemplate` (system instruction + context + query) — today the instruction is hardcoded English (`RAGPipelineManager.ts:244`); legal needs jurisdiction-aware instructions. `maxContextTokens` truncation uses the **real tokenizer** (Transformers.js exposes tokenizers), not `length/4` (line 295 — off by ~2x for non-English/code).
5. **Generator + citation binder.** Stream generation; bind each cited claim back to the source passage (`Citation.snippet`). Returns `sources` as citations, not raw hits.

**Failure modes & fixes.**
- *No chunking* (§2.5): Chunker stage. Phase 4.
- *No reranking* (§2.5): Reranker stage. Phase 4.
- *No hybrid* (§2.5): BM25+RRF. Phase 4.
- *Bad token estimate* (§2.5): real tokenizer. Phase 4.
- *Hardcoded English prompt* (§2.5): `PromptTemplate`. Phase 4.

**Tests.** Unit per stage (chunker boundaries, RRF fusion math, reranker ordering). Integration: a small fixed corpus with known-answer questions → assert correct source is cited. The headline benchmark (validation plan, TECHNICAL_VALIDATION.md §5): citation accuracy of Domicile (7B WebLLM + chunk+rerank+hybrid) vs a cloud frontier model on a sanitized legal corpus — the data behind the model-quality objection.

**Deps.** `@domicile/core`; optional `@domicile/embedding-transformers` (reranker). **Versioning.** independent; this is the fastest-moving package.

## B7. `@domicile/mcp` — protocol

**Responsibility.** Expose custody as Model Context Protocol tools, speak the real wire protocol, scope by matter.

**Public contract.**

```ts
export interface MCPServerConfig { vectorDB: Domicile; ragPipeline?: RAGPipeline; scope?: MatterScope; }
export class MCPServer {
  getTools(): MCPTool[];
  executeTool(name: string, params: any): Promise<any>;
  serve(transport: 'stdio'|'sse', options?): Promise<void>;   // NEW: real transport
}
export interface MatterScope { matterId: string; enforceOn: ('search'|'insert'|'delete'|'rag')[]; }
```

**Internal structure.** Current `src/mcp/MCPServer.ts` tool registry (`search_vectors`, `insert_document`, `delete_document`, `rag_query`) + JSON-schema validation is good and stays. **Add the transport layer** (new): mount tools on `@modelcontextprotocol/sdk` Server with stdio + SSE transports. The README/showcase already advertises `mcp.serve({ transport: 'stdio' })` (`showcase/index.html:548`) — today that method doesn't exist. **Add matter scoping** (new): `MatterScope` injects a non-bypassable default `filter: { matter: scope.matterId }` into every search/insert/rag call. Today `filter` is caller-supplied and optional — unsafe for multi-matter agent exposure.

**Failure modes & fixes.**
- *Tool registry but no transport* (§2.6): add `serve()`. Phase 5.
- *No auth/tenancy* (§2.6): `MatterScope`. Phase 5.

**Tests.** Tool-schema validation tests (existing). Transport test: spin the server over stdio, send an MCP `tools/call`, assert response. Scope test: assert a scoped search cannot return another matter's docs.

**Deps.** `@domicile/core`, `@domicile/rag`, `@modelcontextprotocol/sdk`. **Versioning.** independent.

## B8. `@domicile/performance`

**Responsibility.** LRU caches (vectors, embeddings, index), memory manager, worker pool, batch optimizer, **true** progressive streaming.

**Internal structure.** Current `src/performance/*` (`LRUCache`, `MemoryManager`, `WorkerPool`, `ProgressiveLoader`, `BatchOptimizer`, `PerformanceOptimizer`, `Benchmark`) — keep, it's real differentiated plumbing. **Fix `exportStream`** (`core/VectorDB.ts:578`): the code comment admits "We can't yield from inside the callback," so it collects all chunks then yields one — the streaming export is not streaming. Restructure `ProgressiveLoader.streamProcess` to return an async iterator that `exportStream` consumes directly (now possible because B2's `StorageManager.stream()` exists).

**Failure modes & fixes.**
- *Fake-stream export* (§2.7): restructure to true async-iteration. Phase 1.
- *WorkerPool needs SharedArrayBuffer* → COOP/COEP (§2.7): graceful no-SAB path; `detectCapabilities().sharedArrayBuffer` gates it; degrade to single-threaded with a warning, not a crash.

**Tests.** LRU eviction, memory pressure triggers eviction, batch coalescing, streaming export yields incrementally (assert memory stays bounded during a large export — the whole point).

**Deps.** `@domicile/core`. **Versioning.** independent.

## B9. `@domicile/cli` (new)

**Responsibility.** Integrator-facing binary: scaffold a project, configure residency, serve MCP, run benchmarks, export/import.

**Commands:**
```
domicile init [--template legal|health|blank]   # scaffold an app with createDomicile() wired
domicile serve [--transport stdio|sse] [--matter M-204]  # run the MCP server
domicile bench [--corpus ./docs] [--sizes 10k,50k,100k]  # run the validation benchmark suite
domicile export [--out matter.json] [--stream]   # export a DB
domicile import [--in matter.json]
domicile capabilities                            # print detectCapabilities() for this machine
```

**Internal structure.** A thin Commander.js/`clipanion` front-end calling into `@domicile/mcp`, `@domicile/performance` (Benchmark), and `Domicile` export/import. `bench` codifies the validation plan (TECHNICAL_VALIDATION.md §5) as a reproducible command — turning the scale-ceiling and citation-accuracy claims into something an integrator runs themselves.

**Tests.** Smoke tests per command (spawn the binary, assert exit code + output shape). `bench` tested against a tiny fixture corpus.

**Deps.** umbrella + `mcp` + `performance`. **Versioning.** independent; follows umbrella loosely.

## B10. `@domicile/desktop` (new) — the reference app

**Responsibility.** The product a lawyer actually uses: load a matter folder, ask grounded questions with citations, fully offline. This is the showcase made real — the showcase playground (`showcase/index.html` playground section) is a fake keyword ranker; Desktop runs the true engine.

**Form factor.** **Tauri** (not Electron) — Rust shell, ~10MB, lower memory, no Chromium bundle; the webview runs the Domicile engine. Privacy argument is cleaner with a smaller, auditable binary. The web UI is the Domicile design system (oxblood/parchment/Fraunces — already in `showcase/`).

**UI structure.**
- **Matter workspace**: folder drop → chunk + embed (progress bar via `initProgressCallback`) → IndexedDB custody.
- **Ask**: query box → streaming RAG (`queryStream`) → answer + inline citation chips that scroll to the source passage.
- **Custody panel**: live capability matrix (the showcase's panel, lines 456-462, but real), doc count, memory, egress counter (always 0).
- **Settings**: model tier (from `ModelRegistry`, gated by `detectCapabilities`), residency profile, export/import.

**Failure modes & fixes.** Model-load UX (progress, failure→fallback), large-corpus memory (streaming, B8), offline-first (Tauri bundles nothing network-bound except model weights, which cache once).

**Tests.** Playwright against the Tauri webview for the golden path (load → ask → cite). Manual device-matrix testing per validation plan.

**Deps.** umbrella + `rag` + `react`. **Versioning.** independent; this is the most user-visible product.

## B11. `@domicile/react` (new)

**Responsibility.** React hooks binding the engine to UI: `useDomicile(config)`, `useSearch(db, query)`, `useRag(db, rag)`, `useCapabilities()`, `useIngestProgress()`.

**Internal structure.** Thin hooks over the engine; suspense/concurrent-friendly; streaming RAG exposed as a hook yielding chunks. Enables the "React hooks package" roadmap item and is the substrate Desktop's UI builds on.

**Tests.** `@testing-library/react` + `fake-indexeddb`; hook behavior tests (loading, error, streaming).

**Deps.** `@domicile/core`, React (peer). **Versioning.** independent.

## B12. `@domicile/python` (roadmap)

PyScript/Pyodide bindings so legal-ops/data teams can use Domicile from Python. Thin: the engine stays JS/WASM; Python calls it via the Pyodide JS bridge. Phase 7+.

## B13. Studio (docs + showcase + playground)

The current `showcase/index.html` becomes `apps/studio` — a real static site (Astro/Vite) hosting: the marketing showcase (keep the design — it's excellent), an interactive playground that runs the *real* engine (not the fake keyword ranker at `showcase/index.html:737`), and the docs (currently `docs/*.md`). The playground is the proof of the residency claim: a network tab showing zero egress during a query.

## B14. `domicile` (umbrella) — stable surface + factory

**Responsibility.** The package most users install. Re-exports a **curated** stable surface (~20 symbols, not 40), and provides `createDomicile()` wiring defaults so the 5-line quickstart (unchanged from today, just renamed) keeps working.

```ts
export { Domicile } from '@domicile/core';            // the facade, re-exported as `Domicile`
export { createDomicile } from './factory';
export type { VectorRecord, Filter, SearchResult, Citation, RAGResult } from '@domicile/core';
export { RAGPipelineManager } from '@domicile/rag';
export { MCPServer } from '@domicile/mcp';
export { TransformersEmbedding } from '@domicile/embedding-transformers';
export { WebLLMProvider, WllamaProvider, FallbackLLMProvider } from '@domicile/llm-*';
// NOT re-exported: internal performance helpers, index impls, storage impl (inject via createDomicile)

export function createDomicile(config: UserConfig): Domicile {
  const caps = detectCapabilities();
  return new Domicile({
    storage: new IndexedDBStorage(config.storage),
    index: new HnswIndex(config.index),                       // the only index (voy removed)
    embedding: new TransformersEmbedding({ ...config.embedding, device: caps.webgpu ? 'webgpu' : 'wasm' }),
    performance: config.performance,
  });
}
```

The heavy primitives are **optional peerDependencies** so `npm install domicile` is light; consumers add `@domicile/llm-webllm` only if they want GPU. The deprecated `haven` npm package re-exports `domicile` with a deprecation notice.

**Tests.** The quickstart from the README runs end-to-end against the umbrella. A "bundle size" test asserts the umbrella's default install doesn't pull unused adapters.

**Deps.** all `@domicile/*` as optional peers/regular. **Versioning.** the user-facing semver; absorbs adapter changes as minors where the facade is unchanged.

---

## C. How the parts fit — a full product request, traced

A lawyer opens Desktop (B10), drops a matter folder. Desktop calls `createDomicile()` (B14) → `Domicile.initialize()` (B1) → `IndexedDBStorage` (B2) + `HnswIndex` (B3) + `TransformersEmbedding` (B4, WebGPU if `detectCapabilities` says so). The folder is chunked (B6 Chunker) → embedded (B4, batched) → stored (B2) → indexed (B3). She asks a question; `RAGPipelineManager.queryStream` (B6) embeds the query, hybrid-searches (B3 + BM25), reranks, builds a prompt with a real tokenizer, and streams generation from `FallbackLLMProvider` (B5: WebLLM, or wllama if no GPU). Citations bind back to passages. The same engine is exposed to her firm's agent stack via `MCPServer.serve('stdio')` (B7), matter-scoped. The integrator who deployed it used `domicile init --template legal` (B9) and ran `domicile bench` to validate scale. Zero bytes egress at any step — asserted by `ResidencyGuard` (A6.1).

That is the full product. The library is the engine; the platform is the business.

---

## D. What "done" looks like (across both parts)

- One brand (Domicile) across repo, npm, site, code; `haven` is a deprecated stub.
- `@domicile/core` has zero deps and defines every seam; the facade is injection-based.
- `npm install domicile` is light; adapters are optional peers; the quickstart is unchanged.
- Default (and only) index is hnsw with real scores and non-rebuilding delete; voy has been removed.
- LLM fallback WebGPU→WASM works without a thrown init; wllama streams for real.
- RAG ships chunking + rerank + hybrid; citation-accuracy benchmark is published and runnable via `domicile bench`.
- MCP speaks the real wire protocol with matter scoping.
- Desktop loads a matter folder and answers with citations, offline.
- Every package builds, tests, and versions independently; the repo is shippable at every phase gate.

This converts Domicile from a coupled single library whose weakest primitive (Voy) dictates product quality, into a platform where each seam is a contract we control — so what we *buy* (inference, indexing) is swappable without touching what we *own* (custody, orchestration, RAG, protocol, the product surfaces), which is where the moat and the revenue both live.
