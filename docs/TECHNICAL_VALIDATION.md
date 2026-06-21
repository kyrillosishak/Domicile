# Domicile — Technical Validation & Build-vs-Buy

> **Status (2026-06): resolved.** The central recommendation of this audit —
> replace the Voy WASM index with a build-ourselves index — has been executed.
> `HnswIndex` (pure-TypeScript HNSW) is now the only index, the `IndexManager`
> (Voy) wrapper has been removed, and `voy-search` is no longer a dependency.
> The audit reasoning below is preserved as the rationale for that decision.

This document audits every component in the Haven stack against the actual codebase (`src/`), decides for each whether to **keep / vendor / replace / build ourselves**, lists the concrete technical problems we will hit, and how to fix them. It complements `MARKET_ANALYSIS.md` (the *why*) with the *how* and *what will break*.

**Reading the code first — the actual dependency graph:**

| Layer | Component | Backed by | Our code |
|---|---|---|---|
| Storage | `IndexedDBStorage` | native IndexedDB | ours |
| Index | `HnswIndex` | ours (pure-TS HNSW; replaced Voy) | ours |
| Embeddings | `TransformersEmbedding` | `@huggingface/transformers` | ours (wrapper) |
| LLM (WebGPU) | `WebLLMProvider` | `@mlc-ai/web-llm` | ours (wrapper) |
| LLM (WASM) | `WllamaProvider` | `@wllama/wllama` | ours (wrapper) |
| Orchestration | `RAGPipelineManager` | — | ours |
| Protocol | `MCPServer` | — | ours |
| Performance | `PerformanceOptimizer` + cache/memory/batch/worker | — | ours |
| Entry | `VectorDB` (core) | ties it together | ours |

The headline: **we already build the orchestration, protocol, storage, and performance layers ourselves.** What we *don't* own are three fast-moving upstream primitives (Transformers.js, WebLLM, wllama). The validation question is therefore not "build vs buy" per component — it's "which primitives do we depend on, are they the right ones, and how do we survive their churn."

---

## 1. The WebGPU tailwind (and what it actually changes)

WebGPU momentum is real and accelerating. Chrome/Edge ship it universally (113+); Safari and Firefox have been converging on it through preview/nightly channels. This matters for Haven in two specific, code-grounded ways:

1. **It widens the WebLLM surface.** `WebLLMProvider.initialize()` (src/llm/WebLLMProvider.ts:38) hard-gates on `navigator.gpu.requestAdapter()` — if no adapter, it throws. Every browser that ships WebGPU grows our addressable inference surface for free, no code change. As WebGPU reaches Safari/Firefox stable, the WASM (`WllamaProvider`) path shifts from "the path most users hit" to "the genuine fallback," which is the design intent.
2. **It widens the Transformers.js WebGPU embedding path.** `TransformersEmbedding.loadPipeline` (src/embedding/TransformersEmbedding.ts:94) tries `device: 'webgpu'` and falls back to `'wasm'` on failure. More WebGPU → faster embeddings, lower insert latency, less battery/CPU burn.

**What it does *not* change:** WebGPU says nothing about the storage, indexing, or RAG layers — those are CPU/WASM regardless. And WebGPU being "on every browser" does not mean every *device* has a capable GPU; integrated GPUs and low-RAM laptops still OOM on a 7B model. The tailwind is real but it does not retire the WASM fallback or the model-quality objection in `MARKET_ANALYSIS.md` §7.

**Action:** Treat WebGPU as a passive upside we track, not a dependency we plan around. Keep `checkWebGPUAvailability()` as the single gate; never assume it. Update the README browser-support table against live caniuse data before the next release — the current "Firefox: Not yet supported / Safari: Not yet supported" lines are already stale and undersell the product.

---

## 2. Component-by-component validation

### 2.1 Storage — `IndexedDBStorage` → **keep, build ourselves** ✅

We own this and should keep owning it. IndexedDB is a browser primitive, not a dependency; there is nothing to buy. The implementation (src/storage/IndexedDBStorage.ts) is a competent raw-IDB wrapper: three object stores (`vectors`, `index`, `metadata`), proper quota handling (`StorageQuotaError` on `QuotaExceededError`), and a `serializeRecord` that converts `Float32Array` → plain array for structured-clone persistence.

**Problems we will face:**

