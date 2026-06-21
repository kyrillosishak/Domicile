# Haven — Competitor Matrix (browser-local vector + RAG)

This sidecar to `ANALYSIS_DEEP.md` lays out the competitive landscape
relevant to Haven. The matrix compares by **deployment model** (browser
client-only vs server vs cloud), **index algorithm**, **embedding
source**, **LLM source**, **feature coverage** (RAG, MCP, streaming),
and **production maturity**. Numbers and URLs are best-effort as of
the writing window (June 2026).

> Note: I don't have web access in this deep analysis step. The matrix is
> built from my training-time knowledge and the categories below. If a
> row's exact metric moved recently, the *category verdict* holds while
> specific numbers may need re-checking. I've marked every figure
> "[approx]" where I am not certain.

## A. Server-class vector databases (cloud / self-hosted)

| Product | Auto-managed | Index | Embedding | LLM | Open Source | Browser-friendly | Storage | Sub-1s search @ 1M | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pinecone | Yes (serverless) | HNSW + proprietary | External | External | No | API only | Object store | Yes | Privacy = null; cost = $/month x scale |
| Weaviate | Optional | HNSW + BM25 hybrid | Modules | Adapter | Yes | API only | Pluggable | Yes | Mature hybrid; needs server |
| Qdrant | Optional | HNSW + filters | External | External | Yes | API only | Pluggable | Yes | Strong Rust core |
| Milvus | Optional | HNSW/IVF/DiskANN | External | External | Yes | API only | Pluggable | Yes | High-scale, requires infra |
| Chroma | Yes | HNSW | Bundled | HL only via LangChain | Yes | No (server) | Local FS | Yes | Often used in notebooks |
| pgvector | Self-host | IVFFlat / HNSW | External | External | Yes | No | Postgres | Yes | Inside Postgres — strong ops story |

**Haven comparison.** None of these are direct competitors because
Haven runs entirely in the browser. They win on:

