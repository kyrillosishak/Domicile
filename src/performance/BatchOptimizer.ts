/**
 * Batch Optimizer for optimizing IndexedDB transactions
 * Batches multiple operations together for better performance
 */

import type { VectorRecord, StorageManager } from '../storage/types';

export interface BatchOptimizerConfig {
  maxBatchSize: number;
  maxWaitTime: number; // Maximum time to wait before flushing batch (ms)
  autoFlush?: boolean;
}

export interface PendingOperation {
  type: 'put' | 'delete';
  data: VectorRecord | string;
  resolve: (result: any) => void;
  reject: (error: Error) => void;
}

/**
 * Optimizes IndexedDB operations by batching them together
 */
export class BatchOptimizer {
  private config: Required<BatchOptimizerConfig>;
  private pendingOps: PendingOperation[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private storage: StorageManager;

  constructor(storage: StorageManager, config: BatchOptimizerConfig) {
    this.storage = storage;
    this.config = {
      autoFlush: true,
      ...config,
    };
  }

  /**
   * Queue a put operation
   */
  async put(record: VectorRecord): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pendingOps.push({
        type: 'put',
        data: record,
        resolve,
        reject,
      });

      this.scheduleFlush();
    });
  }

  /**
   * Queue a delete operation
   */
  async delete(id: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.pendingOps.push({
        type: 'delete',
        data: id,
        resolve,
        reject,
      });

      this.scheduleFlush();
    });
  }

  /**
   * Manually flush all pending operations
   */
  async flush(): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.pendingOps.length === 0) {
      return;
    }

    const ops = [...this.pendingOps];
    this.pendingOps = [];

    try {
      // Separate put and delete operations
      const putOps = ops.filter(op => op.type === 'put');
      const deleteOps = ops.filter(op => op.type === 'delete');

      // Execute put operations in batch
      if (putOps.length > 0) {
        const records = putOps.map(op => op.data as VectorRecord);
        try {
          await this.storage.putBatch(records);
          putOps.forEach(op => op.resolve(undefined));
        } catch (error) {
          putOps.forEach(op => op.reject(error as Error));
        }
      }

      // Execute delete operations individually (IndexedDB doesn't have batch delete)
      for (const op of deleteOps) {
        try {
          const result = await this.storage.delete(op.data as string);
          op.resolve(result);
        } catch (error) {
          op.reject(error as Error);
        }
      }
    } catch (error) {
      // Reject all pending operations
      ops.forEach(op => op.reject(error as Error));
    }
  }

  /**
   * Get the number of pending operations
   */
  getPendingCount(): number {
    return this.pendingOps.length;
  }

  /**
   * Clear all pending operations without executing them
   */
  clear(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Reject all pending operations
    const error = new Error('Batch operations cleared');
    this.pendingOps.forEach(op => op.reject(error));
    this.pendingOps = [];
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.clear();
  }

  /**
   * Schedule a flush operation
   */
  private scheduleFlush(): void {
    // Flush immediately if batch is full
    if (this.pendingOps.length >= this.config.maxBatchSize) {
      this.flush();
      return;
    }

    // Schedule flush if auto-flush is enabled
    if (this.config.autoFlush && this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        this.flush();
      }, this.config.maxWaitTime);
    }
  }
}
