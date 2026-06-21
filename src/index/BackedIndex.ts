/**
 * BackedIndex — the seam between the public IndexManager and any ANN implementation.
 *
 * Two stable contracts:
 *  - numeric labels ↔ stable string ids (the label is internal, the id is external)
 *  - serialize()/load() round-trip a 2.x binary blob (header + body)
 *
 * The label map lives in `indexes.BackedIndex` instance, NOT in the ANN: this
 * lets us swap HNSW for BruteForceSearch without losing id mapping.
 */

export type MetricName = 'cosine' | 'l2' | 'ip';
export type BackendName = 'hnsw' | 'brute';

export interface BackedIndexConfig {
  dimensions: number;
  metric: MetricName;
  /** initial max capacity; index grows automatically past this */
  maxElements?: number;
  /** HNSW parameters; ignored by BruteForceBackedIndex */
  m?: number;
  efConstruction?: number;
  efSearch?: number;
  /** when true, use BruteForce if total records ≤ this threshold */
  bruteForceThreshold?: number;
}

export interface BackedIndexStats {
  backend: BackendName;
  dimensions: number;
  metric: MetricName;
  live: number;
  tombstoned: number;
  maxElements: number;
}

export interface SearchHit {
  id: string;
  /** similarity score (higher is better) */
  score: number;
}

export interface BackedIndex {
  readonly backend: BackendName;
  readonly dimensions: number;
  init(): Promise<void>;
  /**
   * Insert/replace by stable id.  Returns the assigned numeric label.
   * Same id replaces prior vector AND clears any tombstone.
   */
  upsert(id: string, vector: Float32Array): Promise<number>;
  upsertBatch(items: Array<{ id: string; vector: Float32Array }>): Promise<void>;
  /**
   * Mark id deleted.  O(1).  Idempotent.  Call compact() to reclaim labels.
   */
  remove(id: string): Promise<boolean>;
  has(id: string): Promise<boolean>;
  size(): number;
  getIdByLabel(label: number): string | null;
  search(query: Float32Array, k: number): Promise<SearchHit[]>;
  /**
   * Run the compaction sweep (build a fresh graph from live items).
   * Cheap no-op if there are no tombstones.
   */
  compact(): Promise<void>;
  serialize(): Promise<Uint8Array>;
  load(blob: Uint8Array): Promise<void>;
  close(): Promise<void>;
  stats(): BackedIndexStats;
}
