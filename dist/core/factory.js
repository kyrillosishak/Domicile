/**
 * createDomicile — the default factory.
 *
 * Wires concrete adapters into the facade. Concrete instantiation lives HERE,
 * out of the facade, so `VectorDB` itself never imports an adapter — that is
 * the seam that makes every component swappable.
 *
 * The index is the pure-TS HNSW (src/index/HnswIndex.ts): real scores,
 * non-rebuilding delete, recall-guaranteed filtered search. It won the
 * Phase-3 benchmark gate (src/index/IndexBenchmark.ts) — recall parity,
 * real (non-constant) scores, and far faster deletes — and replaced the
 * previous WASM k-d tree (Voy), which has since been removed entirely.
 * Pure TS carries no native/WASM dependency, keeping the bundle auditable.
 *
 * The embedding device is auto-picked from runtime capabilities (WebGPU
 * when available, WASM otherwise) unless `forceEmbeddingDevice` is set.
 */
import { VectorDB } from './VectorDB';
import { IndexedDBStorage } from '../storage/IndexedDBStorage';
import { HnswIndex } from '../index/HnswIndex';
import { TransformersEmbedding } from '../embedding/TransformersEmbedding';
import { detectCapabilities } from './capabilities';
import { getModelRegistry } from './ModelRegistry';
export async function createDomicile(options) {
    const caps = await detectCapabilities();
    const device = options.forceEmbeddingDevice ?? (caps.webgpu ? 'webgpu' : 'wasm');
    // Init-time gating (TECHNICAL_VALIDATION risk #10): the embedding model's
    // known dimensions must match the index's, and the model must be feasible
    // on this device. Fail fast with a clear error rather than OOM-ing or
    // inserting into an index that can never hold the model's vectors.
    const registry = getModelRegistry();
    registry.validateDimensions(options.embedding.model, options.dimensions);
    const embeddingPreflight = registry.canRunEmbeddingModel(options.embedding.model, caps);
    if (!embeddingPreflight.canRun) {
        throw new Error(`Embedding model ${options.embedding.model} is not runnable here: ${embeddingPreflight.reason}`);
    }
    const storage = new IndexedDBStorage(options.storage);
    await storage.initialize();
    const index = new HnswIndex({
        dimensions: options.dimensions,
        metric: options.metric ?? 'cosine',
        m: options.hnsw?.m,
        efConstruction: options.hnsw?.efConstruction,
        efSearch: options.hnsw?.efSearch,
    });
    await index.initialize();
    const embedding = new TransformersEmbedding({
        model: options.embedding.model,
        device,
        cache: options.embedding.cache ?? true,
    });
    const config = {
        storage,
        index,
        embedding,
        performance: options.performance,
        dimensions: options.dimensions,
        metric: options.metric ?? 'cosine',
    };
    const db = new VectorDB(config);
    await db.initialize();
    return db;
}
//# sourceMappingURL=factory.js.map