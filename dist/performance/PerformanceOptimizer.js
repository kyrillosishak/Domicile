/**
 * Performance Optimizer - Main integration point for all performance optimizations
 * Coordinates caching, memory management, worker pools, and batch operations
 */
import { LRUCache } from './LRUCache';
import { MemoryManager } from './MemoryManager';
import { WorkerPool } from './WorkerPool';
import { ProgressiveLoader } from './ProgressiveLoader';
import { BatchOptimizer } from './BatchOptimizer';
/**
 * Coordinates all performance optimizations
 */
export class PerformanceOptimizer {
    constructor(config = {}) {
        this.workerPool = null;
        this.batchOptimizer = null;
        // State
        this.initialized = false;
        this.indexLoaded = false;
        this.modelsLoaded = false;
        this.config = {
            maxMemoryMB: 500,
            evictionThreshold: 0.9,
            vectorCacheSize: 100 * 1024 * 1024, // 100MB
            embeddingCacheSize: 50 * 1024 * 1024, // 50MB
            indexCacheSize: 100 * 1024 * 1024, // 100MB
            enableWorkers: true,
            maxWorkers: navigator.hardwareConcurrency || 4,
            batchSize: 100,
            batchWaitTime: 100,
            chunkSize: 1000,
            lazyLoadIndex: true,
            lazyLoadModels: true,
            ...config,
        };
        // Initialize caches
        this.vectorCache = new LRUCache({
            maxSize: this.config.vectorCacheSize,
            maxEntries: 10000,
            onEvict: (key) => {
                console.debug(`Evicted vector from cache: ${key}`);
            },
        });
        this.embeddingCache = new LRUCache({
            maxSize: this.config.embeddingCacheSize,
            maxEntries: 5000,
            onEvict: (key) => {
                console.debug(`Evicted embedding from cache: ${key}`);
            },
        });
        this.indexCache = new LRUCache({
            maxSize: this.config.indexCacheSize,
            maxEntries: 100,
            onEvict: (key) => {
                console.debug(`Evicted index data from cache: ${key}`);
            },
        });
        // Initialize memory manager
        this.memoryManager = new MemoryManager({
            maxMemoryMB: this.config.maxMemoryMB,
            evictionThreshold: this.config.evictionThreshold,
            checkInterval: 30000,
        });
        // Register caches with memory manager
        this.memoryManager.registerCache('vectors', this.vectorCache);
        this.memoryManager.registerCache('embeddings', this.embeddingCache);
        this.memoryManager.registerCache('index', this.indexCache);
        // Initialize progressive loader
        this.progressiveLoader = new ProgressiveLoader({
            chunkSize: this.config.chunkSize,
        });
        // Initialize worker pool if enabled
        if (this.config.enableWorkers) {
            this.workerPool = new WorkerPool({
                maxWorkers: this.config.maxWorkers,
            });
        }
    }
    /**
     * Initialize the performance optimizer
     */
    async initialize(storage) {
        if (this.initialized) {
            return;
        }
        // Initialize batch optimizer if storage provided
        if (storage) {
            this.batchOptimizer = new BatchOptimizer(storage, {
                maxBatchSize: this.config.batchSize,
                maxWaitTime: this.config.batchWaitTime,
                autoFlush: true,
            });
        }
        // Start memory monitoring
        this.memoryManager.startMonitoring();
        this.initialized = true;
    }
    /**
     * Get a vector from cache or storage
     */
    async getVector(id, storage) {
        // Check cache first
        const cached = this.vectorCache.get(id);
        if (cached) {
            return cached;
        }
        // Load from storage
        const record = await storage.get(id);
        if (record) {
            // Add to cache
            const size = this.estimateVectorSize(record);
            this.vectorCache.set(id, record, size);
        }
        return record;
    }
    /**
     * Get multiple vectors with caching
     */
    async getVectorBatch(ids, storage) {
        const results = [];
        const uncachedIds = [];
        // Check cache for each ID
        for (const id of ids) {
            const cached = this.vectorCache.get(id);
            if (cached) {
                results.push(cached);
            }
            else {
                uncachedIds.push(id);
            }
        }
        // Load uncached vectors from storage
        if (uncachedIds.length > 0) {
            const records = await storage.getBatch(uncachedIds);
            for (const record of records) {
                results.push(record);
                // Add to cache
                const size = this.estimateVectorSize(record);
                this.vectorCache.set(record.id, record, size);
            }
        }
        return results;
    }
    /**
     * Cache an embedding
     */
    cacheEmbedding(text, embedding) {
        const size = embedding.byteLength;
        this.embeddingCache.set(text, embedding, size);
    }
    /**
     * Get a cached embedding
     */
    getCachedEmbedding(text) {
        return this.embeddingCache.get(text);
    }
    /**
     * Cache index data
     */
    cacheIndex(key, data) {
        const size = this.estimateObjectSize(data);
        this.indexCache.set(key, data, size);
    }
    /**
     * Get cached index data
     */
    getCachedIndex(key) {
        return this.indexCache.get(key);
    }
    /**
     * Mark index as loaded (for lazy loading)
     */
    markIndexLoaded() {
        this.indexLoaded = true;
    }
    /**
     * Check if index is loaded
     */
    isIndexLoaded() {
        return this.indexLoaded || !this.config.lazyLoadIndex;
    }
    /**
     * Mark models as loaded (for lazy loading)
     */
    markModelsLoaded() {
        this.modelsLoaded = true;
    }
    /**
     * Check if models are loaded
     */
    areModelsLoaded() {
        return this.modelsLoaded || !this.config.lazyLoadModels;
    }
    /**
     * Get performance statistics
     */
    getStats() {
        const stats = {
            memory: this.memoryManager.getMemoryStats(),
            caches: {
                vectors: this.vectorCache.getStats(),
                embeddings: this.embeddingCache.getStats(),
                index: this.indexCache.getStats(),
            },
        };
        if (this.workerPool) {
            stats.workers = {
                available: this.workerPool.getAvailableWorkerCount(),
                pending: this.workerPool.getPendingTaskCount(),
            };
        }
        if (this.batchOptimizer) {
            stats.batch = {
                pending: this.batchOptimizer.getPendingCount(),
            };
        }
        return stats;
    }
    /**
     * Clear all caches
     */
    clearCaches() {
        this.vectorCache.clear();
        this.embeddingCache.clear();
        this.indexCache.clear();
    }
    /**
     * Dispose of all resources
     */
    async dispose() {
        this.memoryManager.stopMonitoring();
        this.clearCaches();
        if (this.workerPool) {
            this.workerPool.dispose();
        }
        if (this.batchOptimizer) {
            await this.batchOptimizer.flush();
            this.batchOptimizer.dispose();
        }
        this.initialized = false;
        this.indexLoaded = false;
        this.modelsLoaded = false;
    }
    /**
     * Estimate the size of a vector record in bytes
     */
    estimateVectorSize(record) {
        // Vector size + metadata size estimate
        const vectorSize = record.vector.byteLength;
        const metadataSize = this.estimateObjectSize(record.metadata);
        return vectorSize + metadataSize + 100; // +100 for overhead
    }
    /**
     * Estimate the size of an object in bytes
     */
    estimateObjectSize(obj) {
        const str = JSON.stringify(obj);
        return str.length * 2; // Rough estimate (UTF-16)
    }
}
//# sourceMappingURL=PerformanceOptimizer.js.map