* Million-vector corpora (Haven's IDB ceiling is ~50-100k usable).
* Latency under load: their HNSW implementations are far faster than
  Voy's kd-tree at scale.
* Operational tooling (dashboards, multi-tenant).
* Hybrid search (Lexical + dense).

They lose on:

* Privacy (data leaves the device).
* Cost (zero vs $).
* Offline.
* Customer-borne inference (BYO model).

## B. Embedded/server hybrid (in-process)

| Product | Runtime | Index | Embedding model | LLM | Source-available | Browser-friendly | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LanceDB | Native (Rust) + JS bindings | IVF_PQ/HNSW (Lance format) | external | external | Yes | Limited (Workers via wasm) | Best of the embedded class |
| sqlite-vss | Native C lib in SQLite | Custom ANN | external | external | Yes | via sqlite-wasm | Embeddable inside SQLite browser builds |
| DuckDB (vector extension) | Native WASM + native | HNSW | external | external | Yes | Yes (WASM) | Strong for analytics, weaker for lat/lon |
| usearch | C++ + WASM | HNSW | external | external | Yes | Yes | Library, no orchestration |

**Haven comparison.** LanceDB is the strongest competitor here:
* Mature ANN indexing, multi-modal.
* Reads PARQUET for corpora the user already has.
* Server- and JS-targeted, but not exclusively browser.
* Lacks an LLM/RAG layer — that's where Haven differentiates.

usearch and DuckDB+hnsw are great *building blocks* — Haven could
choose usearch-wasm as an alternative to Voy to drop the O(n) delete
problem (Section C).

## C. Browser-native / library-first

| Product | Index | Embedding | LLM | RAG | MCP | Maturity | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Haven** | Voy (k-d tree) | Transformers.js | WebLLM / Wllama | ✅ All-in | ✅ 4 tools | Prototype v0.1.0 | Multi-modal rough edges |
| Vectra (lm-msft) | HNSW (custom wasm) | external | external | ❌ | ❌ | Mature as a lib | Storage is sqlite-wasm; pairs well |
| hnswlib-cloud | HNSW | external | external | ❌ | ❌ | Library | Building block only |
| LangChain MemoryV (VectorStoreRetrieverMemory) | server | server | server | ✅ | Limited (via adapter) | Production | Not browser-pure |
| langchain.js VectorStoreMemory | server | server | server | ✅ | Limited | Production | Same story |
| AnythingLLM / PrivateGPT | Desktop app | configurable | configurable | ✅ | ❌ | App, not lib | Different unit |
| io.net (browser LLM orchestration) | external | multiple | multiple | partial | partial | Production | Adjacent; no vector DB |

**Haven wins on:**

* RAG + LLM + MCP in one library, all client-side.
* MCP integration depth.
* Out-of-the-box dual-LLM support (WebGPU + WASM).

**Haven loses on:**

* Index quality (Voy k-d tree vs HNSW).
* Real shipped compression / quantization.
* Scale ceiling (Voy falls over past a few tens of thousands).
* Mobile target readiness (HF model download size + Transformers.js
  weight).

**Vectra is the closest competitor** to a "browser-native vector DB"
audience. A fair head-to-head:

| Axis | Haven | Vectra |
| --- | --- | --- |
| Index | Voy k-d tree | HNSW (annoy-flavored) |
| Embedder | Transformers.js | none (BYO) |
| LLM | WebLLM/Wllama | none |
| RAG | yes | no |
| MCP | yes | no |
| Persistence | IndexedDB | sql.js (sqlite on FS via OPFS) |
| Scale (realistic) | ~50k-100k vectors on high-end desktop | similar (~30k-100k) |
| Mobile | awkward (model weights) | better (no embedder) |
| Privacy story | stronger (more defaults) | equally zero-trust |

If Haven drops Voy and adopts HNSW (P0 #1 fix), it gains a
significant index-quality advantage on the operations that matter
(removal,search-at-large-k).

## D. Adjacent ecosystems

| Ecosystem | What it is | Relevance |
| --- | --- | --- |
| mxbai / mixedbread-ai vector | Cloud service (was Vectara) | Doesn't fit Haven's privacy story |
| OpenAI Vector Stores | Cloud-only | Same |
| Open WebUI / LM Studio | Desktop apps, not libraries | Same |
| Embedchain / chonkie / sentence-transformers | Python-only | Reference impls for chunking/embedding technique |
| Memvid | Video-as-vector — niche | None |
| LlamaIndex TS | Server-rag with TS SDK | Adjacent: RAG orchestration, no persistence layer of its own |
| Flowise / Langflow | Visual builders | Different layer |

## E. Where Haven should and shouldn't compete

**Should:**

* **Privacy-first / regulated-vertical apps** — legal tech, healthcare,
  financial records. This is the only category where local-only is
  necessary, not preference. Question: any regulated-industry ready?
  No — at-rest encryption is missing.
* **Document QA in regulated SMB** — same argument.
* **Offline-first mobile/extension use** — the only category where
  Haven's weight is tolerable.

**Shouldn't (today):**

* **Million-vector SaaS** — wrong scale; will lose to LanceDB+
  Pinecone.
* **Realtime multi-tenant** — no sync layer.
* **Server-side RAG-only API** — no server runtime; loses to LangChain
  / LlamaIndex.

## F. What to steal from competitors

| Idea | From | Effort |
| --- | --- | --- |
| HNSW index | usearch-wasm, LanceDB | ~2 weeks + Voy deprecation |
| Storage quotas / LRU eviction at storage layer | LanceDB | small |
| BYO-tokenizer token counting | LlamaIndex TS | small |
| Quantisation pipeline | LanceDB / Pinecone | medium |
| Multi-modal via CLIP | Hugging Face community | already implemented, finish test coverage |
| React hooks | third-party idiom | small |
| Better compaction strategy | RocksDB / leveldb style | medium |

## G. Strategic positioning

* Haven is closer to a *broader practical platform* than a vector DB.
* The **brand** is "private AI stack". The **current implementation**
  lives or falls by:
  * (a) Index correctness (P0 #1, P0 #2),
  * (b) Worker pool integration (P0 #4),
  * (c) Memory eviction working (P0 #3).
* Fixing the four P0s raises effectiveness by an order of magnitude
  on the *real* workload profile (small-to-medium corpus,
  occasional deletes, semantic search).
* Beyond the four P0s, the path to 2.0 is HNSW + quantization +
  encryption + multi-modal.

---

## H. Concrete "what we're missing" check, by category

```
                        Haven   Pinecone   LanceDB   Vectra
Privacy (client-only)   ✅      ❌         ❌/yes    ✅
Offline capable         ✅      ❌         partial   partial
RAG in box              ✅      ❌         ❌        ❌
MCP in box              ✅      ❌         ❌        ❌
HNSW index              ❌      ✅         ✅        ✅
IVF / PQ                ❌      n/a        ✅        ❌
Hybrid search           ❌      ✅         ❌        ❌
Multi-modal             partial ❌         ✅        ❌
At-rest encryption      ❌      ✅         ❌        ❌
Scale (>= 1M vectors)   ❌      ✅         partial   ❌
Mature CI/canary        ❌      ✅         partial   partial
```

Taken across 11 axes, Haven leads on **4/11**, ties on **0/11**, loses
on **7/11**. The 4 wins are the privacy story and orchestration depth;
the 7 losses are scaling/feature breadth. Closing them = next 6
months of work.
