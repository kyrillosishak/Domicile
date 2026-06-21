/**
 * Optimizes IndexedDB operations by batching them together
 */
export declare class BatchOptimizer {
    private config;
    private pendingOps;
    private flushTimer;
    private storage;
    constructor(storage: StorageManager_2, config: BatchOptimizerConfig);
    /**
     * Queue a put operation
     */
    put(record: VectorRecord): Promise<void>;
    /**
     * Queue a delete operation
     */
    delete(id: string): Promise<boolean>;
    /**
     * Manually flush all pending operations
     */
    flush(): Promise<void>;
    /**
     * Get the number of pending operations
     */
    getPendingCount(): number;
    /**
     * Clear all pending operations without executing them
     */
    clear(): void;
    /**
     * Clean up resources
     */
    dispose(): void;
    /**
     * Schedule a flush operation
     */
    private scheduleFlush;
}

export declare interface BatchOptimizerConfig {
    maxBatchSize: number;
    maxWaitTime: number;
    autoFlush?: boolean;
}

/**
 * Utility class for running performance benchmarks
 */
export declare class Benchmark {
    private results;
    private environment;
    constructor();
    /**
     * Detect browser and system environment
     */
    private detectEnvironment;
    /**
     * Run a benchmark function and measure performance
     */
    run<T>(name: string, description: string, fn: () => Promise<T>, options?: {
        warmup?: number;
        iterations?: number;
        collectMemory?: boolean;
    }): Promise<BenchmarkResult>;
    /**
     * Run a throughput benchmark (operations per second)
     */
    runThroughput(name: string, description: string, fn: () => Promise<void>, options?: {
        duration?: number;
        warmup?: number;
    }): Promise<BenchmarkResult>;
    /**
     * Measure memory usage over time during an operation
     */
    profileMemory(name: string, description: string, fn: () => Promise<void>, options?: {
        sampleInterval?: number;
    }): Promise<BenchmarkResult>;
    /**
     * Get current memory usage in MB
     */
    private getMemoryUsage;
    /**
     * Calculate median of an array
     */
    private calculateMedian;
    /**
     * Calculate percentile of an array
     */
    private calculatePercentile;
    /**
     * Get all benchmark results
     */
    getResults(): BenchmarkResult[];
    /**
     * Get a summary of all benchmarks
     */
    getSummary(): BenchmarkSuite;
    /**
     * Format results as a readable report
     */
    formatReport(): string;
    /**
     * Export results as JSON
     */
    exportJSON(): string;
    /**
     * Clear all results
     */
    clear(): void;
}

/**
 * Run the citation-accuracy benchmark across all pipeline variants.
 */
export declare function benchmarkCitationAccuracy(options?: CitationBenchmarkOptions): Promise<CitationBenchmarkResult>;

export declare interface BenchmarkEnvironment {
    browser: string;
    browserVersion: string;
    platform: string;
    hardwareConcurrency: number;
    deviceMemory?: number;
    connection?: string;
}

/**
 * Run the HNSW benchmark at one scale point.
 */
export declare function benchmarkIndex(scale: BenchmarkScalePoint, options?: BenchmarkOptions): Promise<IndexBenchmarkResult>;

