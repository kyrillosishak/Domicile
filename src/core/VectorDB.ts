/**
 * Main VectorDB class - entry point for all vector database operations
 */

import { IndexedDBStorage } from '../storage/IndexedDBStorage';
import { HnswIndex } from '../index/HnswIndex';
import { TransformersEmbedding } from '../embedding/TransformersEmbedding';
import { PerformanceOptimizer } from '../performance/PerformanceOptimizer';
import type { VectorDBConfig, InjectedConfig, InsertData, ExportData, ExportOptions, ImportOptions, VectorExport, ExportChunk } from './types';
import type { SearchQuery, SearchResult } from '../index/types';
import type { StorageManager, VectorRecord } from '../storage/types';
import type { EmbeddingGenerator } from '../embedding/types';
import type { Index, IndexHit } from './contracts';
import { VectorDBError, DimensionMismatchError, InputValidator } from '../errors';

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
export class VectorDB {
  private initialized = false;
  private storage: StorageManager | null = null;
  private injectedIndex: Index | null = null;
  private embeddingGenerator: EmbeddingGenerator | null = null;
  private performanceOptimizer: PerformanceOptimizer;
  private config: VectorDBConfig | null;
  private injected: InjectedConfig | null;
  private dimensions: number;

  constructor(config: VectorDBConfig | InjectedConfig) {
    if (isInjectedConfig(config)) {
      this.injected = config;
      this.config = null;
      this.dimensions = config.dimensions;
      this.performanceOptimizer = new PerformanceOptimizer(config.performance);
      this.embeddingGenerator = config.embedding ?? null;
      this.injectedIndex = config.index;
    } else {
      this.validateConfig(config);
      this.config = config;
      this.injected = null;
      this.dimensions = config.index.dimensions;
      this.performanceOptimizer = new PerformanceOptimizer(config.performance);
    }
  }

  /**
   * Initialize all components: storage, index, and embedding generator
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      if (this.injected) {
        await this.initializeInjected();
      } else {
        await this.initializeDeclarative();
      }
      this.initialized = true;
    } catch (error) {
      // Clean up on initialization failure
      await this.cleanup();
      throw new VectorDBError(
        'Failed to initialize VectorDB',
        'INIT_ERROR',
        { error }
      );
    }
  }

  /**
   * Initialize from injected adapters (the seam path).
   */
  private async initializeInjected(): Promise<void> {
    const injected = this.injected!;

    // Storage is injected directly.
    if ('initialize' in injected.storage) {
      await (injected.storage as StorageManager).initialize?.();
    }
    this.storage = injected.storage;

    await this.performanceOptimizer.initialize(this.storage);

    // Index is injected (implements the Index contract).
    await injected.index.initialize();
    this.injectedIndex = injected.index;
    this.performanceOptimizer.markIndexLoaded();

    // Embedding optional + lazy.
    if (injected.embedding) {
      this.embeddingGenerator = injected.embedding;
      if (this.embeddingGenerator && this.performanceOptimizer) {
        // Treat as already-initialized by the factory unless explicitly lazy.
      }
    }

    if (this.embeddingGenerator && this.performanceOptimizer.areModelsLoaded?.()) {
      const embeddingDimensions = this.embeddingGenerator.getDimensions();
      if (embeddingDimensions !== this.dimensions) {
        throw new DimensionMismatchError(this.dimensions, embeddingDimensions);
      }
    }
  }