- **Full-table scans for filter and delete.** `filter()` (line 360) opens a cursor and walks every record; `IndexManager.remove()` (src/index/IndexManager.ts:214) calls `storage.getAll()` then filters in JS to rebuild the index. At 100K+ docs this is O(n) on every filtered search and every single delete. The only IndexedDB index created is `metadata.tags` (multiEntry) and `timestamp`; arbitrary `field/operator` filters have no index backing them.
  - *Fix:* push filtering into IndexedDB via indexes for the hot fields (matter-id, category, date). For arbitrary filters, accept the scan but cap it and document the ceiling. For delete, maintain an in-memory id→vector map so `remove()` doesn't require `getAll()`.
- **`putBatch` is not actually batched at the IDB level in a useful way.** It opens one transaction but issues N separate `store.put()` calls and counts `onsuccess` (src/storage/IndexedDBStorage.ts:128). That's fine, but there's no `getAllKeys`/cursor-bulk path; very large inserts will hit transaction timeout limits on some engines.
  - *Fix:* chunk batch inserts (the `PerformanceOptimizer` already has `chunkSize`), and surface progress so a 50K-doc import doesn't look hung.
- **Serialization doubles memory.** `serializeRecord` does `Array.from(record.vector)` — a Float32Array of 384 dims becomes a 384-element JS array (8x the bytes as object properties) before structured clone. For a 100K corpus this is a real transient memory spike on every batch write.
  - *Fix:* store the `Float32Array` buffer directly (structured clone handles `ArrayBuffer`/typed arrays natively) instead of converting to a plain array. This is a one-line change with large memory savings.
- **No migration story.** `onupgradeneeded` creates stores if missing but never alters them; there's a `version` config but no versioned migration path. The `docs/MIGRATION.md` exists but the storage layer can't evolve its schema in place.
  - *Fix:* add a real `onupgradeneeded` switch keyed on `oldVersion` → `newVersion`, and document that index rebuild is the fallback for breaking changes (already partially handled via `IndexCorruptedError` → rebuild).

**Verdict:** Keep. This is core IP and there's no credible browser-native alternative to IndexedDB for persistent typed-vector storage today (OPFS/FS Access API are possible later for large blobs, but IndexedDB is right for now).

### 2.2 Index — `IndexManager` (Voy) → **vendor-dependent; consider replacing** ⚠️

This is the highest-risk component. `IndexManager` wraps `voy-search`, and the wrapper paper over several deep limitations of Voy:

- **Scores are hardcoded to `1.0`.** src/index/IndexManager.ts:286 sets `score: 1.0` with the comment "Voy doesn't expose distance/score in the result." This means **no ranking signal is returned to callers** — every result looks equally relevant. The RAG pipeline (src/rag/RAGPipelineManager.ts:222) then calls `result.score.toFixed(4)` which prints `1.0000` for everything. For a citation-grounded legal product, the inability to say "this passage is a 0.91 match, that one is 0.42" is a serious product gap.
  - *Fix (short term):* compute cosine similarity ourselves from the stored query vector + result vector (we already fetch the record from storage during filtering). It's one dot product per candidate.
  - *Fix (structural):* see below — Voy may be the wrong engine.
- **`remove()` rebuilds the entire index.** src/index/IndexManager.ts:214 fetches all vectors and calls `build()` on every single delete. Voy is an immutable-style index; deletion is O(n) rebuild. For a document-portal where users delete/replace matter files frequently, this is a latency and memory cliff.
- **Filtered search is post-hoc, not pre-filter.** `search()` fetches `k * 3` neighbors then filters in JS (line 263), retrieving each record from storage one-by-one (`await this.config.storage.get(...)` in a loop, line 271). If the filter is selective, you may fetch `3k` candidates and still return fewer than `k`. There's no guarantee of recall.
- **The whole index is serialized to a JSON string and stored in a single IndexedDB row** (src/index/IndexManager.ts:317, saved via `saveIndex`). At 100K vectors × 384 dims, the serialized Voy blob is hundreds of MB in one IDB `put`. That risks `QuotaExceededError` and makes incremental persistence impossible — every `add()` re-serializes and re-writes the *entire* index (line 144, `persistIndex()` after every single insert).

**Problems we will face:**
- Voy is sparse: minimal docs, narrow API, no score exposure, no native filtering. We are betting a core capability on a low-velocity dependency.
- The "search <50ms on 10K" README claim is plausible for Voy's pure-ANN search, but the *real* Haven search path adds N storage round-trips + JS filtering, so the user-visible number is higher than the index alone suggests.

**Build-vs-buy decision — replace Voy ourselves:**

