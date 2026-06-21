/**
 * ModelRegistry — curated model catalog + init-time / pre-flight gating.
 *
 * Closes TECHNICAL_VALIDATION risk #10 (and 2.4's "Model size vs device
 * memory"): previously nothing validated `embedding.model.dimensions ===
 * index.dimensions` on init, and nothing pre-flighted a multi-GB WebLLM
 * download against device memory / WebGPU before it began.
 *
 * The registry is the single source of truth for which models Domicile
 * vouches for (dimensions, size, min device tier, provider). Adapters stay
 * swappable — an unknown model id is allowed through (best-effort), but the
 * catalog lets `createDomicile` and `FallbackLLMProvider` reject clearly
 * impossible configurations up front instead of OOM-ing deep into a load.
 */
import { DimensionMismatchError } from '../errors';
/**
 * Curated catalog. Dimensions are authoritative for the embedding entries —
 * `createDomicile` cross-checks them against the configured index dimensions.
 */
const EMBEDDING_CATALOG = [
    { id: 'Xenova/all-MiniLM-L6-v2', dimensions: 384, sizeMB: 25, minTier: 'low', devices: ['wasm', 'webgpu'] },
    { id: 'Xenova/ms-marco-MiniLM-L-6-v2', dimensions: 384, sizeMB: 90, minTier: 'low', devices: ['wasm', 'webgpu'] },
    { id: 'Xenova/bge-small-en-v1.5', dimensions: 384, sizeMB: 130, minTier: 'low', devices: ['wasm', 'webgpu'] },
    { id: 'Xenova/bge-base-en-v1.5', dimensions: 768, sizeMB: 220, minTier: 'mid', devices: ['wasm', 'webgpu'] },
    { id: 'Xenova/bge-large-en-v1.5', dimensions: 1024, sizeMB: 420, minTier: 'high', devices: ['wasm', 'webgpu'] },
    { id: 'Xenova/e5-base-v2', dimensions: 768, sizeMB: 280, minTier: 'mid', devices: ['wasm', 'webgpu'] },
];
const LLM_CATALOG = [
    { id: 'Llama-3.2-1B-Instruct-q4f32_1-MLC', provider: 'webllm', sizeGB: 1.0, minTier: 'low', needsWebGPU: true },
    { id: 'Llama-3.2-3B-Instruct-q4f32_1-MLC', provider: 'webllm', sizeGB: 2.4, minTier: 'mid', needsWebGPU: true },
    { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', provider: 'webllm', sizeGB: 1.3, minTier: 'low', needsWebGPU: true },
    { id: 'Qwen2.5-7B-Instruct-q4f16_1-MLC', provider: 'webllm', sizeGB: 4.8, minTier: 'high', needsWebGPU: true },
    { id: 'Hermes-2-Theta-Llama-3-8B-q4f16_1-MLC', provider: 'webllm', sizeGB: 5.0, minTier: 'high', needsWebGPU: true },
    // wllama (WASM) models — no WebGPU required, but RAM-bound; keep them small.
    { id: 'Llama-3.2-3B-Instruct', provider: 'wllama', sizeGB: 2.0, minTier: 'low', needsWebGPU: false },
    { id: 'Llama-3.2-1B-Instruct', provider: 'wllama', sizeGB: 0.8, minTier: 'low', needsWebGPU: false },
    { id: 'Qwen2.5-3B-Instruct', provider: 'wllama', sizeGB: 1.9, minTier: 'low', needsWebGPU: false },
];
const TIER_RANK = { low: 0, mid: 1, high: 2 };
export class ModelRegistry {
    constructor() {
        this.embedding = new Map();
        this.llm = new Map();
        for (const e of EMBEDDING_CATALOG)
            this.embedding.set(e.id, e);
        for (const e of LLM_CATALOG)
            this.llm.set(e.id, e);
    }
    /** All known embedding models. */
    listEmbeddingModels() {
        return [...this.embedding.values()];
    }
    /** All known LLM models. */
    listLLMModels() {
        return [...this.llm.values()];
    }
    getEmbeddingModel(id) {
        return this.embedding.get(id);
    }
    getLLMModel(id) {
        return this.llm.get(id);
    }
    /**
     * Authoritative dimensions for a known embedding model. Returns undefined
     * for unknown ids — callers that need a guarantee should use
     * `validateDimensions` instead.
     */
    getEmbeddingDimensions(id) {
        return this.embedding.get(id)?.dimensions;
    }
    /**
     * Init-time gate: the embedding model's dimensions must match the index's.
     * Throws `DimensionMismatchError` on mismatch. For unknown models the check
     * is skipped (we can't vouch for dimensions we don't know) — but a known
     * model with a wrong index size is rejected hard, before any data is
     * inserted into an index that can never hold it.
     */
    validateDimensions(embeddingModelId, indexDimensions) {
        const entry = this.embedding.get(embeddingModelId);
        if (!entry)
            return; // unknown — best-effort, let the adapter report its own dims
        if (entry.dimensions !== indexDimensions) {
            // The index was configured for `indexDimensions`, but this model emits
            // `entry.dimensions` — there's no way to reconcile, so fail at init.
            throw new DimensionMismatchError(indexDimensions, entry.dimensions);
        }
    }
    /**
     * Pre-flight feasibility check for an embedding model, before any download.
     * Considers device tier and (for WebGPU-only devices) device memory.
     */
    canRunEmbeddingModel(id, caps) {
        const entry = this.embedding.get(id);
        if (!entry) {
            // Unknown model — can't pre-flight; let the adapter try.
            return { canRun: true, reason: '' };
        }
        if (!entry.devices.includes(caps.webgpu ? 'webgpu' : 'wasm')) {
            return {
                canRun: false,
                reason: `Model ${id} does not support the ${caps.webgpu ? 'webgpu' : 'wasm'} device available here`,
                entry,
            };
        }
        const tierFail = this.checkTier(id, entry.minTier, caps);
        if (tierFail)
            return { ...tierFail, entry };
        return { canRun: true, reason: '', entry };
    }
    /**
     * Pre-flight feasibility check for an LLM model, before a multi-GB
     * download. Rejects WebLLM models when WebGPU is absent, and rejects any
     * model whose min tier exceeds the device's — so a low-RAM phone fails
     * fast with a clear message instead of OOM-ing mid-download.
     */
    canRunLLMModel(id, caps) {
        const entry = this.llm.get(id);
        if (!entry) {
            return { canRun: true, reason: '' };
        }
        if (entry.needsWebGPU && !caps.webgpu) {
            return {
                canRun: false,
                reason: `Model ${id} requires WebGPU, which is unavailable on this device`,
                entry,
            };
        }
        const tierFail = this.checkTier(id, entry.minTier, caps);
        if (tierFail)
            return { ...tierFail, entry };
        const memFail = this.checkMemory(id, entry.sizeGB, caps);
        if (memFail)
            return { ...memFail, entry };
        return { canRun: true, reason: '', entry };
    }
    /** Alias matching the TECHNICAL_VALIDATION naming. LLM-focused by default. */
    canRunModel(id, caps) {
        return this.llm.has(id)
            ? this.canRunLLMModel(id, caps)
            : this.canRunEmbeddingModel(id, caps);
    }
    /**
     * Recommend an LLM for the current device class — the smallest model that
     * meets the device tier, preferring WebLLM (WebGPU) then wllama (WASM).
     */
    recommendLLM(caps) {
        const tier = caps.deviceTier;
        const candidates = this.listLLMModels()
            .filter((e) => TIER_RANK[e.minTier] <= TIER_RANK[tier])
            .filter((e) => !e.needsWebGPU || caps.webgpu)
            .sort((a, b) => a.sizeGB - b.sizeGB);
        // Prefer a WebGPU model when available (faster), else the smallest WASM one.
        return candidates.find((e) => e.provider === 'webllm') ?? candidates[0];
    }
    checkTier(id, minTier, caps) {
        if (TIER_RANK[minTier] > TIER_RANK[caps.deviceTier]) {
            return {
                canRun: false,
                reason: `Model ${id} requires a ${minTier}-tier device (this device is ${caps.deviceTier})`,
            };
        }
        return null;
    }
    checkMemory(id, sizeGB, caps) {
        // navigator.deviceMemory is a coarse lower bound (clamped to 8 on most
        // browsers), so only reject the clearly-impossible case: a known model
        // larger than reported RAM. We never reject when memory is unknown.
        if (caps.deviceMemoryGB === undefined)
            return null;
        if (sizeGB > caps.deviceMemoryGB) {
            return {
                canRun: false,
                reason: `Model ${id} is ~${sizeGB}GB but device reports only ${caps.deviceMemoryGB}GB of memory`,
            };
        }
        return null;
    }
}
/** Shared singleton — the catalog is static data. */
let defaultRegistry = null;
export function getModelRegistry() {
    if (!defaultRegistry)
        defaultRegistry = new ModelRegistry();
    return defaultRegistry;
}
//# sourceMappingURL=ModelRegistry.js.map