  /**
   * Initialize from declarative config (back-compat path; wires concrete adapters internally).
   */
  private async initializeDeclarative(): Promise<void> {
    const config = this.config!;

    // Initialize storage
    const storage = new IndexedDBStorage(config.storage);
    await storage.initialize();
    this.storage = storage;

    // Initialize performance optimizer with storage
    await this.performanceOptimizer.initialize(this.storage);

    // Initialize the HNSW index (pure-TS; real scores, non-rebuilding delete).
    this.injectedIndex = new HnswIndex({
      dimensions: config.index.dimensions,
      metric: config.index.metric,
    });
    await this.injectedIndex.initialize();
    this.performanceOptimizer.markIndexLoaded();

    // Initialize embedding generator with lazy loading support
    if (config.performance?.lazyLoadModels) {
      // Models will be loaded on first use
      console.debug('Model lazy loading enabled');
      this.embeddingGenerator = new TransformersEmbedding({
        model: config.embedding.model,
        device: config.embedding.device,
        cache: config.embedding.cache ?? true,
      });
    } else {
      this.embeddingGenerator = new TransformersEmbedding({
        model: config.embedding.model,
        device: config.embedding.device,
        cache: config.embedding.cache ?? true,
      });
      await this.embeddingGenerator.initialize();
      this.performanceOptimizer.markModelsLoaded();
    }

    // Verify dimensions match (if models are loaded)
    if (this.performanceOptimizer.areModelsLoaded()) {
      const embeddingDimensions = this.embeddingGenerator!.getDimensions();
      if (embeddingDimensions !== config.index.dimensions) {
        throw new DimensionMismatchError(
          config.index.dimensions,
          embeddingDimensions
        );
      }
    }
  }