| Option | Effort | Verdict |
|---|---|---|
| Keep Voy, fix scores in-wrapper | small | Do now regardless — it's a bug, not a choice |
| Replace with a hand-rolled WASM HNSW (e.g. vendored `hnswlib-wasm`) | medium | **Recommended.** HNSW gives real scores, incremental add/delete without full rebuild, and is battle-tested. |
| Replace with a pure-JS HNSW (`hnswlib-node`-style port) | medium | Fallback if WASM build is painful |
| Build a custom index from scratch | large | Not justified — indexing is solved, not our moat |

The moat is *not* the index algorithm (MARKET_ANALYSIS.md §5 is explicit about this). So we should pick the most robust, best-scored, deletable index we can, even if that means swapping Voy out. **Recommendation: prototype the `hnswlib-wasm` swap behind an interface** (`IndexManager` already isolates Voy behind `search/add/remove/serialize`), benchmark delete + filtered-search latency against Voy on a 100K synthetic corpus, and migrate if it wins — which it should, on every axis except maybe raw insert throughput.

### 2.3 Embeddings — `TransformersEmbedding` → **keep as wrapper, but own the model strategy** ✅

The wrapper (src/embedding/TransformersEmbedding.ts) is thin and correct: pipeline init with WebGPU→WASM fallback, retry with exponential backoff, mean-pooling + normalize, batch (currently sequential), and image support via canvas→Blob. Transformers.js (`@huggingface/transformers` v3) is the right dependency — actively maintained, broad model support, WebGPU path.

**Problems we will face:**
- **`embedBatch` is sequential, not batched.** src/embedding/TransformersEmbedding.ts:128 loops `for (const text of texts)` calling `generateEmbedding` one at a time. Transformers.js supports true batched inference; we're leaving 5–10x throughput on the table for bulk ingest.
  - *Fix:* pass the array to the pipeline in one call and handle the 2D output (the `extractEmbedding` already has a `data[0]` 2D-array branch, so the plumbing exists).
- **Model is hardcoded by the user at config time** (`Xenova/all-MiniLM-L6-v2` in the README). There's no guidance on dimension-vs-quality tradeoffs, and the index `dimensions` must match the model exactly or `DimensionMismatchError` throws (src/core/VectorDB.ts:91). A user who swaps models silently bricks their existing index.
  - *Fix:* ship a curated model registry (small/fast/quality tiers with known dimensions), validate model↔index compatibility on init, and offer a re-embed migration path.
- **First-load model download.** `all-MiniLM-L6-v2` is ~25MB quantized; larger models far more. On a legal-docs site, the first query blocks on a multi-MB download + WASM compile. The `lazyLoadModels` flag exists (src/core/VectorDB.ts:69) but there's no pre-warm / progress UX guidance.
  - *Fix:* pre-warm the embedding model on app idle (not on first search), surface `initProgressCallback`, and cache aggressively via `useBrowserCache` (already set).

**Verdict:** Keep Transformers.js. Don't build an embedding runtime — that's pure commodity. Do own the *model-selection strategy* and *batching*; those are where our wrapper earns its keep.

### 2.4 LLM — `WebLLMProvider` + `WllamaProvider` → **keep both, harden the fallback** ✅

Two providers behind a clean `LLMProvider` interface (`generate`, `generateStream`, `dispose`). WebLLM for WebGPU, wllama for WASM fallback. This is the right shape and matches the README's "automatic fallback" claim.

**Problems we will face:**
- **There is no automatic fallback wired between them.** `WebLLMProvider.initialize()` *throws* if WebGPU is absent (src/llm/WebLLMProvider.ts:48), and the error message *suggests* WllamaProvider — but nothing in the code actually instantiates Wllama in response. The "automatic fallback" in the README is aspirational, not implemented. An integrator has to write the try/catch themselves.
  - *Fix:* build a `FallbackLLMProvider` that holds `[WebLLMProvider, WllamaProvider]` and transparently cascades. This is small, high-value, and closes a README-vs-reality gap that will burn the first integrator.
- **`WllamaProvider.generateStream` may not actually stream.** src/llm/WllamaProvider.ts:132 calls `createCompletion` and then checks `Symbol.asyncIterator in stream` — but wllama's `createCompletion` with default args returns a string, not an async iterable, so it falls to the `else` branch and yields the whole string at once. Streaming is silently no-op for wllama.
  - *Fix:* use wllama's streaming API explicitly (the `onToken` callback or the streaming variant). Verify against the installed wllama v2 API.
