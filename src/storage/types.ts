/**
 * Storage layer types
 */

export interface VectorRecord {
  id: string;
  vector: Float32Array;
  metadata: Record<string, any>;
  timestamp: number;
}

export interface MetadataFilter {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';
  value: any;
}

export interface CompoundFilter {
  operator: 'and' | 'or';
  filters: (MetadataFilter | CompoundFilter)[];
}

export type Filter = MetadataFilter | CompoundFilter;

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