  /**
   * Insert a single document with automatic embedding generation
   * 
   * @param data - Document data with optional vector, text, or metadata
   * @returns Document ID
   */
  async insert(data: InsertData): Promise<string> {
    this.ensureInitialized();

    try {
      // Validate and sanitize metadata
      const sanitizedMetadata = InputValidator.validateAndSanitizeMetadata(data.metadata);

      // Generate or validate vector
      const vector = await this.prepareVector(data);

      // Create vector record
      const id = this.generateId();
      const record: VectorRecord = {
        id,
        vector,
        metadata: {
          ...sanitizedMetadata,
          content: data.text,
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      };

      // Use batch optimizer if available for better performance
      if (this.performanceOptimizer.batchOptimizer) {
        await this.performanceOptimizer.batchOptimizer.put(record);
      } else {
        await this.storage!.put(record);
      }

      // Add to cache
      const size = record.vector.byteLength + JSON.stringify(record.metadata).length * 2 + 100;
      this.performanceOptimizer.vectorCache.set(id, record, size);

      // Add to index
      await this.idxAdd(record);

      return id;
    } catch (error) {
      if (error instanceof VectorDBError) {
        throw error;
      }
      throw new VectorDBError(
        'Failed to insert document',
        'INSERT_ERROR',
        { error, data }
      );
    }
  }

  /**
   * Insert multiple documents in batch for better performance
   * 
   * @param data - Array of document data
   * @returns Array of document IDs
   */
  async insertBatch(data: InsertData[]): Promise<string[]> {
    this.ensureInitialized();

    if (data.length === 0) {
      return [];
    }

    try {
      const records: VectorRecord[] = [];
      const ids: string[] = [];

      // Prepare all vectors
      for (const item of data) {
        // Validate and sanitize metadata
        const sanitizedMetadata = InputValidator.validateAndSanitizeMetadata(item.metadata);
        
        const vector = await this.prepareVector(item);
        const id = this.generateId();
        
        const record: VectorRecord = {
          id,
          vector,
          metadata: {
            ...sanitizedMetadata,
            content: item.text,
            timestamp: Date.now(),
          },
          timestamp: Date.now(),
        };
        
        records.push(record);
        ids.push(id);
        
        // Add to cache
        const size = record.vector.byteLength + JSON.stringify(record.metadata).length * 2 + 100;
        this.performanceOptimizer.vectorCache.set(id, record, size);
      }

      // Batch store in IndexedDB (already optimized)
      await this.storage!.putBatch(records);

      // Batch add to index
      await this.idxAddBatch(records);

      return ids;
    } catch (error) {
      if (error instanceof VectorDBError) {
        throw error;
      }
      throw new VectorDBError(
        'Failed to insert document batch',
        'INSERT_BATCH_ERROR',
        { error, count: data.length }
      );
    }
  }

  /**
   * Search for similar vectors using text query or vector
   * 
   * @param query - Search query with text or vector
   * @returns Array of search results with scores and metadata
   */
  async search(query: SearchQuery): Promise<SearchResult[]> {
    this.ensureInitialized();

    try {
      // Validate search parameters
      InputValidator.validateSearchQuery(query.k);

      // Get query vector
      let queryVector: Float32Array;

      if (query.vector) {
        // Use provided vector
        queryVector = query.vector;
      } else if (query.text) {
        // Check embedding cache first
        const cached = this.performanceOptimizer.getCachedEmbedding(query.text);
        if (cached) {
          queryVector = cached;
        } else {
          // Ensure models are loaded
          await this.ensureModelsLoaded();
          
          // Generate embedding from text
          queryVector = await this.embeddingGenerator!.embed(query.text);
          
          // Cache the embedding
          this.performanceOptimizer.cacheEmbedding(query.text, queryVector);
        }
      } else {
        throw new VectorDBError(
          'Search query must include either vector or text',
          'INVALID_QUERY',
          { query }
        );
      }

      // Validate query vector
      InputValidator.validateVector(queryVector, this.dimensions);

      // Perform search
      const results = await this.idxSearch(
        queryVector,
        query.k,
        query.filter
      );

      // Include vectors if requested (use cache)
      if (query.includeVectors) {
        for (const result of results) {
          const record = await this.performanceOptimizer.getVector(result.id, this.storage!);
          if (record) {
            result.vector = record.vector;
          }
        }
      }

      return results;
    } catch (error) {
      if (error instanceof VectorDBError) {
        throw error;
      }
      throw new VectorDBError(
        'Failed to search vectors',
        'SEARCH_ERROR',
        { error, query }
      );
    }
  }

  /**
   * Delete a document by ID
   * 
   * @param id - Document ID
   * @returns True if deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    this.ensureInitialized();

    try {
      // Use batch optimizer if available
      let deleted: boolean;
      if (this.performanceOptimizer.batchOptimizer) {
        deleted = await this.performanceOptimizer.batchOptimizer.delete(id);
      } else {
        deleted = await this.storage!.delete(id);
      }

      if (deleted) {
        // Remove from cache
        this.performanceOptimizer.vectorCache.delete(id);
        
        // Remove from index
        await this.idxRemove(id);
      }

      return deleted;
    } catch (error) {
      throw new VectorDBError(
        'Failed to delete document',
        'DELETE_ERROR',
        { error, id }
      );
    }
  }

  /**
   * Update a document's metadata or vector
   * 
   * @param id - Document ID
   * @param data - Partial document data to update
   * @returns True if updated, false if not found
   */
  async update(id: string, data: Partial<InsertData>): Promise<boolean> {
    this.ensureInitialized();

    try {
      // Get existing record
      const existing = await this.storage!.get(id);
      if (!existing) {
        return false;
      }

      // Validate and sanitize metadata if provided
      const sanitizedMetadata = data.metadata 
        ? InputValidator.validateAndSanitizeMetadata(data.metadata)
        : {};

      // Prepare updated vector if needed
      let vector = existing.vector;
      if (data.vector || data.text) {
        vector = await this.prepareVector(data);
      }

      // Create updated record
      const updated: VectorRecord = {
        id,
        vector,
        metadata: {
          ...existing.metadata,
          ...sanitizedMetadata,
          content: data.text ?? existing.metadata.content,
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      };

      // Update storage
      await this.storage!.put(updated);

      // Update index (remove old, add new)
      await this.idxRemove(id);
      await this.idxAdd(updated);

      return true;
    } catch (error) {
      if (error instanceof VectorDBError) {
        throw error;
      }
      throw new VectorDBError(
        'Failed to update document',
        'UPDATE_ERROR',
        { error, id }
      );
    }
  }

  /**
   * Clear all documents from the database
   */
  async clear(): Promise<void> {
    this.ensureInitialized();

    try {
      // Flush any pending batch operations
      if (this.performanceOptimizer.batchOptimizer) {
        await this.performanceOptimizer.batchOptimizer.flush();
      }
      
      await this.storage!.clear();
      await this.idxClear();
      
      // Clear caches
      this.performanceOptimizer.clearCaches();
    } catch (error) {
      throw new VectorDBError(
        'Failed to clear database',
        'CLEAR_ERROR',
        { error }
      );
    }
  }

  /**
   * Get the total number of documents in the database
   * 
   * @returns Document count
   */
  async size(): Promise<number> {
    this.ensureInitialized();

    try {
      return await this.storage!.count();
    } catch (error) {
      throw new VectorDBError(
        'Failed to get database size',
        'SIZE_ERROR',
        { error }
      );
    }
  }

  /**
   * Export the entire database to a portable format
   * Uses progressive loading to handle large datasets
   * 
   * @param options - Export options including progress callbacks
   * @returns Export data including vectors, index, and metadata
   */
  async export(options: ExportOptions = {}): Promise<ExportData> {
    this.ensureInitialized();

    const {
      includeIndex = true,
      onProgress,
    } = options;

    try {
      // Flush any pending batch operations
      if (this.performanceOptimizer.batchOptimizer) {
        await this.performanceOptimizer.batchOptimizer.flush();
      }

      const count = await this.storage!.count();
      const allRecords: VectorRecord[] = [];
      let loaded = 0;

      // Use progressive loader for large datasets with progress tracking
      await this.performanceOptimizer.progressiveLoader.streamProcess(
        this.storage!,
        async (record) => {
          allRecords.push(record);
          loaded++;
          
          if (onProgress && loaded % 100 === 0) {
            onProgress(loaded, count);
          }
        }
      );

      // Final progress update
      if (onProgress) {
        onProgress(count, count);
      }

      // Serialize index if requested
      let serializedIndex = '';
      if (includeIndex) {
        serializedIndex = await this.idxSerialize();
      }

      // Create export data
      const cfg = this.config!;
      const exportData: ExportData = {
        version: '1.0.0',
        config: {
          ...cfg,
          // Don't export sensitive or runtime-specific config
          storage: {
            dbName: cfg.storage.dbName,
            version: cfg.storage.version,
          },
        },
        vectors: allRecords.map(r => ({
          id: r.id,
          vector: Array.from(r.vector),
          metadata: r.metadata,
          timestamp: r.timestamp,
        })),
        index: serializedIndex,
        metadata: {
          exportedAt: Date.now(),
          vectorCount: count,
          dimensions: this.dimensions,
        },
      };

      return exportData;
    } catch (error) {
      throw new VectorDBError(
        'Failed to export database',
        'EXPORT_ERROR',
        { error }
      );
    }
  }

  /**
   * Fallback async iteration for storage backends that don't implement
   * `stream()`. Bridges the callback-based `ProgressiveLoader.streamProcess`
   * into an async iterator so `exportStream` can yield incrementally on any
   * storage: each record is handed to a pending `next()` via a promise.
   */
  private async *iterateAllViaProgressiveLoader(): AsyncGenerator<VectorRecord, void, unknown> {
    let resolveNext: ((r: IteratorResult<VectorRecord>) => void) | null = null;
    let failure: unknown = null;

    const settle = (r: IteratorResult<VectorRecord>): void => {
      if (resolveNext) {
        const fn = resolveNext;
        resolveNext = null;
        fn(r);
      }
    };

    this.performanceOptimizer.progressiveLoader
      .streamProcess(this.storage!, async (record) => {
        settle({ value: record, done: false });
      })
      .then(() => {
        settle({ value: undefined, done: true });
      })
      .catch((err) => {
        failure = err;
        settle({ value: undefined, done: true });
      });

    while (true) {
      const r = await new Promise<IteratorResult<VectorRecord>>((resolve) => {
        resolveNext = resolve;
      });
      if (r.done) {
        if (failure) throw failure;
        return;
      }
      yield r.value;
    }
  }

  /**
   * Export database as a streaming generator for very large datasets
   * This prevents loading all data into memory at once
   *
   * @param options - Export options
   * @returns Async generator yielding export chunks
   */
  async *exportStream(options: ExportOptions = {}): AsyncGenerator<ExportChunk, void, unknown> {
    this.ensureInitialized();

    const {
      includeIndex = true,
      onProgress,
    } = options;

    try {
      // Flush any pending batch operations
      if (this.performanceOptimizer.batchOptimizer) {
        await this.performanceOptimizer.batchOptimizer.flush();
      }

      const count = await this.storage!.count();

      // Yield metadata first
      yield {
        type: 'metadata',
        data: {
          version: '1.0.0',
          config: {
            ...this.config!,
            storage: {
              dbName: this.config!.storage.dbName,
              version: this.config!.storage.version,
            },
          },
          metadata: {
            exportedAt: Date.now(),
            vectorCount: count,
            dimensions: this.dimensions,
          },
        },
      };

      // Stream vectors in chunks, yielding each batch as the cursor advances.
      // The previous implementation pushed every record into one array and
      // yielded only at the end — the comment "We can't yield from inside the
      // callback" described the symptom. Consuming `storage.stream()` (a true
      // cursor-backed async iterator) directly lets us yield incrementally, so
      // peak memory stays bounded to one chunk regardless of corpus size.
      const chunkSize = this.config!.performance?.chunkSize || 100;
      const supportsStream = typeof this.storage!.stream === 'function';
      const iter: AsyncIterable<VectorRecord> = supportsStream
        ? this.storage!.stream!()
        : this.iterateAllViaProgressiveLoader();

      let loaded = 0;
      let chunk: VectorExport[] = [];
      for await (const record of iter) {
        chunk.push({
          id: record.id,
          vector: Array.from(record.vector),
          metadata: record.metadata,
          timestamp: record.timestamp,
        });

        loaded++;

        if (chunk.length >= chunkSize) {
          yield { type: 'vectors', data: chunk };
          chunk = [];
          if (onProgress) {
            onProgress(loaded, count);
          }
        }
      }

      // Yield remaining vectors
      if (chunk.length > 0) {
        yield {
          type: 'vectors',
          data: chunk,
        };
      }

      if (onProgress) {
        onProgress(count, count);
      }

      // Yield index if requested
      if (includeIndex) {
        const serializedIndex = await this.idxSerialize();
        yield {
          type: 'index',
          data: serializedIndex,
        };
      }
    } catch (error) {
      throw new VectorDBError(
        'Failed to export database stream',
        'EXPORT_STREAM_ERROR',
        { error }
      );
    }
  }

  /**
   * Import database from exported data
   * Uses progressive loading for large datasets
   * 
   * @param data - Export data to import
   * @param options - Import options including validation and progress callbacks
   */
  async import(data: ExportData, options: ImportOptions = {}): Promise<void> {
    this.ensureInitialized();

    const {
      validateSchema = true,
      onProgress,
      clearExisting = true,
    } = options;

    try {
      // Validate export data schema
      if (validateSchema) {
        this.validateExportData(data);
      }

      // Validate version compatibility
      this.validateVersionCompatibility(data.version);

      // Validate dimensions match
      if (data.metadata.dimensions !== this.dimensions) {
        throw new DimensionMismatchError(
          this.dimensions,
          data.metadata.dimensions
        );
      }

      // Validate vector count matches
      if (data.vectors.length !== data.metadata.vectorCount) {
        throw new VectorDBError(
          'Vector count mismatch in export data',
          'INVALID_EXPORT_DATA',
          {
            expected: data.metadata.vectorCount,
            actual: data.vectors.length,
          }
        );
      }

      // Clear existing data and caches if requested
      if (clearExisting) {
        await this.clear();
      }

      // Convert vectors back to VectorRecord format with validation
      const records: VectorRecord[] = [];
      for (let i = 0; i < data.vectors.length; i++) {
        const v = data.vectors[i];
        
        // Validate each vector record
        if (!v.id || !v.vector || !v.metadata) {
          throw new VectorDBError(
            'Invalid vector record in export data',
            'INVALID_VECTOR_RECORD',
            { index: i, record: v }
          );
        }

        // Validate vector dimensions
        if (v.vector.length !== this.dimensions) {
          throw new DimensionMismatchError(
            this.dimensions,
            v.vector.length
          );
        }

        records.push({
          id: v.id,
          vector: new Float32Array(v.vector),
          metadata: v.metadata,
          timestamp: v.timestamp || Date.now(),
        });
      }

      // Use progressive loader for import with progress tracking
      await this.performanceOptimizer.progressiveLoader.importInBatches(
        this.storage!,
        records,
        (loaded, total) => {
          if (onProgress) {
            onProgress(loaded, total);
          }
        }
      );

      // Deserialize and restore index if available
      if (data.index) {
        try {
          await this.idxDeserialize(data.index);
        } catch (error) {
          // If index deserialization fails, rebuild from vectors
          console.warn('Failed to deserialize index, rebuilding from vectors...', error);
          await this.rebuildIndex();
        }
      } else {
        // No index in export data, rebuild from vectors
        await this.rebuildIndex();
      }

      // Final progress update
      if (onProgress) {
        onProgress(records.length, records.length);
      }

    } catch (error) {
      if (error instanceof VectorDBError) {
        throw error;
      }
      throw new VectorDBError(
        'Failed to import database',
        'IMPORT_ERROR',
        { error }
      );
    }
  }

  /**
   * Validate export data schema
   */
  private validateExportData(data: ExportData): void {
    if (!data.version) {
      throw new VectorDBError(
        'Export data missing version',
        'INVALID_EXPORT_DATA',
        { data }
      );
    }

    if (!data.vectors || !Array.isArray(data.vectors)) {
      throw new VectorDBError(
        'Export data missing or invalid vectors array',
        'INVALID_EXPORT_DATA',
        { data }
      );
    }

    if (!data.metadata) {
      throw new VectorDBError(
        'Export data missing metadata',
        'INVALID_EXPORT_DATA',
        { data }
      );
    }

    if (typeof data.metadata.dimensions !== 'number' || data.metadata.dimensions <= 0) {
      throw new VectorDBError(
        'Export data has invalid dimensions',
        'INVALID_EXPORT_DATA',
        { dimensions: data.metadata.dimensions }
      );
    }

    if (typeof data.metadata.vectorCount !== 'number' || data.metadata.vectorCount < 0) {
      throw new VectorDBError(
        'Export data has invalid vector count',
        'INVALID_EXPORT_DATA',
        { vectorCount: data.metadata.vectorCount }
      );
    }
  }

  /**
   * Validate version compatibility
   */
  private validateVersionCompatibility(version: string): void {
    // Parse version string (e.g., "1.0.0")
    const parts = version.split('.');
    if (parts.length < 2) {
      throw new VectorDBError(
        'Invalid version format',
        'INVALID_VERSION',
        { version }
      );
    }

    const major = parseInt(parts[0], 10);
    const minor = parseInt(parts[1], 10);

    // Current version is 1.0.0
    const currentMajor = 1;
    const currentMinor = 0;

    // Check major version compatibility
    if (major !== currentMajor) {
      throw new VectorDBError(
        'Incompatible export data version (major version mismatch)',
        'VERSION_INCOMPATIBLE',
        {
          exportVersion: version,
          currentVersion: '1.0.0',
          message: 'Major version mismatch. Data may not be compatible.',
        }
      );
    }

    // Warn about minor version differences
    if (minor > currentMinor) {
      console.warn(
        `Export data is from a newer version (${version}). Some features may not be supported.`
      );
    }
  }

  /**
   * Rebuild index from stored vectors
   */
  private async rebuildIndex(): Promise<void> {
    const allRecords = await this.storage!.getAll();
    await this.idxClear();

    if (allRecords.length > 0) {
      await this.idxAddBatch(allRecords);
    }
  }

  /**
   * Clean up resources and close connections
   */
  async dispose(): Promise<void> {
    await this.cleanup();
    await this.performanceOptimizer.dispose();
    this.initialized = false;
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats(): any {
    return this.performanceOptimizer.getStats();
  }

  /**
   * Clear all performance caches
   */
  clearCaches(): void {
    this.performanceOptimizer.clearCaches();
  }

  /**
   * Prepare vector from insert data (generate from text or validate provided vector)
   */
  private async prepareVector(data: InsertData): Promise<Float32Array> {
    if (data.vector) {
      // Validate provided vector
      InputValidator.validateVector(data.vector, this.dimensions);
      return data.vector;
    } else if (data.text) {
      // Check embedding cache first
      const cached = this.performanceOptimizer.getCachedEmbedding(data.text);
      if (cached) {
        return cached;
      }
      
      // Ensure models are loaded
      await this.ensureModelsLoaded();
      
      // Generate embedding from text
      const vector = await this.embeddingGenerator!.embed(data.text);
      
      // Validate generated vector
      InputValidator.validateVector(vector, this.dimensions);
      
      // Cache the embedding
      this.performanceOptimizer.cacheEmbedding(data.text, vector);
      
      return vector;
    } else {
      throw new VectorDBError(
        'Insert data must include either vector or text',
        'INVALID_INSERT_DATA',
        { data }
      );
    }
  }

  /**
   * Ensure models are loaded (for lazy loading)
   */
  private async ensureModelsLoaded(): Promise<void> {
    if (!this.performanceOptimizer.areModelsLoaded()) {
      await this.embeddingGenerator!.initialize();
      this.performanceOptimizer.markModelsLoaded();
      
      // Verify dimensions match
      const embeddingDimensions = this.embeddingGenerator!.getDimensions();
      if (embeddingDimensions !== this.dimensions) {
        throw new DimensionMismatchError(
          this.dimensions,
          embeddingDimensions
        );
      }
    }
  }

  /**
   * Generate a unique ID for a document
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  // ---------------------------------------------------------------------
  // Index dispatch helpers.
  //
  // The facade talks to the index through these helpers. The index always
  // implements the Index contract (HnswIndex, whether injected by the
  // factory or wired by the declarative path). IndexHit[] carries id +
  // score only, so metadata is hydrated from storage.
  // ---------------------------------------------------------------------

  private async idxAdd(record: VectorRecord): Promise<void> {
    await this.injectedIndex!.add(record);
  }

  private async idxAddBatch(records: VectorRecord[]): Promise<void> {
    await this.injectedIndex!.addBatch(records);
  }

  private async idxRemove(id: string): Promise<void> {
    await this.injectedIndex!.remove(id);
  }

  private async idxClear(): Promise<void> {
    await this.injectedIndex!.clear();
  }

  private async idxSerialize(): Promise<string> {
    const serialized = await this.injectedIndex!.serialize();
    return JSON.stringify(serialized);
  }

  private async idxDeserialize(data: string): Promise<void> {
    try {
      const parsed = JSON.parse(data);
      await this.injectedIndex!.deserialize(parsed);
    } catch (error) {
      throw new VectorDBError('Failed to deserialize index', 'INDEX_DESERIALIZE_ERROR', { error });
    }
  }

  /**
   * Search the index and return results with metadata. IndexHit lacks
   * metadata, so each hit is hydrated from storage.
   */
  private async idxSearch(query: Float32Array, k: number, filter?: import('../storage/types').Filter): Promise<SearchResult[]> {
    const hits: IndexHit[] = await this.injectedIndex!.search(query, k, filter);
    const results: SearchResult[] = [];
    for (const hit of hits) {
      const record = await this.storage!.get(hit.id);
      if (!record) continue;
      if (filter && !this.recordMatchesFilter(record, filter)) continue;
      results.push({ id: hit.id, score: hit.score, metadata: record.metadata });
      if (results.length >= k) break;
    }
    return results;
  }

  /** Metadata filter evaluation for the injected-index hydration path. */
  private recordMatchesFilter(record: VectorRecord, filter: import('../storage/types').Filter): boolean {
    // Delegate to the storage layer's filter semantics by reusing the
    // IndexedDBStorage evaluator would be ideal, but to avoid a circular
    // import we implement a minimal evaluator here matching the operators
    // supported by MetadataFilter.
    const f = filter as any;
    if (f.operator === 'and' || f.operator === 'or') {
      const sub = f.filters as import('../storage/types').Filter[];
      if (!sub || sub.length === 0) return true;
      return f.operator === 'and'
        ? sub.every((s) => this.recordMatchesFilter(record, s))
        : sub.some((s) => this.recordMatchesFilter(record, s));
    }
    const value = this.getNested(record.metadata, f.field as string);
    if (value === undefined) return false;
    switch (f.operator) {
      case 'eq': return value === f.value;
      case 'ne': return value !== f.value;
      case 'gt': return value > f.value;
      case 'gte': return value >= f.value;
      case 'lt': return value < f.value;
      case 'lte': return value <= f.value;
      case 'in': return Array.isArray(f.value) && f.value.includes(value);
      case 'contains':
        if (Array.isArray(value)) return value.includes(f.value);
        if (typeof value === 'string') return value.includes(f.value);
        return false;
      default: return false;
    }
  }

  private getNested(obj: any, path: string): any {
    const parts = path.split('.');
    let cur = obj;
    for (const p of parts) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[p];
    }
    return cur;
  }

  /**
   * Ensure the database is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new VectorDBError(
        'VectorDB not initialized. Call initialize() first.',
        'NOT_INITIALIZED'
      );
    }
  }

  /**
   * Validate configuration
   */
  private validateConfig(config: VectorDBConfig): void {
    if (!config.storage?.dbName) {
      throw new VectorDBError(
        'Storage configuration must include dbName',
        'INVALID_CONFIG',
        { config }
      );
    }

    if (!config.index?.dimensions || config.index.dimensions <= 0) {
      throw new VectorDBError(
        'Index configuration must include valid dimensions',
        'INVALID_CONFIG',
        { config }
      );
    }

    if (!config.embedding?.model) {
      throw new VectorDBError(
        'Embedding configuration must include model',
        'INVALID_CONFIG',
        { config }
      );
    }
  }

  /**
   * Clean up all resources
   */
  private async cleanup(): Promise<void> {
    try {
      if (this.embeddingGenerator) {
        await this.embeddingGenerator.dispose();
        this.embeddingGenerator = null;
      }

      if (this.storage && 'close' in this.storage) {
        await (this.storage as IndexedDBStorage).close();
        this.storage = null;
      }

      this.injectedIndex = null;
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }
}

/**
 * Type guard distinguishing injected config (has an `index` object instance)
 * from declarative config (has an `index: { dimensions, metric }` literal).
 */
function isInjectedConfig(config: VectorDBConfig | InjectedConfig): config is InjectedConfig {
  return (
    !!config &&
    typeof (config as any).dimensions === 'number' &&
    typeof (config as InjectedConfig).index === 'object' &&
    typeof (config as InjectedConfig).index?.initialize === 'function' &&
    typeof (config as InjectedConfig).storage?.put === 'function'
  );
}