- **Model size vs device memory.** A 4B–7B WebLLM model is 2–4GB. `WebLLMProvider` gives no memory/feasibility check before downloading; on a low-RAM device this fails deep into the load with an opaque GPU OOM.
  - *Fix:* expose a `canRunModel(modelId)` check (estimate from model size vs `navigator.deviceMemory` / GPU adapter limits) and recommend a model tier per device class.
- **`peerDependencies` mismatch:** package.json declares `@wllama/wllama` as a *peer* at `^1.0.0` (line 83) but a *devDependency* at `^2.3.6` (line 70). The peer range is wrong — consumers on wllama v2 would fail the peer check. This is a packaging bug.
  - *Fix:* align the peer range to `^2.0.0`.

**Verdict:** Keep both upstreams. The IP here is the fallback orchestration and the device-aware model selection — *build that ourselves*, because neither WebLLM nor wllama will.

### 2.5 RAG orchestration — `RAGPipelineManager` → **build ourselves, but it's underbuilt** ⚠️

This is described as our value layer (the "complete custody pipeline"), but the current implementation is thin: embed query → search top-K → format with a template → single prompt → generate. That's a 30-line pipeline, not a productized RAG stack.

**Problems we will face:**
- **No chunking.** Documents are embedded and stored as whole text blobs (src/core/VectorDB.ts:133 stores `metadata.content = data.text` verbatim). A 40-page contract becomes one giant embedding and one giant context chunk. Retrieval granularity is document-level, not passage-level — terrible for citation quality, which is the whole value prop for legal (MARKET_ANALYSIS.md §3.1).
  - *Fix:* build a chunking layer (sliding window with overlap, respect sentence/section boundaries) before embedding. This is core to RAG quality and *must* be ours.
- **No reranking.** Top-K ANN results are fed straight to the LLM. A small cross-encoder reranker (also runnable in-browser via Transformers.js) would materially lift citation accuracy — the #1 deal risk per the market analysis.
  - *Fix:* add an optional rerank step (`embed-rerank` model) between retrieval and generation.
- **No hybrid search.** Pure dense. Legal queries are often keyword-heavy (statute names, case citations); dense-only misses exact-match recall. The README roadmap lists "hybrid search" as TODO — it should be promoted.
  - *Fix:* add BM25/sparse alongside dense and fuse (RRF). In-browser this is a JS inverted index, cheap.
- **Token estimation is `length / 4`** (src/rag/RAGPipelineManager.ts:295) — a rough heuristic that's off by 2x for non-English (relevant for EU legal) and for code/citations. Context truncation (line 261) relies on it, so truncation is imprecise.
  - *Fix:* use the model's actual tokenizer (Transformers.js exposes tokenizers) for truncation; keep the heuristic only for cheap pre-filtering.
- **Prompt is hardcoded English** (line 244). No system-prompt customization, no per-query instruction. Legal use needs jurisdiction-aware instructions.
  - *Fix:* expose prompt-template configuration (the context template is configurable, but the *surrounding* instruction is not).

**Verdict:** Keep building this ourselves — it *is* the moat. But the current state is "RAG scaffold," not "complete RAG stack." Chunking + reranking + hybrid search are the three things that turn the model-quality objection from fatal to manageable.

### 2.6 Protocol — `MCPServer` → **build ourselves, expand it** ✅

A clean MCP tool surface: `search_vectors`, `insert_document`, `delete_document`, `rag_query` (src/mcp/MCPServer.ts). JSON-schema validation, error wrapping. This is ours and should stay ours — being "the custody layer agents call first" (MARKET_ANALYSIS.md §5) is a positioning win.

**Problems we will face:**
- **`MCPServer` is a tool registry, not a live MCP transport.** `getTools()` returns definitions; `executeTool()` runs handlers. But there's no stdio/SSE/HTTP transport — it doesn't actually speak the MCP wire protocol. To use with Claude Desktop / an agent runtime, an integrator must build the transport shim themselves. The README "Works with Claude Desktop" claim needs that shim.
  - *Fix:* add a thin transport layer (the `@modelcontextprotocol/sdk` server) that mounts these tools. Small, high-credibility.
- **No auth/tenancy.** `executeTool(name, params)` is fully open. For a multi-matter legal deployment exposed to agents, tools need matter-scoping (a `matter_id` that filters every search/insert). Currently `filter` is caller-supplied and optional.
  - *Fix:* enforce a server-level default filter (matter/session scope) that callers cannot bypass.

**Verdict:** Keep and own. The protocol exposure is strategic; finish the transport and add scoping.

### 2.7 Performance layer → **build ourselves, mostly already done** ✅

