/**
 * Core configuration types for VectorDB
 */

export interface StorageConfig {
  dbName: string;
  version?: number;
  maxVectors?: number;
}

export interface IndexConfig {
  indexType: 'hnsw';
  dimensions: number;
  metric: 'cosine' | 'euclidean' | 'dot';
  parameters?: Record<string, any>;
}

export interface EmbeddingConfig {
  model: string;
  device: 'wasm' | 'webgpu';
  cache?: boolean;
}

export interface LLMConfig {
  provider: 'wllama' | 'webllm';
  model: string;
  options?: Record<string, any>;
}

export interface PerformanceConfig {
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

export interface VectorDBConfig {
  storage: StorageConfig;
  index: IndexConfig;
  embedding: EmbeddingConfig;
  llm?: LLMConfig;
  performance?: PerformanceConfig;
}

/**
 * Injection-based config. When provided, the facade uses these instances
 * directly instead of instantiating concrete adapters — the seam that makes
 * every runtime component swappable. `createDomicile()` wires the defaults.
 */
export interface InjectedConfig {
  storage: import('../storage/types').StorageManager;
  embedding?: import('../embedding/types').EmbeddingGenerator;
  index: import('./contracts').Index;
  performance?: PerformanceConfig;
  dimensions: number;
  metric?: 'cosine' | 'euclidean' | 'dot';
}

export interface InsertData {
  vector?: Float32Array;
  text?: string;
  metadata?: Record<string, any>;
}

export interface ExportData {
  version: string;
  config: VectorDBConfig;
  vectors: VectorExport[];
  index: string;
  metadata: {
    exportedAt: number;
    vectorCount: number;
    dimensions: number;
  };
}

export interface VectorExport {
  id: string;
  vector: number[];
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface ExportOptions {
  includeIndex?: boolean;
  format?: 'json' | 'binary';
  onProgress?: (loaded: number, total: number) => void;
}

export interface ImportOptions {
  validateSchema?: boolean;
  onProgress?: (loaded: number, total: number) => void;
  clearExisting?: boolean;
}

export interface ExportStreamChunk {
  type: 'metadata';
  data: {
    version: string;
    config: VectorDBConfig;
    metadata: { exportedAt: number; vectorCount: number; dimensions: number };
  };
}

export interface ExportVectorsChunk {
  type: 'vectors';
  data: VectorExport[];
}

export interface ExportIndexChunk {
  type: 'index';
  data: string;
}

export type ExportChunk = ExportStreamChunk | ExportVectorsChunk | ExportIndexChunk;
