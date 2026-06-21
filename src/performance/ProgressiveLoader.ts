/**
 * Progressive Loader for handling large datasets
 * Loads data in chunks to avoid memory exhaustion
 */

import type { VectorRecord, StorageManager } from '../storage/types';

export interface ProgressiveLoaderConfig {
  chunkSize: number;
  onProgress?: (loaded: number, total: number) => void;
  onChunk?: (chunk: VectorRecord[]) => Promise<void>;
}

export interface LoadProgress {
  loaded: number;
  total: number;
  percent: number;
}

/**
 * Loads large datasets progressively to manage memory usage
 */
export class ProgressiveLoader {
  private config: ProgressiveLoaderConfig;

  constructor(config: ProgressiveLoaderConfig) {
    this.config = config;
  }

  /**
   * Load all vectors from storage in chunks
   */
  async *loadVectorsInChunks(
    storage: StorageManager
  ): AsyncGenerator<VectorRecord[], void, unknown> {
    const all = await storage.getAll();
    const total = all.length;
    let loaded = 0;

    for (let i = 0; i < total; i += this.config.chunkSize) {
      const chunk = all.slice(i, i + this.config.chunkSize);
      loaded += chunk.length;
      if (this.config.onProgress) {
        this.config.onProgress(loaded, total);
      }
      yield chunk;
    }
  }

  /**
   * Load vectors with progress tracking
   */
  async loadWithProgress(
    storage: StorageManager,
    onProgress: (progress: LoadProgress) => void
  ): Promise<VectorRecord[]> {
    const total = await storage.count();
    const allRecords: VectorRecord[] = [];
    let loaded = 0;

    for await (const chunk of this.loadVectorsInChunks(storage)) {
      allRecords.push(...chunk);
      loaded += chunk.length;

      onProgress({
        loaded,
        total,
        percent: (loaded / total) * 100,
      });

      // Process chunk if callback provided
      if (this.config.onChunk) {
        await this.config.onChunk(chunk);
      }
    }

    return allRecords;
  }

  /**
   * Stream process vectors without loading all into memory
   */
  async streamProcess(
    storage: StorageManager,
    processor: (record: VectorRecord) => Promise<void>
  ): Promise<void> {
    const db = (storage as any).db as IDBDatabase;
    if (!db) {
      throw new Error('Storage not initialized');
    }

    const transaction = db.transaction(['vectors'], 'readonly');
    const store = transaction.objectStore('vectors');
    const request = store.openCursor();

    await new Promise<void>((resolve, reject) => {
      request.onsuccess = async (event) => {
        const cursor = (event.target as IDBRequest).result as IDBCursorWithValue;

        if (cursor) {
          const serialized = cursor.value;
          const record: VectorRecord = {
            id: serialized.id,
            vector: new Float32Array(serialized.vector),
            metadata: serialized.metadata,
            timestamp: serialized.timestamp,
          };

          try {
            await processor(record);
          } catch (error) {
            reject(error);
            return;
          }

          cursor.continue();
        } else {
          resolve();
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Export data in chunks to avoid memory issues
   */
  async *exportInChunks(
    storage: StorageManager
  ): AsyncGenerator<any[], void, unknown> {
    const all = await storage.getAll();
    const total = all.length;
    let loaded = 0;

    for (let i = 0; i < total; i += this.config.chunkSize) {
      const chunk = all.slice(i, i + this.config.chunkSize).map((r) => ({
        id: r.id,
        vector: Array.from(r.vector),
        metadata: r.metadata,
        timestamp: r.timestamp,
      }));
      loaded += chunk.length;
      if (this.config.onProgress) {
        this.config.onProgress(loaded, total);
      }
      yield chunk;
    }
  }

  /**
   * Import data in batches with progress tracking
   */
  async importInBatches(
    storage: StorageManager,
    records: VectorRecord[],
    onProgress?: (loaded: number, total: number) => void
  ): Promise<void> {
    const total = records.length;
    let loaded = 0;

    for (let i = 0; i < records.length; i += this.config.chunkSize) {
      const batch = records.slice(i, i + this.config.chunkSize);
      await storage.putBatch(batch);
      
      loaded += batch.length;
      
      if (onProgress) {
        onProgress(loaded, total);
      }
    }
  }
}