`PerformanceOptimizer` coordinates LRU caches (vectors, embeddings, index), a memory manager, a worker pool, progressive streaming load, and a batch optimizer. This is real, differentiated plumbing that integrators would otherwise rebuild.

**Problems we will face:**
- **`WorkerPool` requires SharedArrayBuffer** (README lists it optional), which needs COOP/COEP cross-origin isolation headers — a deployment friction many host apps won't have set. Need a graceful no-SAB path.
- **`exportStream` doesn't actually stream** (src/core/VectorDB.ts:578): the comment admits "We can't yield from inside the callback," so it collects all chunks then yields one. The streaming export is not streaming. For a 100K export this re-introduces the memory spike it claimed to solve.
  - *Fix:* restructure as an async iterator that yields per-chunk from the cursor directly, not via a callback collector.

**Verdict:** Keep. This is ours and is a selling point. Fix the fake-stream export.

---

## 3. Build-vs-buy summary

| Component | Decision | Rationale |
|---|---|---|
| IndexedDB storage | **Build (keep)** | No credible alternative; core persistence is ours |
| Vector index | **Replace Voy → hnswlib-wasm** | Voy can't score/delete/filter; it's the weakest link |
| Embeddings runtime | **Buy (Transformers.js)** | Commodity; own model selection + batching |
| LLM runtime | **Buy (WebLLM + wllama)** | Commodity; own the fallback cascade + device gating |
| RAG pipeline | **Build (keep + expand)** | This is the moat; add chunking/rerank/hybrid |
| Chunking | **Build (new)** | Doesn't exist; core to citation quality |
| Reranker | **Build (on Transformers.js)** | Lifts the #1 deal-risk metric |
| Hybrid search | **Build (new)** | Promote from roadmap; legal needs keyword recall |
| MCP transport | **Build (finish)** | Tool registry exists; wire protocol doesn't |
| Performance layer | **Build (keep)** | Differentiated plumbing; fix fake-stream export |
| Fallback LLM provider | **Build (new)** | Closes README-vs-reality gap |

**Principle:** own the *integration, custody, and quality* layers; buy the *inference and embedding primitives*. The only primitive we should reconsider owning is the index, because Voy's limitations leak all the way into product quality (no scores, no delete).

---

## 4. Top technical risks & fixes (prioritized)

1. **Voy returns no scores (hardcoded `1.0`).** Fix in-wrapper now (compute cosine from stored vectors); plan the hnswlib swap.
2. **No real LLM fallback.** Build `FallbackLLMProvider`; today WebGPU failure = crash, contradicting the README.
3. **No chunking → poor citation quality.** This is the model-quality objection in disguise. Build it before any legal pilot.
4. **`remove()`/`update()` rebuild the whole index + `getAll()`.** O(n) per delete; will bite at scale. Fixed for free by the hnsw swap; mitigate now with in-memory id map.
5. **Full-index re-serialize on every insert.** `persistIndex()` after each `add()` rewrites the entire Voy blob. Batch/debounce persistence.
6. **`exportStream` is fake.** Restructure to true streaming or remove the claim.
7. **wllama streaming is a no-op.** Use wllama's real streaming API.
8. **Peer dependency range wrong for wllama.** Packaging bug; fix before publish.
9. **Memory doubling on serialize.** Store typed arrays natively, not via `Array.from`.
10. **No model↔index compatibility migration.** Swapping a model bricks the index silently; add a re-embed path.

---

## 5. Validation plan (what to measure before promising it)

Aligned with MARKET_ANALYSIS.md §7, but concrete to the code:

- **Scale ceiling:** load 10K / 50K / 100K / 250K synthetic docs; measure insert throughput, search p50/p99, delete latency, and peak memory across Chrome+Safari+Firefox. Find where `getAll()`-on-delete and full-index-reserialize break. Publish the real ceiling, not "100K+".
- **Citation accuracy:** assemble a sanitized legal corpus with known-answer questions; compare Haven (7B WebLLM) vs a cloud frontier model on citation correctness *with* the chunking+rerank pipeline vs without. This is the data behind the §3.1 "model quality" objection.
- **WebGPU device matrix:** test on integrated-GPU laptops / low-RAM phones, not just M1. Find which model tier runs without OOM per device class; feed `canRunModel`.
- **Fallback path:** force-disable WebGPU and confirm the Wllama cascade actually works end-to-end (it doesn't today).

---

*This validation reflects the codebase as of v0.1.0. Browser-support and WebGPU-coverage figures should be re-checked against live caniuse/web-platform data before any public claim is updated.*