export declare interface BenchmarkOptions {
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

/**
 * Performance Benchmarking Suite
 *
 * Comprehensive benchmarking for:
 * - Search latency across dataset sizes
 * - Insertion throughput
 * - Memory usage profiling
 * - Model load times
 */
export declare interface BenchmarkResult {
    name: string;
    description: string;
    metrics: {
        [key: string]: number | string;
    };
    timestamp: number;
    environment: BenchmarkEnvironment;
}

/**
 * Runs comprehensive performance benchmarks on VectorDB
 */
export declare class BenchmarkRunner {
    private benchmark;
    private config;
    constructor(config?: BenchmarkRunnerConfig);
    /**
     * Run all benchmarks
     */
    runAll(): Promise<BenchmarkSuite>;
    /**
     * Benchmark 1: Model Load Time
     */
    private benchmarkModelLoadTime;
    /**
     * Benchmark 2: Insertion Throughput
     */
    private benchmarkInsertionThroughput;
    /**
     * Benchmark 3: Search Latency for Various Dataset Sizes
     */
    private benchmarkSearchLatency;
    /**
     * Benchmark 4: Batch Operations
     */
    private benchmarkBatchOperations;
    /**
     * Benchmark 5: Memory Usage
     */
    private benchmarkMemoryUsage;
    /**
     * Benchmark 6: Cache Performance
     */
    private benchmarkCachePerformance;
    /**
     * Create a test VectorDB instance
     */
    private createTestDB;
    /**
     * Generate a test document with varied content
     */
    private generateTestDocument;
    /**
     * Clean up test database
     */
    private cleanupDatabase;
    /**
     * Get benchmark results
     */
    getResults(): BenchmarkSuite;
    /**
     * Print formatted report
     */
    printReport(): void;
    /**
     * Export results as JSON
     */
    exportJSON(): string;
}

declare interface BenchmarkRunnerConfig {
    datasetSizes?: number[];
    searchQueries?: number;
    embeddingModel?: string;
    useRealModels?: boolean;
    cleanup?: boolean;
}

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
export declare interface BenchmarkScalePoint {
    size: number;
    dimensions: number;
}

export declare interface BenchmarkSuite {
    name: string;
    results: BenchmarkResult[];
    summary: {
        totalTests: number;
        totalDuration: number;
        environment: BenchmarkEnvironment;
    };
}

/**
 * Run the full validation suite across scale points and report a pass/fail.
 */
export declare function benchmarkSuite(scales?: BenchmarkScalePoint[], options?: BenchmarkOptions): Promise<{
    results: IndexBenchmarkResult[];
    overallPass: boolean;
}>;

/**
 * In-memory BM25 index over a corpus of {id, text}.
 * Rebuilt when documents change; cheap for the mid-corpus sizes Domicile targets.
 */
export declare class BM25Index {
    private docs;
    private docFreq;
    private avgDocLen;
    private k1;
    private b;
    add(id: string, text: string): void;
    remove(id: string): void;
    clear(): void;
    size(): number;
    /** Score every doc against the query; return ranked list (best first). */
    search(query: string): Array<{
        id: string;
        score: number;
    }>;
    private recomputeAvg;
}

/**
 * LRU (Least Recently Used) Cache implementation
 * Used for caching vectors, embeddings, and index data
 */
export declare interface CacheEntry<T> {
    value: T;
    size: number;
    timestamp: number;
}

export declare interface CanRunResult {
    canRun: boolean;
    /** Human-readable reason when `canRun` is false (empty otherwise). */
    reason: string;
    /** The catalog entry, if the model is known. */
    entry?: EmbeddingModelEntry | LLMModelEntry;
}

/**
 * Centralized runtime capability detection.
 *
 * Every adapter probes the environment through this single source of truth
 * instead of scattered inline checks. `createDomicile()` uses it to pick
 * WebLLM vs wllama and the device tier; the Desktop app renders it as the
 * capability matrix.
 */
export declare interface Capabilities {
    webgpu: boolean;
    wasm: boolean;
    simd: boolean;
    sharedArrayBuffer: boolean;
    indexedDB: boolean;
    /** `navigator.deviceMemory`, in GB, when exposed. */
    deviceMemoryGB?: number;
    /** Max WebGPU texture dimension when probeable. */
    maxTextureSize?: number;
    /** Coarse device tier inferred from memory + GPU. */
    deviceTier: 'low' | 'mid' | 'high';
}

/** Cheap heuristic fallback: ~1 token per 4 characters. */
export declare class CharTokenizer implements Tokenizer {
    count(text: string): Promise<number>;
    truncate(text: string, maxTokens: number): Promise<string>;
    dispose(): Promise<void>;
}

/**
 * Chunker — splits long documents into passage-level chunks before embedding.
 *
 * This is the single biggest RAG-quality lever (PRODUCT_DESIGN.md B6). Today
 * a 40-page contract is embedded as one giant vector and stored as one
 * record, which destroys retrieval granularity and citation precision. The
 * chunker turns a document into many small, overlapping, boundary-respecting
 * passages, each embedded and stored as its own record linked back to the
 * parent document via metadata.
 *
 * Strategy: approximate-token sliding window with sentence-boundary
 * alignment and overlap. Token counts use a cheap whitespace heuristic by
 * default; a real tokenizer (Transformers.js) can be injected for precision
 * (used by the truncation stage, B6/Phase 4 task 19).
 */
export declare interface Chunk {
    /** The chunk text. */
    text: string;
    /** 0-based position of this chunk within the parent document. */
    index: number;
    /** Character offset where this chunk starts in the original document. */
    startOffset: number;
}

export declare interface Chunker {
    chunk(text: string): Chunk[];
}

export declare interface ChunkerOptions {
    /** Target chunk size in approximate tokens. Default 256. */
    chunkSize?: number;
    /** Overlap between adjacent chunks in approximate tokens. Default 32. */
    overlap?: number;
    /** Minimum chunk size; trailing fragments smaller than this merge into the previous chunk. Default 64. */
    minChunkSize?: number;
}

export declare interface Citation {
    id: string;
    score: number;
    snippet: string;
    metadata: Record<string, any>;
    /** 1-based rank among sources returned. */
    rank: number;
}

export declare interface CitationBenchmarkOptions {
    /** k for citation recall@k. Default 3. */
    k?: number;
    /** Reranker to exercise the rerank stage. Default: a deterministic LexOverlapReranker. */
    reranker?: Reranker;
    /** Corpus + questions. Defaults to the built-in legal corpus. */
    corpus?: CorpusPassage[];
    questions?: KnownAnswerQuestion[];
    onProgress?: (msg: string) => void;
}

export declare interface CitationBenchmarkResult {
    variants: CitationVariantResult[];
    /** The variants that beat dense-only on citation recall. */
    improvements: CitationVariant[];
    /** Overall: did hybrid+rerank strictly beat dense-only? */
    pipelineBeatsDense: boolean;
}

export declare type CitationVariant = 'dense' | 'dense+hybrid' | 'dense+rerank' | 'dense+hybrid+rerank';

export declare interface CitationVariantResult {
    variant: CitationVariant;
    /** Fraction of questions whose expected source is in the top-k. */
    citationRecallAtK: number;
    /** Mean rank of the expected source (1 = first); corpus size + 1 if absent. */
    meanExpectedRank: number;
    /** Per-question hit/miss detail. */
    perQuestion: Array<{
        query: string;
        expectedId: string;
        rank: number;
        hit: boolean;
    }>;
}

export declare interface CompoundFilter {
    operator: 'and' | 'or';
    filters: (MetadataFilter | CompoundFilter)[];
}

/** A passage in the fixed corpus. */
export declare interface CorpusPassage {
    id: string;
    text: string;
}

export declare function createDomicile(options: CreateDomicileOptions): Promise<VectorDB>;

export declare interface CreateDomicileOptions {
    storage: StorageConfig;
    dimensions: number;
    metric?: 'cosine' | 'euclidean' | 'dot';
    embedding: Omit<EmbeddingConfig, 'device'> & {
        device?: 'wasm' | 'webgpu';
    };
    performance?: PerformanceConfig_2;
    /** HNSW tuning. */
    hnsw?: {
        m?: number;
        efConstruction?: number;
        efSearch?: number;
    };
    /** Override the auto-detected embedding device. */
    forceEmbeddingDevice?: 'wasm' | 'webgpu';
}

/**
 * Built-in sanitized legal corpus. Each passage has a distinct keyword
 * signature so dense retrieval has signal but keyword-heavy queries (statute
 * names, defined terms) expose where hybrid BM25 helps — the legal use case
 * from MARKET_ANALYSIS.md §3.1.
 */
export declare const DEFAULT_LEGAL_CORPUS: CorpusPassage[];

/** Known-answer questions for the default corpus. */
export declare const DEFAULT_LEGAL_QUESTIONS: KnownAnswerQuestion[];

/**
 * Default retry configuration
 */
export declare const DEFAULT_RETRY_CONFIG: RetryConfig;

export declare function detectCapabilities(force?: boolean): Promise<Capabilities>;

export declare class DimensionMismatchError extends VectorDBError {
    constructor(expected: number, actual: number);
}

export declare interface EmbeddingConfig {
    model: string;
    device: 'wasm' | 'webgpu';
    cache?: boolean;
}

export declare type EmbeddingDevice = 'wasm' | 'webgpu';

/**
 * Embedding layer types
 */
export declare interface EmbeddingGenerator {
    initialize(): Promise<void>;
    embed(text: string): Promise<Float32Array>;
    embedBatch(texts: string[]): Promise<Float32Array[]>;
    embedImage(image: ImageData | Blob): Promise<Float32Array>;
    getDimensions(): number;
    dispose(): Promise<void>;
}

export declare interface EmbeddingGeneratorContract {
    initialize(): Promise<void>;
    embed(text: string): Promise<Float32Array>;
    /** MUST be a true batched call, not a sequential loop over `embed`. */
    embedBatch(texts: string[]): Promise<Float32Array[]>;
    embedImage?(image: ImageData | Blob): Promise<Float32Array>;
    getDimensions(): number;
    dispose(): Promise<void>;
}

export declare interface EmbeddingModelEntry {
    id: string;
    dimensions: number;
    /** Quantized download size, in MB. Used for memory/feasibility hints. */
    sizeMB: number;
    /** Minimum device tier to embed comfortably. */
    minTier: ModelDeviceTier;
    /** Devices this model supports (most run on both). */
    devices: EmbeddingDevice[];
}

/**
 * Error handler with graceful degradation and retry logic
 */
export declare class ErrorHandler {
    private logger;
    constructor(logger?: (message: string, error?: Error, context?: any) => void);
    /**
     * Handle an error with appropriate recovery strategy
     */
    handleError(error: Error, context: string): Promise<void>;
    /**
     * Execute an operation with retry logic for transient failures
     */
    withRetry<T>(operation: () => Promise<T>, config?: Partial<RetryConfig>, isRetriable?: (error: Error) => boolean): Promise<T>;
    /**
     * Determine if an error is transient and should be retried
     */
    private isTransientError;
    /**
     * Sleep for a specified duration
     */
    private sleep;
    /**
     * Rebuild index from stored vectors (recovery strategy for corrupted index)
     */
    rebuildIndex(storage: any, indexManager: any): Promise<void>;
}

export declare interface ExportData {
    version: string;
    config: VectorDBConfig;
    vectors: any[];
    index: string;
    metadata: {
        exportedAt: number;
        vectorCount: number;
        dimensions: number;
    };
}

export declare interface ExportOptions {
    includeIndex?: boolean;
    format?: 'json' | 'binary';
    onProgress?: (loaded: number, total: number) => void;
}

export declare class FallbackLLMProvider implements LLMProvider {
    private providers;
    private activeIndex;
    constructor(providers: LLMProvider[]);
    initialize(): Promise<void>;
    generate(prompt: string, options?: GenerateOptions): Promise<string>;
    generateStream(prompt: string, options?: GenerateOptions): AsyncGenerator<string>;
    isAvailable(): Promise<boolean>;
    dispose(): Promise<void>;
    /** The currently active provider, or null if none initialized. */
    getActiveProvider(): LLMProvider | null;
    private requireActive;
    /**
     * Find the next available provider after `afterIndex`, initializing it.
     * Returns null if none found. Does not mutate activeIndex on failure.
     */
    private nextAvailable;
}

export declare type Filter = MetadataFilter | CompoundFilter;

/**
 * LLM layer types
 */
export declare interface GenerateOptions {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    topK?: number;
    stopSequences?: string[];
}

export declare interface GenerateOptionsContract {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    topK?: number;
    stopSequences?: string[];
}

export declare function getModelRegistry(): ModelRegistry;

export declare class HnswIndex implements Index {
    private config;
    private nodes;
    private entryPointId;
    private maxLevel;
    private vectorCount;
    private lastUpdated;
    private isInitialized;
    private rng;
    constructor(config: HnswIndexConfig);
    initialize(): Promise<void>;
    add(vector: VectorRecord): Promise<void>;
    addBatch(vectors: VectorRecord[]): Promise<void>;
    /**
     * Mark a node deleted. Does NOT rebuild the graph — deleted nodes are
     * skipped during search and pruned from neighbor lists lazily. This is
     * the key property Voy lacked (O(n) rebuild per delete).
     */
    remove(id: string): Promise<void>;
    search(query: Float32Array, k: number, filter?: Filter): Promise<IndexHit[]>;
    serialize(): Promise<SerializedIndex>;
    deserialize(serialized: SerializedIndex): Promise<void>;
    clear(): Promise<void>;
    stats(): IndexStats_2;
    private insertNode;
    private randomLevel;
    private selectNeighbors;
    private pruneNeighbor;
    private searchLayer;
    /**
     * Greedy descent from the entry node down to `stopLayer` (exclusive),
     * returning the nearest node at the stop layer.
     */
    private greedySearchLayer;
    /**
     * Best-first search within a single layer using a dynamic candidate list
     * of size ef. Returns up to ef nearest (unsorted-ish; caller sorts).
     */
    private searchLayerFrom;
    private distance;
    private dot;
    /** Convert internal distance (smaller=nearer) to a similarity score. */
    private distanceToScore;
    private estimateMemory;
    private ensureInitialized;
}

export declare interface HnswIndexConfig {
    dimensions: number;
    metric?: 'cosine' | 'euclidean' | 'dot';
    /** Max connections per node in upper layers. Default 16. */
    m?: number;
    /** Size of the dynamic candidate list during construction. Default 200. */
    efConstruction?: number;
    /** Size of the dynamic candidate list during search. Default 50 (>= k). */
    efSearch?: number;
    /** Seed for reproducible layer assignment. Optional. */
    seed?: number;
}

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
export declare interface HybridSearchOptions {
    /** RRF damping constant. Default 60 (the standard value). */
    rrfK?: number;
    /** Weight on the dense rank. Default 0.5 (equal fusion). */
    denseWeight?: number;
    /** Weight on the BM25 rank. Default 0.5. */
    sparseWeight?: number;
}

export declare interface ImportOptions {
    validateSchema?: boolean;
    onProgress?: (loaded: number, total: number) => void;
    clearExisting?: boolean;
}

export declare interface Index {
    initialize(): Promise<void>;
    add(vector: VectorRecord): Promise<void>;
    addBatch(vectors: VectorRecord[]): Promise<void>;
    /**
     * Remove a vector by id. MUST NOT rebuild the entire index.
     * Adapters that cannot delete incrementally must document this as a
     * known limitation rather than silently O(n)-rebuilding.
     */
    remove(id: string): Promise<void>;
    /**
     * Search for k nearest neighbours. Returned scores MUST be real
     * similarity values (e.g. cosine in [-1,1] or [0,1]), never a
     * constant placeholder.
     */
    search(query: Float32Array, k: number, filter?: Filter): Promise<IndexHit[]>;
    serialize(): Promise<SerializedIndex>;
    deserialize(data: SerializedIndex): Promise<void>;
    clear(): Promise<void>;
    stats(): IndexStats_2;
}

export declare interface IndexBenchmarkResult {
    scale: BenchmarkScalePoint;
    hnsw: IndexMetrics;
    /** does HNSW satisfy the quality gate at this scale point? */
    pass: boolean;
}

export declare interface IndexConfig {
    indexType: 'hnsw';
    dimensions: number;
    metric: 'cosine' | 'euclidean' | 'dot';
    parameters?: Record<string, any>;
}

export declare class IndexCorruptedError extends VectorDBError {
    constructor(details?: any);
}

export declare class IndexedDBStorage implements StorageManager_2 {
    private db;
    private config;
    private dbName;
    constructor(config: StorageConfig);
    /**
     * Initialize the IndexedDB database with proper schema
     */
    initialize(): Promise<void>;
    /**
     * Store a single vector record
     */
    put(record: VectorRecord): Promise<void>;
    /**
     * Store multiple vector records in a batch
     */
    putBatch(records: VectorRecord[]): Promise<void>;
    /**
     * Retrieve a single vector record by ID
     */
    get(id: string): Promise<VectorRecord | null>;
    /**
     * Retrieve multiple vector records by IDs
     */
    getBatch(ids: string[]): Promise<VectorRecord[]>;
    /**
     * Get all vector records
     */
    getAll(): Promise<VectorRecord[]>;
    /**
     * Stream all vector records one at a time via a cursor.
     *
     * Unlike `getAll()`, this never materializes the full result set in
     * memory — the cursor advances one record at a time and each is
     * yielded before the next is fetched. This is what makes
     * `VectorDB.exportStream()` a true stream rather than a buffered one.
     */
    stream(): AsyncGenerator<VectorRecord, void, unknown>;
    /**
     * Delete a vector record by ID
     */
    delete(id: string): Promise<boolean>;
    /**
     * Clear all vector records
     */
    clear(): Promise<void>;
    /**
     * Filter vector records by metadata
     */
    filter(predicate: Filter): Promise<VectorRecord[]>;
    /**
     * Count total number of vector records
     */
    count(): Promise<number>;
    /**
     * Save serialized index to storage
     */
    saveIndex(serializedIndex: string): Promise<void>;
    /**
     * Load serialized index from storage
     */
    loadIndex(): Promise<string | null>;
    /**
     * Close the database connection
     */
    close(): Promise<void>;
    /**
     * Delete the entire database
     */
    destroy(): Promise<void>;
    /**
     * Serialize a vector record for storage.
     * The Float32Array is stored by reference — IndexedDB's structured clone
     * handles typed arrays natively, which avoids the ~8x memory spike of
     * `Array.from` (a 384-dim Float32Array became a 384-element JS array of
     * boxed numbers per record, per batch write).
     */
    private serializeRecord;
    /**
     * Deserialize a stored record back to VectorRecord.
     * Handles both the native typed-array form (new) and the legacy plain-array
     * form written by older versions, for back-compat during migration.
     */
    private deserializeRecord;
    /**
     * Evaluate a filter (simple or compound) against a record
     */
    private evaluateFilter;
    /**
     * Type guard to check if a filter is a compound filter
     */
    private isCompoundFilter;
    /**
     * Evaluate a compound filter (AND/OR logic)
     */
    private evaluateCompoundFilter;
    /**
     * Check if a record matches a metadata filter
     */
    private matchesFilter;
    /**
     * Get nested value from object using dot notation
     */
    private getNestedValue;
    /**
     * Ensure the database is initialized
     */
    private ensureInitialized;
}

export declare interface IndexHit {
    id: string;
    /** Real similarity score. NEVER a placeholder. Adapters must not hardcode this. */
    score: number;
}

export declare interface IndexMetrics {
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

export declare interface IndexStats {
    vectorCount: number;
    dimensions: number;
    indexType: string;
    memoryUsage: number;
    lastUpdated: number;
}

declare interface IndexStats_2 {
    vectorCount: number;
    dimensions: number;
    indexType: string;
    memoryUsage: number;
    lastUpdated: number;
}

export declare interface IngestProgress {
    phase: 'idle' | 'ingesting' | 'done' | 'error';
    loaded: number;
    total: number;
    error: Error | null;
}

/**
 * Injection-based config. When provided, the facade uses these instances
 * directly instead of instantiating concrete adapters — the seam that makes
 * every runtime component swappable. `createDomicile()` wires the defaults.
 */
export declare interface InjectedConfig {
    storage: StorageManager_2;
    embedding?: EmbeddingGenerator;
    index: Index;
    performance?: PerformanceConfig_2;
    dimensions: number;
    metric?: 'cosine' | 'euclidean' | 'dot';
}

/**
 * Input validation utilities
 */
export declare class InputValidator {
    /**
     * Validate a vector for correct dimensions and valid values
     */
    static validateVector(vector: Float32Array, expectedDim: number): void;
    /**
     * Check if all vector values are finite
     */
    static isFiniteVector(vector: Float32Array): boolean;
    /**
     * Validate and sanitize metadata to prevent XSS and ensure valid structure
     */
    static validateAndSanitizeMetadata(metadata: any): Record<string, any>;
    /**
     * Sanitize a single metadata value
     */
    private static sanitizeValue;
    /**
     * Sanitize string to prevent XSS attacks
     */
    static sanitizeString(str: string): string;
    /**
     * Validate search query parameters
     */
    static validateSearchQuery(k: number, _dimensions?: number): void;
}

export declare interface InsertData {
    vector?: Float32Array;
    text?: string;
    metadata?: Record<string, any>;
}

/**
 * MCP interface types
 */
export declare interface JSONSchema {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
    description?: string;
    [key: string]: any;
}

/** A known-answer question: the query and the id of the passage that should be cited. */
export declare interface KnownAnswerQuestion {
    query: string;
    expectedId: string;
}

export declare interface LLMConfig {
    provider: 'wllama' | 'webllm';
    model: string;
    options?: Record<string, any>;
}

export declare interface LLMModelEntry {
    id: string;
    provider: LLMProviderKind;
    /** Quantized download size, in GB. */
    sizeGB: number;
    /** Minimum device tier to run without OOM. */
    minTier: ModelDeviceTier;
    /** WebLLM models require WebGPU. */
    needsWebGPU: boolean;
}

export declare interface LLMProvider {
    initialize(): Promise<void>;
    generate(prompt: string, options?: GenerateOptions): Promise<string>;
    generateStream(prompt: string, options?: GenerateOptions): AsyncGenerator<string>;
    /**
     * Non-throwing capability probe. Returns true if this provider can run
     * in the current environment (e.g. WebGPU present for WebLLM). Used by
     * FallbackLLMProvider to cascade providers without try/catching a
     * thrown init.
     */
    isAvailable(): Promise<boolean>;
    dispose(): Promise<void>;
}

export declare interface LLMProviderContract {
    initialize(): Promise<void>;
    generate(prompt: string, options?: GenerateOptionsContract): Promise<string>;
    generateStream(prompt: string, options?: GenerateOptionsContract): AsyncGenerator<string>;
    /**
     * Non-throwing capability probe. Returns true if this provider can run
     * in the current environment (e.g. WebGPU present for WebLLM). Used by
     * FallbackLLMProvider to cascade without try/catching a thrown init.
     */
    isAvailable(): Promise<boolean>;
    dispose(): Promise<void>;
}

export declare type LLMProviderKind = 'webllm' | 'wllama';

export declare interface LoadProgress {
    loaded: number;
    total: number;
    percent: number;
}

/**
 * Generic LRU Cache with size-based eviction
 */
export declare class LRUCache<T> {
    private cache;
    private accessOrder;
    private currentSize;
    private config;
    constructor(config: LRUCacheConfig);
    /**
     * Get a value from the cache
     */
    get(key: string): T | undefined;
    /**
     * Set a value in the cache
     */
    set(key: string, value: T, size: number): void;
    /**
     * Check if a key exists in the cache
     */
    has(key: string): boolean;
    /**
     * Delete a specific entry
     */
    delete(key: string): boolean;
    /**
     * Clear all entries
     */
    clear(): void;
    /**
     * Get current cache size in bytes
     */
    size(): number;
    /**
     * Get number of entries
     */
    count(): number;
    /**
     * Get cache statistics
     */
    getStats(): {
        size: number;
        count: number;
        maxSize: number;
        maxEntries: number;
        utilizationPercent: number;
    };
    /**
     * Evict the least recently used entry
     */
    private evictLRU;
    /**
     * Update access order for a key (move to end)
     */
    private updateAccessOrder;
}

export declare interface LRUCacheConfig {
    maxSize: number;
    maxEntries?: number;
    onEvict?: (key: string, value: any) => void;
}

/**
 * Matter-scoping for multi-matter agent exposure. A scope injects a
 * non-bypassable default metadata filter into every search/insert/rag call,
 * so an agent wired to one matter cannot read or write another's documents
 * (PRODUCT_DESIGN.md B7). Today `filter` is caller-supplied and optional —
 * unsafe for multi-tenant agent exposure; the scope closes that hole.
 */
declare interface MatterScope {
    /** The metadata field that identifies a matter (e.g. 'matter'). */
    field: string;
    /** The matter value to enforce. */
    value: string;
    /** Which tools the scope applies to. Default: all data-touching tools. */
    enforceOn?: ('search_vectors' | 'insert_document' | 'delete_document' | 'rag_query')[];
}

/**
 * MCPServer - Manages MCP tool execution for vector database operations
 *
 * Provides standardized tools for:
 * - Semantic search (search_vectors)
 * - Document insertion (insert_document)
 * - Document deletion (delete_document)
 * - RAG queries (rag_query)
 *
 * `serve(transport)` mounts these tools on a real Model Context Protocol
 * server (stdio/SSE/streamable-http) so agents like Claude Desktop can call
 * them over the wire — closing the gap where the README advertised MCP
 * integration but only a tool registry existed (PRODUCT_DESIGN.md B7).
 */
export declare class MCPServer {
    private vectorDB;
    private ragPipeline?;
    private scope?;
    private tools;
    constructor(config: MCPServerConfig);
    /**
     * Get all available MCP tools
     *
     * @returns Array of MCP tool definitions
     */
    getTools(): MCPTool[];
    /**
     * Execute a specific MCP tool by name
     *
     * @param name - Tool name to execute
     * @param params - Tool parameters
     * @returns Tool execution result
     */
    executeTool(name: string, params: any): Promise<any>;
    /**
     * Initialize all MCP tools
     *
     * @returns Array of MCP tool definitions with handlers
     */
    private initializeTools;
    /**
     * Build a non-bypassable matter-scope filter. The scope is AND-merged with
     * any caller-supplied filter so an agent cannot escape its matter by
     * omitting or overriding the filter. Returns undefined when no scope is set.
     */
    private scopeFilter;
    /** Stamp the matter scope onto an insert's metadata (non-bypassable). */
    private scopedMetadata;
    /**
     * Create the search_vectors tool
     */
    private createSearchVectorsTool;
    /**
     * Create the insert_document tool
     */
    private createInsertDocumentTool;
    /**
     * Create the delete_document tool
     */
    private createDeleteDocumentTool;
    /**
     * Create the rag_query tool
     */
    private createRAGQueryTool;
    /**
     * Validate parameters against JSON schema
     *
     * @param params - Parameters to validate
     * @param schema - JSON schema to validate against
     */
    private validateParams;
    /**
     * Validate a value against a schema type
     *
     * @param value - Value to validate
     * @param schema - Schema to validate against
     * @param fieldName - Field name for error messages
     */
    private validateType;
    /**
     * Get tool by name
     *
     * @param name - Tool name
     * @returns Tool definition or undefined
     */
    getTool(name: string): MCPTool | undefined;
    /**
     * Check if a tool exists
     *
     * @param name - Tool name
     * @returns True if tool exists
     */
    hasTool(name: string): boolean;
    /**
     * Get list of available tool names
     *
     * @returns Array of tool names
     */
    getToolNames(): string[];
    /**
     * Mount the tool registry onto a real Model Context Protocol server and
     * start serving over the chosen transport.
     *
     *  - `stdio`            — binds StdioServerTransport; returns the McpServer.
     *    The process stays alive until the client disconnects.
     *  - `sse`              — binds a real Node HTTP server. GET on the endpoint
     *    opens the SSE stream; POST sends messages. Returns the http.Server.
     *  - `streamable-http`  — binds a real Node HTTP server with a single
     *    stateful StreamableHTTPServerTransport handling all verbs. Returns the
     *    http.Server.
     *
     * The HTTP transports are Node-only (`node:http`); they are not part of the
     * browser bundle. Call `server.close()` on the returned http.Server to stop.
     */
    serve(transport: MCPTransport, options?: {
        port?: number;
        endpoint?: string;
    }): Promise<any>;
    /**
     * SSE transport over a real Node HTTP server. One SSEServerTransport per
     * connected client (keyed by sessionId); GET upgrades, POST delivers.
     */
    private serveSSE;
    /**
     * Streamable HTTP transport over a real Node HTTP server. A single
     * stateful transport handles initialize/POST/GET/DELETE; one session.
     */
    private serveStreamableHTTP;
    /**
     * Register a single Domicile tool on the MCP Server. Uses the low-level
     * request handler so we control schema shape (our JSONSchema) and delegate
     * execution to our validated `executeTool`.
     */
    private registerOnMcpServer;
}

export declare interface MCPServerConfig {
    vectorDB: VectorDB;
    ragPipeline?: RAGPipeline;
    embeddingGenerator?: EmbeddingGenerator;
    /** Optional matter scope enforcing non-bypassable per-matter isolation. */
    scope?: MatterScope;
}

export declare interface MCPTool {
    name: string;
    description: string;
    inputSchema: JSONSchema;
    handler: (params: any) => Promise<any>;
}

declare type MCPTransport = 'stdio' | 'sse' | 'streamable-http';

/**
 * Manages memory usage across caches and triggers eviction when needed
 */
export declare class MemoryManager {
    private config;
    private caches;
    private checkIntervalId;
    private memoryPressureCallbacks;
    constructor(config: MemoryManagerConfig);
    /**
     * Register a cache for memory management
     */
    registerCache(name: string, cache: LRUCache<any>): void;
    /**
     * Register a callback to be called when memory pressure is detected
     */
    onMemoryPressure(callback: () => Promise<void>): void;
    /**
     * Start monitoring memory usage
     */
    startMonitoring(): void;
    /**
     * Stop monitoring memory usage
     */
    stopMonitoring(): void;
    /**
     * Check current memory usage and trigger eviction if needed
     */
    checkMemory(): Promise<void>;
    /**
     * Get current memory statistics
     */
    getMemoryStats(): MemoryStats;
    /**
     * Handle memory pressure by evicting cache entries
     */
    private handleMemoryPressure;
    /**
     * Force eviction across all caches
     */
    forceEviction(targetUtilization?: number): Promise<void>;
    /**
     * Clean up resources
     */
    dispose(): void;
}

export declare interface MemoryManagerConfig {
    maxMemoryMB: number;
    evictionThreshold: number;
    checkInterval?: number;
}

export declare interface MemoryStats {
    usedMemory: number;
    totalMemory: number;
    utilizationPercent: number;
    cacheStats: {
        vectors: any;
        embeddings: any;
        index: any;
    };
}

export declare interface MetadataFilter {
    field: string;
    operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';
    value: any;
}

export declare type ModelDeviceTier = 'low' | 'mid' | 'high';

export declare class ModelLoadError extends VectorDBError {
    constructor(model: string, cause: Error);
}

export declare class ModelRegistry {
    private embedding;
    private llm;
    constructor();
    /** All known embedding models. */
    listEmbeddingModels(): EmbeddingModelEntry[];
    /** All known LLM models. */
    listLLMModels(): LLMModelEntry[];
    getEmbeddingModel(id: string): EmbeddingModelEntry | undefined;
    getLLMModel(id: string): LLMModelEntry | undefined;
    /**
     * Authoritative dimensions for a known embedding model. Returns undefined
     * for unknown ids — callers that need a guarantee should use
     * `validateDimensions` instead.
     */
    getEmbeddingDimensions(id: string): number | undefined;
    /**
     * Init-time gate: the embedding model's dimensions must match the index's.
     * Throws `DimensionMismatchError` on mismatch. For unknown models the check
     * is skipped (we can't vouch for dimensions we don't know) — but a known
     * model with a wrong index size is rejected hard, before any data is
     * inserted into an index that can never hold it.
     */
    validateDimensions(embeddingModelId: string, indexDimensions: number): void;
    /**
     * Pre-flight feasibility check for an embedding model, before any download.
     * Considers device tier and (for WebGPU-only devices) device memory.
     */
    canRunEmbeddingModel(id: string, caps: Capabilities): CanRunResult;
    /**
     * Pre-flight feasibility check for an LLM model, before a multi-GB
     * download. Rejects WebLLM models when WebGPU is absent, and rejects any
     * model whose min tier exceeds the device's — so a low-RAM phone fails
     * fast with a clear message instead of OOM-ing mid-download.
     */
    canRunLLMModel(id: string, caps: Capabilities): CanRunResult;
    /** Alias matching the TECHNICAL_VALIDATION naming. LLM-focused by default. */
    canRunModel(id: string, caps: Capabilities): CanRunResult;
    /**
     * Recommend an LLM for the current device class — the smallest model that
     * meets the device tier, preferring WebLLM (WebGPU) then wllama (WASM).
     */
    recommendLLM(caps: Capabilities): LLMModelEntry | undefined;
    private checkTier;
    private checkMemory;
}

/**
 * A no-op reranker that preserves input order. Used as the default when
 * reranking is disabled, so the pipeline stages are uniform.
 */
export declare class NoopReranker implements Reranker {
    isReady(): boolean;
    rerank(_query: string, candidates: SearchResult[]): Promise<SearchResult[]>;
    dispose(): Promise<void>;
}

export declare interface PendingOperation {
    type: 'put' | 'delete';
    data: VectorRecord | string;
    resolve: (result: any) => void;
    reject: (error: Error) => void;
}

export declare interface PerformanceConfig {
    maxMemoryMB?: number;
    evictionThreshold?: number;
    vectorCacheSize?: number;
    embeddingCacheSize?: number;
    indexCacheSize?: number;
    enableWorkers?: boolean;
    maxWorkers?: number;
    batchSize?: number;
    batchWaitTime?: number;
    chunkSize?: number;
    lazyLoadIndex?: boolean;
    lazyLoadModels?: boolean;
}

declare interface PerformanceConfig_2 {
    maxMemoryMB?: number;
    evictionThreshold?: number;
    vectorCacheSize?: number;
    embeddingCacheSize?: number;
    indexCacheSize?: number;
    enableWorkers?: boolean;
    maxWorkers?: number;
    batchSize?: number;
    batchWaitTime?: number;
    chunkSize?: number;
    lazyLoadIndex?: boolean;
    lazyLoadModels?: boolean;
}

/**
 * Coordinates all performance optimizations
 */
export declare class PerformanceOptimizer {
    private config;
    vectorCache: LRUCache<VectorRecord>;
    embeddingCache: LRUCache<Float32Array>;
    indexCache: LRUCache<any>;
    memoryManager: MemoryManager;
    workerPool: WorkerPool | null;
    progressiveLoader: ProgressiveLoader;
    batchOptimizer: BatchOptimizer | null;
    private initialized;
    private indexLoaded;
    private modelsLoaded;
    constructor(config?: PerformanceConfig);
    /**
     * Initialize the performance optimizer
     */
    initialize(storage?: StorageManager_2): Promise<void>;
    /**
     * Get a vector from cache or storage
     */
    getVector(id: string, storage: StorageManager_2): Promise<VectorRecord | null>;
    /**
     * Get multiple vectors with caching
     */
    getVectorBatch(ids: string[], storage: StorageManager_2): Promise<VectorRecord[]>;
    /**
     * Cache an embedding
     */
    cacheEmbedding(text: string, embedding: Float32Array): void;
    /**
     * Get a cached embedding
     */
    getCachedEmbedding(text: string): Float32Array | undefined;
    /**
     * Cache index data
     */
    cacheIndex(key: string, data: any): void;
    /**
     * Get cached index data
     */
    getCachedIndex(key: string): any | undefined;
    /**
     * Mark index as loaded (for lazy loading)
     */
    markIndexLoaded(): void;
    /**
     * Check if index is loaded
     */
    isIndexLoaded(): boolean;
    /**
     * Mark models as loaded (for lazy loading)
     */
    markModelsLoaded(): void;
    /**
     * Check if models are loaded
     */
    areModelsLoaded(): boolean;
    /**
     * Get performance statistics
     */
    getStats(): {
        memory: any;
        caches: {
            vectors: any;
            embeddings: any;
            index: any;
        };
        workers?: {
            available: number;
            pending: number;
        };
        batch?: {
            pending: number;
        };
    };
    /**
     * Clear all caches
     */
    clearCaches(): void;
    /**
     * Dispose of all resources
     */
    dispose(): Promise<void>;
    /**
     * Estimate the size of a vector record in bytes
     */
    private estimateVectorSize;
    /**
     * Estimate the size of an object in bytes
     */
    private estimateObjectSize;
}

/**
 * Loads large datasets progressively to manage memory usage
 */
export declare class ProgressiveLoader {
    private config;
    constructor(config: ProgressiveLoaderConfig);
    /**
     * Load all vectors from storage in chunks
     */
    loadVectorsInChunks(storage: StorageManager_2): AsyncGenerator<VectorRecord[], void, unknown>;
    /**
     * Load vectors with progress tracking
     */
    loadWithProgress(storage: StorageManager_2, onProgress: (progress: LoadProgress) => void): Promise<VectorRecord[]>;
    /**
     * Stream process vectors without loading all into memory
     */
    streamProcess(storage: StorageManager_2, processor: (record: VectorRecord) => Promise<void>): Promise<void>;
    /**
     * Export data in chunks to avoid memory issues
     */
    exportInChunks(storage: StorageManager_2): AsyncGenerator<any[], void, unknown>;
    /**
     * Import data in batches with progress tracking
     */
    importInBatches(storage: StorageManager_2, records: VectorRecord[], onProgress?: (loaded: number, total: number) => void): Promise<void>;
}

export declare interface ProgressiveLoaderConfig {
    chunkSize: number;
    onProgress?: (loaded: number, total: number) => void;
    onChunk?: (chunk: VectorRecord[]) => Promise<void>;
}

/**
 * Configurable prompt template. Replaces the hardcoded English instruction
 * previously baked into the pipeline (PRODUCT_DESIGN.md B6, stage 4). Legal
 * use needs jurisdiction-aware instructions; this lets callers supply them
 * without forking the pipeline.
 *
 * Placeholders: {context} {question} {sources}
 */
export declare interface PromptTemplate {
    /** System/leading instruction, prepended to the context. */
    system?: string;
    /** How each context passage is framed. Placeholders: {index} {content} {title} */
    contextItemTemplate?: string;
    /** Joiner between context passages. Default '\n\n'. */
    contextJoin?: string;
    /** The full prompt assembly, with {system}{context}{question}. */
    template?: string;
}

export declare interface RAGOptions {
    topK?: number;
    filter?: Filter;
    contextTemplate?: string;
    promptTemplate?: PromptTemplate;
    generateOptions?: GenerateOptions;
    maxContextTokens?: number;
    includeSourcesInResponse?: boolean;
    /** Enable BM25+dense hybrid fusion. Default: pipeline config. */
    hybrid?: boolean;
    /** Enable cross-encoder reranking. Default: pipeline config. */
    rerank?: boolean;
}

export declare interface RAGPipeline {
    query(query: string, options?: RAGOptions): Promise<RAGResult>;
    queryStream(query: string, options?: RAGOptions): AsyncGenerator<RAGStreamChunk>;
}

export declare interface RAGPipelineConfig {
    vectorDB: VectorDB;
    llmProvider: LLMProvider;
    embeddingGenerator: EmbeddingGenerator;
    defaultContextTemplate?: string;
    defaultPromptTemplate?: PromptTemplate;
    defaultMaxContextTokens?: number;
    /** Tokenizer for accurate context truncation. Default: CharTokenizer (length/4). */
    tokenizer?: Tokenizer;
    /** Reranker stage. Default: NoopReranker (disabled). */
    reranker?: Reranker;
    /** Enable hybrid BM25+dense fusion by default. Default: false. */
    hybridByDefault?: boolean;
    /** Enable reranking by default. Default: false. */
    rerankByDefault?: boolean;
    /** How many candidates to retrieve before reranking. Default: topK * 4. */
    retrieveMultiplier?: number;
}

/**
 * RAGPipelineManager - Implements the RAG (Retrieval-Augmented Generation) pipeline
 */
export declare class RAGPipelineManager implements RAGPipeline {
    private vectorDB;
    private llmProvider;
    private embeddingGenerator;
    private defaultContextTemplate;
    private defaultPromptTemplate;
    private defaultMaxContextTokens;
    private tokenizer;
    private reranker;
    private bm25;
    private hybridByDefault;
    private rerankByDefault;
    private retrieveMultiplier;
    constructor(config: RAGPipelineConfig);
    /**
     * Index a document's text into the BM25 sparse index for hybrid search.
     * Call this when documents are added to the vector DB so the sparse index
     * stays in sync. (The dense index is maintained by VectorDB itself.)
     */
    indexDocument(id: string, text: string): void;
    /** Remove a document from the BM25 sparse index. */
    removeDocument(id: string): void;
    /**
     * Swap the LLM provider at runtime. Used by UIs that boot with a
     * retrieval-only (noop) provider and upgrade to a real local LLM once its
     * model finishes loading in the background.
     */
    setLLMProvider(provider: LLMProvider): void;
    /** The active LLM provider (for UI status display). */
    getLLMProvider(): LLMProvider;
    /**
     * Execute a RAG query: retrieve relevant documents and generate a response
     *
     * @param query - User query text
     * @param options - RAG options including topK, filters, and generation settings
     * @returns RAG result with answer, sources, and metadata
     */
    query(query: string, options?: RAGOptions): Promise<RAGResult>;
    /**
     * Execute a streaming RAG query: retrieve documents and stream the generated response
     *
     * @param query - User query text
     * @param options - RAG options including topK, filters, and generation settings
     * @yields RAG stream chunks with retrieval results and generated text
     */
    queryStream(query: string, options?: RAGOptions): AsyncGenerator<RAGStreamChunk>;
    /**
     * Retrieve relevant documents for a query
     *
     * @param query - User query text
     * @param options - RAG options with topK and filter
     * @returns Array of search results
     */
    private retrieve;
    /**
     * Format context from retrieved documents using a template
     *
     * @param results - Search results to format
     * @param options - RAG options with optional context template
     * @returns Formatted context string
     */
    private formatContext;
    /**
     * Apply a template to a search result
     *
     * @param template - Template string with placeholders
     * @param result - Search result to format
     * @param index - Result index (0-based)
     * @returns Formatted string
     */
    private applyTemplate;
    /**
     * Build a prompt with context injection, using a configurable template.
     *
     * Replaces the previously hardcoded English instruction. Callers pass a
     * PromptTemplate (system, contextItemTemplate, template) for
     * jurisdiction-aware or domain-specific instructions.
     */
    private buildPrompt;
    /**
     * Build citation objects binding the answer back to its source passages.
     * Each citation carries the source id, score, a snippet, metadata, and a
     * 1-based rank — the audit trail that makes privilege-grounded answers
     * reviewable (PRODUCT_DESIGN.md B6, stage 7).
     */
    private buildCitations;
    private snippetOf;
    /**
     * Get the default context template
     *
     * @returns Default template string
     */
    private getDefaultTemplate;
    /**
     * Set a custom context template
     *
     * @param template - Template string with placeholders
     */
    setContextTemplate(template: string): void;
    /**
     * Set the default maximum context tokens
     *
     * @param maxTokens - Maximum number of tokens for context
     */
    setMaxContextTokens(maxTokens: number): void;
    /**
     * Get current configuration
     *
     * @returns Current RAG pipeline configuration
     */
    getConfig(): {
        defaultContextTemplate: string;
        defaultMaxContextTokens: number;
    };
}

export declare interface RAGResult {
    answer: string;
    sources: SearchResult[];
    citations: Citation[];
    metadata: {
        retrievalTime: number;
        generationTime: number;
        tokensGenerated?: number;
        contextLength?: number;
        reranked?: boolean;
        hybrid?: boolean;
    };
}

export declare interface RAGStreamChunk {
    type: 'retrieval' | 'generation' | 'complete';
    content: string;
    sources?: SearchResult[];
    metadata?: {
        retrievalTime?: number;
        generationTime?: number;
    };
}

export declare interface RankedDoc {
    id: string;
    /** Fused score (higher is better). */
    score: number;
    /** Original dense rank (1-based), undefined if not in dense results. */
    denseRank?: number;
    /** Original sparse rank (1-based), undefined if not in sparse results. */
    sparseRank?: number;
}

/**
 * Reciprocal Rank Fusion of a dense and a sparse ranked list.
 * fused(d) = wD / (k + denseRank(d)) + wS / (k + sparseRank(d))
 */
export declare function reciprocalRankFusion(dense: Array<{
    id: string;
}>, sparse: Array<{
    id: string;
}>, options?: HybridSearchOptions): RankedDoc[];

export declare interface Reranker {
    /** Re-score and reorder candidates by query relevance. */
    rerank(query: string, candidates: SearchResult[]): Promise<SearchResult[]>;
    /** Whether a cross-encoder model is loaded and ready. */
    isReady(): boolean;
    dispose(): Promise<void>;
}

export declare interface RerankerOptions {
    /** Hugging Face cross-encoder model id. Default: a small MS-MARCO model. */
    model?: string;
    /** Device: 'webgpu' attempts GPU, falls back to 'wasm'. Default 'wasm'. */
    device?: 'wasm' | 'webgpu';
    /** Top-N from the candidate list to actually re-score (cost control). Default: all. */
    topN?: number;
}

/**
 * Residency boundary enforcement.
 *
 * Domicile's moat is architectural privacy: user data never leaves the
 * device. This module makes that claim machine-checkable rather than
 * rhetorical. The only permitted egress is model-weight downloads, and
 * only to allowlisted hosts (configurable to a self-hostable origin).
 *
 * In production builds the hard guard is a no-op (tree-shaken) to avoid
 * runtime overhead; in dev/test it instruments `fetch`/`XMLHttpRequest`
 * and throws on any egress to a non-allowlisted host.
 */
export declare interface ResidencyConfig {
    /**
     * Hosts allowed for model-weight downloads. Default: Hugging Face CDN
     * and jsdelivr (where Transformers.js / WebLLM weights are served).
     * Set to a self-hostable origin for air-gapped/on-prem deployments.
     */
    allowedHosts?: string[];
    /** Enable the dev-mode hard guard. Default: true in dev, false in prod. */
    enabled?: boolean;
}

export declare class ResidencyGuard {
    private allowed;
    private enabled;
    private installed;
    private originalFetch?;
    private originalXHROpen?;
    constructor(config?: ResidencyConfig);
    isAllowed(url: string): boolean;
    assert(url: string): void;
    /**
     * Install fetch/XHR instrumentation. Call once in dev/test entrypoints.
     * No-op if disabled or already installed.
     */
    install(): void;
    /** Restore original fetch/XHR. */
    restore(): void;
    private hostOf;
}

export declare class ResidencyViolationError extends Error {
    readonly host: string;
    constructor(host: string);
}

/**
 * Retry configuration for transient failures
 */
export declare interface RetryConfig {
    maxAttempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
}

export declare interface SearchQuery {
    vector?: Float32Array;
    text?: string;
    k: number;
    filter?: Filter;
    includeVectors?: boolean;
}

export declare interface SearchResult {
    id: string;
    score: number;
    metadata: Record<string, any>;
    vector?: Float32Array;
}

export declare class SentenceChunker implements Chunker {
    private opts;
    constructor(opts?: ChunkerOptions);
    chunk(text: string): Chunk[];
}

export declare interface SerializedIndex {
    version: string;
    dimensions: number;
    metric: string;
    vectorCount: number;
    /** Engine-specific serialized blob. */
    data: string;
}

/**
 * Core configuration types for VectorDB
 */
export declare interface StorageConfig {
    dbName: string;
    version?: number;
    maxVectors?: number;
}

declare interface StorageManager_2 {
    initialize(): Promise<void>;
    put(record: VectorRecord): Promise<void>;
    putBatch(records: VectorRecord[]): Promise<void>;
    get(id: string): Promise<VectorRecord | null>;
    getBatch(ids: string[]): Promise<VectorRecord[]>;
    getAll(): Promise<VectorRecord[]>;
    /** True streaming iteration over stored records. Optional; used by exportStream. */
    stream?(): AsyncIterable<VectorRecord>;
    delete(id: string): Promise<boolean>;
    clear(): Promise<void>;
    filter(predicate: Filter): Promise<VectorRecord[]>;
    count(): Promise<number>;
    saveIndex(serializedIndex: string): Promise<void>;
    loadIndex(): Promise<string | null>;
    close?(): Promise<void>;
    destroy?(): Promise<void>;
}
export { StorageManager_2 as StorageManager }

export declare interface StorageManagerContract {
    initialize(): Promise<void>;
    put(record: VectorRecord): Promise<void>;
    putBatch(records: VectorRecord[]): Promise<void>;
    get(id: string): Promise<VectorRecord | null>;
    getBatch(ids: string[]): Promise<VectorRecord[]>;
    getAll(): Promise<VectorRecord[]>;
    /** True streaming iteration over stored records. Optional; used by exportStream. */
    stream?(): AsyncIterable<VectorRecord>;
    delete(id: string): Promise<boolean>;
    clear(): Promise<void>;
    filter(predicate: Filter): Promise<VectorRecord[]>;
    count(): Promise<number>;
    saveIndex(serializedIndex: string): Promise<void>;
    loadIndex(): Promise<string | null>;
    close?(): Promise<void>;
    destroy?(): Promise<void>;
}

export declare class StorageQuotaError extends VectorDBError {
    constructor(details?: any);
}

/** Tokenize for sparse indexing: lowercase, alnum, drop stopwords/empties. */
export declare function tokenize(text: string): string[];

/**
 * Tokenizer abstraction for accurate context-budget accounting.
 *
 * The original RAG pipeline estimated tokens as `length / 4`
 * (RAGPipelineManager.estimateTokenCount), which is off by ~2x for
 * non-English text (relevant for EU legal) and for code/citations.
 * Context truncation relied on it, so truncation was imprecise and could
 * either overflow the model context or waste budget (PRODUCT_DESIGN.md B6).
 *
 * This module provides a `Tokenizer` interface with two implementations:
 *  - `CharTokenizer`   — the cheap length/4 heuristic, used as a fallback.
 *  - `TransformersTokenizer` — a real model tokenizer loaded via
 *    Transformers.js, used when precision matters (context truncation).
 */
export declare interface Tokenizer {
    count(text: string): Promise<number>;
    /** Truncate to at most maxTokens, preferring a sentence boundary. */
    truncate(text: string, maxTokens: number): Promise<string>;
    dispose?(): Promise<void>;
}

/**
 * Embedding generator using Transformers.js
 * Supports text and image embeddings with WebGPU acceleration and WASM fallback
 */
export declare class TransformersEmbedding implements EmbeddingGenerator {
    private pipeline;
    private config;
    private dimensions;
    private initialized;
    constructor(config: TransformersEmbeddingConfig);
    /**
     * Initialize the embedding pipeline with model loading and caching
     */
    initialize(): Promise<void>;
    /**
     * Load the Transformers.js pipeline with device configuration
     */
    private loadPipeline;
    /**
     * Generate embedding for a single text with mean pooling and normalization
     */
    embed(text: string): Promise<Float32Array>;
    /**
     * Generate embeddings for multiple texts in batch.
     *
     * Uses a single batched pipeline call rather than looping `embed` per
     * text, which leaves significant throughput on the table for bulk ingest
     * (Transformers.js supports batched inference natively). Falls back to
     * sequential generation only if the batched output shape is unexpected.
     */
    embedBatch(texts: string[]): Promise<Float32Array[]>;
    /**
     * Extract an array of Float32Array embeddings from a batched pipeline output.
     * Handles the 2D / nested shapes Transformers.js can return.
     */
    private extractEmbeddingsBatch;
    /**
     * Generate embedding for an image using CLIP models
     */
    embedImage(image: ImageData | Blob): Promise<Float32Array>;
    /**
     * Get the dimensionality of the embeddings
     */
    getDimensions(): number;
    /**
     * Clean up resources
     */
    dispose(): Promise<void>;
    /**
     * Generate embedding with mean pooling and normalization
     */
    private generateEmbedding;
    /**
     * Extract Float32Array from pipeline output
     */
    private extractEmbedding;
    /**
     * Ensure the generator is initialized
     */
    private ensureInitialized;
    /**
     * Sleep utility for retry logic
     */
    private sleep;
}

export declare interface TransformersEmbeddingConfig {
    model: string;
    device?: 'wasm' | 'webgpu';
    cache?: boolean;
    quantized?: boolean;
    maxRetries?: number;
    retryDelay?: number;
}

/**
 * A reranker backed by Transformers.js. The pipeline is loaded on first
 * `rerank()` call. If the model cannot be loaded, `rerank()` returns the
 * candidates unchanged (graceful degradation — reranking is an enhancement,
 * not a hard dependency).
 */
export declare class TransformersReranker implements Reranker {
    private options;
    private pipeline;
    private initError;
    private initializing;
    constructor(options?: RerankerOptions);
    isReady(): boolean;
    private ensureLoaded;
    rerank(query: string, candidates: SearchResult[]): Promise<SearchResult[]>;
    /** Extract a scoring snippet from a search result. */
    private snippet;
    /**
     * Transformers.js text-classification returns either a single object,
     * an array of objects, or a tensor depending on version/input shape.
     * Normalize to an array of { score } aligned with the candidate order.
     */
    private normalizeOutputs;
    private extractScore;
    dispose(): Promise<void>;
}

/**
 * Real tokenizer backed by Transformers.js. Loaded lazily; if loading
 * fails, callers should fall back to CharTokenizer.
 */
export declare class TransformersTokenizer implements Tokenizer {
    private model;
    private tokenizer;
    private initError;
    private initializing;
    constructor(model: string);
    private ensureLoaded;
    count(text: string): Promise<number>;
    truncate(text: string, maxTokens: number): Promise<string>;
    dispose(): Promise<void>;
}

/** Detects and caches runtime capabilities; the Desktop custody panel uses this. */
export declare function useCapabilities(): UseCapabilitiesResult;

export declare interface UseCapabilitiesResult {
    capabilities: Capabilities | null;
    loading: boolean;
}

/**
 * Owns the lifecycle of a VectorDB instance: creates it on mount, disposes on
 * unmount. Exposes `ready` + `error` so UI can render loading/failure states.
 */
export declare function useDomicile(config: UseDomicileConfig): UseDomicileResult;

export declare interface UseDomicileConfig {
    /** A factory that returns an initialized VectorDB, or a ready one. */
    create: () => Promise<VectorDB>;
    /** Auto-dispose on unmount. Default true. */
    autoDispose?: boolean;
}

export declare interface UseDomicileResult {
    db: VectorDB | null;
    ready: boolean;
    error: Error | null;
}

/**
 * Batch-insert documents with live progress. Wraps `insertBatch`, reporting
 * per-document progress so the matter-workspace UI can render a bar.
 */
export declare function useIngestProgress(db: VectorDB | null): UseIngestProgressResult;

export declare interface UseIngestProgressResult {
    progress: IngestProgress;
    ingest: (texts: string[], metadatas?: Record<string, unknown>[]) => Promise<void>;
}

/** Non-streaming RAG query hook. */
export declare function useRag(rag: RAGPipelineManager | null): UseRagResult;

export declare interface UseRagResult {
    answer: string;
    sources: RAGResult['sources'];
    loading: boolean;
    error: Error | null;
    query: (q: string) => void;
}

/**
 * Streaming RAG hook. Accumulates generation chunks into `chunks` and a
 * joined `fullText`; surfaces `retrieval` sources as soon as they arrive.
 */
export declare function useRagStream(rag: RAGPipelineManager | null): UseRagStreamResult;

export declare interface UseRagStreamResult {
    chunks: string[];
    fullText: string;
    streaming: boolean;
    sources: RAGStreamChunk['sources'];
    error: Error | null;
    stream: (q: string) => Promise<void>;
    reset: () => void;
}

/**
 * Imperative search over a VectorDB. Debounced by the caller (each `search`
 * call triggers one query); cancels stale queries via a generation counter.
 */
export declare function useSearch(db: VectorDB | null): UseSearchResult;

export declare interface UseSearchResult {
    results: SearchResult[];
    loading: boolean;
    error: Error | null;
    search: (query: string, k?: number) => void;
}

/**
 * VectorDB - Main API for browser-based vector database operations
 *
 * Provides a complete interface for:
 * - Vector storage with IndexedDB persistence
 * - Similarity search with a WASM index engine
 * - Automatic embedding generation via Transformers.js
 * - Data import/export capabilities
 * - Performance optimizations (caching, batching, lazy loading)
 *
 * Two construction modes:
 *  - `new VectorDB(VectorDBConfig)`     — declarative config (concrete adapters wired internally)
 *  - `new VectorDB(InjectedConfig)`     — dependency injection (adapters supplied by caller / factory)
 *
 * The injection mode is the seam: it lets `createDomicile()` (and power users)
 * swap any adapter — storage, index, embedding — without the facade importing
 * the concrete class. The declarative mode remains for back-compat.
 */
declare class VectorDB {
    private initialized;
    private storage;
    private injectedIndex;
    private embeddingGenerator;
    private performanceOptimizer;
    private config;
    private injected;
    private dimensions;
    constructor(config: VectorDBConfig | InjectedConfig);
    /**
     * Initialize all components: storage, index, and embedding generator
     */
    initialize(): Promise<void>;
    /**
     * Initialize from injected adapters (the seam path).
     */
    private initializeInjected;
    /**
     * Initialize from declarative config (back-compat path; wires concrete adapters internally).
     */
    private initializeDeclarative;
    /**
     * Insert a single document with automatic embedding generation
     *
     * @param data - Document data with optional vector, text, or metadata
     * @returns Document ID
     */
    insert(data: InsertData): Promise<string>;
    /**
     * Insert multiple documents in batch for better performance
     *
     * @param data - Array of document data
     * @returns Array of document IDs
     */
    insertBatch(data: InsertData[]): Promise<string[]>;
    /**
     * Search for similar vectors using text query or vector
     *
     * @param query - Search query with text or vector
     * @returns Array of search results with scores and metadata
     */
    search(query: SearchQuery): Promise<SearchResult[]>;
    /**
     * Delete a document by ID
     *
     * @param id - Document ID
     * @returns True if deleted, false if not found
     */
    delete(id: string): Promise<boolean>;
    /**
     * Update a document's metadata or vector
     *
     * @param id - Document ID
     * @param data - Partial document data to update
     * @returns True if updated, false if not found
     */
    update(id: string, data: Partial<InsertData>): Promise<boolean>;
    /**
     * Clear all documents from the database
     */
    clear(): Promise<void>;
    /**
     * Get the total number of documents in the database
     *
     * @returns Document count
     */
    size(): Promise<number>;
    /**
     * Export the entire database to a portable format
     * Uses progressive loading to handle large datasets
     *
     * @param options - Export options including progress callbacks
     * @returns Export data including vectors, index, and metadata
     */
    export(options?: ExportOptions): Promise<ExportData>;
    /**
     * Fallback async iteration for storage backends that don't implement
     * `stream()`. Bridges the callback-based `ProgressiveLoader.streamProcess`
     * into an async iterator so `exportStream` can yield incrementally on any
     * storage: each record is handed to a pending `next()` via a promise.
     */
    private iterateAllViaProgressiveLoader;
    /**
     * Export database as a streaming generator for very large datasets
     * This prevents loading all data into memory at once
     *
     * @param options - Export options
     * @returns Async generator yielding export chunks
     */
    exportStream(options?: ExportOptions): AsyncGenerator<any, void, unknown>;
    /**
     * Import database from exported data
     * Uses progressive loading for large datasets
     *
     * @param data - Export data to import
     * @param options - Import options including validation and progress callbacks
     */
    import(data: ExportData, options?: ImportOptions): Promise<void>;
    /**
     * Validate export data schema
     */
    private validateExportData;
    /**
     * Validate version compatibility
     */
    private validateVersionCompatibility;
    /**
     * Rebuild index from stored vectors
     */
    private rebuildIndex;
    /**
     * Clean up resources and close connections
     */
    dispose(): Promise<void>;
    /**
     * Get performance statistics
     */
    getPerformanceStats(): any;
    /**
     * Clear all performance caches
     */
    clearCaches(): void;
    /**
     * Prepare vector from insert data (generate from text or validate provided vector)
     */
    private prepareVector;
    /**
     * Ensure models are loaded (for lazy loading)
     */
    private ensureModelsLoaded;
    /**
     * Generate a unique ID for a document
     */
    private generateId;
    private idxAdd;
    private idxAddBatch;
    private idxRemove;
    private idxClear;
    private idxSerialize;
    private idxDeserialize;
    /**
     * Search the index and return results with metadata. IndexHit lacks
     * metadata, so each hit is hydrated from storage.
     */
    private idxSearch;
    /** Metadata filter evaluation for the injected-index hydration path. */
    private recordMatchesFilter;
    private getNested;
    /**
     * Ensure the database is initialized
     */
    private ensureInitialized;
    /**
     * Validate configuration
     */
    private validateConfig;
    /**
     * Clean up all resources
     */
    private cleanup;
}
export { VectorDB as Domicile }
export { VectorDB }

export declare interface VectorDBConfig {
    storage: StorageConfig;
    index: IndexConfig;
    embedding: EmbeddingConfig;
    llm?: LLMConfig;
    performance?: PerformanceConfig_2;
}

/**
 * Error types for VectorDB
 */
export declare class VectorDBError extends Error {
    code: string;
    details?: any | undefined;
    constructor(message: string, code: string, details?: any | undefined);
}

/**
 * Storage layer types
 */
export declare interface VectorRecord {
    id: string;
    vector: Float32Array;
    metadata: Record<string, any>;
    timestamp: number;
}

export declare const VERSION = "0.2.0";

export declare class WebLLMProvider implements LLMProvider {
    private engine;
    private config;
    private initialized;
    private webGPUAvailable;
    constructor(config: WebLLMProviderConfig);
    initialize(): Promise<void>;
    /**
     * Non-throwing capability probe. WebLLM is available iff a functional
     * WebGPU adapter is present. Used by FallbackLLMProvider to decide
     * whether to even attempt initialization.
     */
    isAvailable(): Promise<boolean>;
    private checkWebGPUAvailability;
    generate(prompt: string, options?: GenerateOptions): Promise<string>;
    generateStream(prompt: string, options?: GenerateOptions): AsyncGenerator<string>;
    dispose(): Promise<void>;
    /**
     * Check if the provider is initialized
     */
    isInitialized(): boolean;
    /**
     * Check if WebGPU is available in the current environment
     */
    static isWebGPUAvailable(): Promise<boolean>;
    /**
     * Get model information
     */
    getModelInfo(): {
        model: string;
        initialized: boolean;
        webGPUAvailable: boolean;
    };
    /**
     * Get runtime statistics from the engine
     */
    getRuntimeStats(): Promise<string | null>;
    /**
     * Reset the chat history (useful for multi-turn conversations)
     */
    resetChat(): Promise<void>;
}

export declare interface WebLLMProviderConfig {
    model: string;
    engineConfig?: {
        initProgressCallback?: (progress: {
            progress: number;
            text: string;
        }) => void;
        logLevel?: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';
    };
    chatConfig?: {
        temperature?: number;
        top_p?: number;
        max_tokens?: number;
        frequency_penalty?: number;
        presence_penalty?: number;
    };
}

export declare class WllamaProvider implements LLMProvider {
    private wllama;
    private config;
    private initialized;
    private modelLoaded;
    constructor(config: WllamaProviderConfig);
    initialize(): Promise<void>;
    private loadModel;
    /**
     * Non-throwing capability probe. wllama runs on WASM, so it is available
     * wherever WebAssembly exists — the universal fallback. Model-load
     * availability (network/reachability of the model URL) is not checked
     * here; only runtime capability.
     */
    isAvailable(): Promise<boolean>;
    generate(prompt: string, options?: GenerateOptions): Promise<string>;
    generateStream(prompt: string, options?: GenerateOptions): AsyncGenerator<string>;
    dispose(): Promise<void>;
    /**
     * Check if the provider is initialized
     */
    isInitialized(): boolean;
    /**
     * Get model information
     */
    getModelInfo(): {
        url: string;
        loaded: boolean;
    };
}

export declare interface WllamaProviderConfig {
    modelUrl: string;
    modelConfig?: {
        n_ctx?: number;
        n_batch?: number;
        n_threads?: number;
        embeddings?: boolean;
    };
    progressCallback?: (progress: {
        loaded: number;
        total: number;
    }) => void;
    wasmPaths?: {
        'single-thread/wllama.wasm'?: string;
        'multi-thread/wllama.wasm'?: string;
        'multi-thread/wllama.worker.mjs'?: string;
    };
}

/**
 * Manages a pool of Web Workers for parallel computation
 */
export declare class WorkerPool {
    private workers;
    private availableWorkers;
    private taskQueue;
    private config;
    private workerTasks;
    constructor(config?: WorkerPoolConfig);
    /**
     * Initialize the worker pool
     */
    initialize(workerScript: string): Promise<void>;
    /**
     * Execute a task in the worker pool
     */
    execute<T>(task: WorkerTask): Promise<T>;
    /**
     * Execute multiple tasks in parallel
     */
    executeBatch<T>(tasks: WorkerTask[]): Promise<T[]>;
    /**
     * Get the number of available workers
     */
    getAvailableWorkerCount(): number;
    /**
     * Get the number of pending tasks
     */
    getPendingTaskCount(): number;
    /**
     * Terminate all workers and clean up
     */
    dispose(): void;
    /**
     * Process the task queue
     */
    private processQueue;
    /**
     * Handle message from worker
     */
    private handleWorkerMessage;
    /**
     * Handle worker error
     */
    private handleWorkerError;
}

export declare interface WorkerPoolConfig {
    maxWorkers?: number;
    workerScript?: string;
}

export declare interface WorkerResponse<T = any> {
    success: boolean;
    result?: T;
    error?: string;
}

/**
 * Worker Pool for offloading computation to Web Workers
 * Supports embedding generation, vector search, and other CPU-intensive tasks
 */
export declare interface WorkerTask {
    type: string;
    data: any;
    transferables?: Transferable[];
}

export { }
