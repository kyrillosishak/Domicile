/**
 * Core seam contracts.
 *
 * These interfaces are the stable boundaries between Domicile's layers.
 * The facade (`VectorDB` / `Domicile`) is constructed from injected
 * implementations of these interfaces — it never imports a concrete
 * adapter. That is what makes every runtime component swappable
 * (Voy → hnsw, WebLLM → wllama → fallback) without touching the
 * residency boundary or the RAG pipeline.
 *
 * Zero runtime dependencies. Types only.
 */

import type { Filter, VectorRecord } from '../storage/types';

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export interface StorageManager {
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

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

export interface IndexHit {
  id: string;
  /** Real similarity score. NEVER a placeholder. Adapters must not hardcode this. */
  score: number;
}

export interface IndexStats {
  vectorCount: number;
  dimensions: number;
  indexType: string;
  memoryUsage: number;
  lastUpdated: number;
}

export interface SerializedIndex {
  version: string;
  dimensions: number;
  metric: string;
  vectorCount: number;
  /** Engine-specific serialized blob. */
  data: string;
}

export interface Index {
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
  stats(): IndexStats;
}

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

export interface EmbeddingGenerator {
  initialize(): Promise<void>;
  embed(text: string): Promise<Float32Array>;
  /** MUST be a true batched call, not a sequential loop over `embed`. */
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  embedImage?(image: ImageData | Blob): Promise<Float32Array>;
  getDimensions(): number;
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// LLM
// ---------------------------------------------------------------------------

export interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
}

export interface LLMProvider {
  initialize(): Promise<void>;
  generate(prompt: string, options?: GenerateOptions): Promise<string>;
  generateStream(prompt: string, options?: GenerateOptions): AsyncGenerator<string>;
  /**
   * Non-throwing capability probe. Returns true if this provider can run
   * in the current environment (e.g. WebGPU present for WebLLM). Used by
   * FallbackLLMProvider to cascade without try/catching a thrown init.
   */
  isAvailable(): Promise<boolean>;
  dispose(): Promise<void>;
}
