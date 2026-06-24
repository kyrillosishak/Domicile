import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BatchOptimizer } from './BatchOptimizer';
import type { StorageManager, VectorRecord } from '../storage/types';

function createMockStorage(): StorageManager {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
    putBatch: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    getBatch: vi.fn().mockResolvedValue([]),
    getAll: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
    clear: vi.fn().mockResolvedValue(undefined),
    filter: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    saveIndex: vi.fn().mockResolvedValue(undefined),
    loadIndex: vi.fn().mockResolvedValue(null),
  };
}

describe('BatchOptimizer', () => {
  let storage: StorageManager;
  let optimizer: BatchOptimizer;

  beforeEach(() => {
    vi.useRealTimers();
    storage = createMockStorage();
    optimizer = new BatchOptimizer(storage, { maxBatchSize: 10, maxWaitTime: 5000, autoFlush: false });
  });

  afterEach(() => {
    vi.useFakeTimers();
  });

  it('should queue put operations', () => {
    const record: VectorRecord = { id: '1', vector: new Float32Array([1, 2, 3]), metadata: {}, timestamp: Date.now() };
    optimizer.put(record);
    expect(optimizer.getPendingCount()).toBe(1);
  });

  it('should queue delete operations', () => {
    optimizer.delete('1');
    expect(optimizer.getPendingCount()).toBe(1);
  });

  it('should flush immediately when batch is full', async () => {
    const record: VectorRecord = { id: '1', vector: new Float32Array([1]), metadata: {}, timestamp: Date.now() };
    // Add 10 items to reach batch size
    for (let i = 0; i < 10; i++) {
      optimizer.put({ ...record, id: String(i) });
    }
    expect(storage.putBatch).toHaveBeenCalled();
  });

  it('should flush manually', async () => {
    const record: VectorRecord = { id: '1', vector: new Float32Array([1]), metadata: {}, timestamp: Date.now() };
    const putPromise = optimizer.put(record);
    await optimizer.flush();
    await putPromise;
    expect(optimizer.getPendingCount()).toBe(0);
    expect(storage.putBatch).toHaveBeenCalled();
  });

  it('should resolve put operations on flush', async () => {
    const record: VectorRecord = { id: '1', vector: new Float32Array([1]), metadata: {}, timestamp: Date.now() };
    const promise = optimizer.put(record);
    await optimizer.flush();
    await expect(promise).resolves.not.toThrow();
  });

  it('should reject put operations on flush error', async () => {
    storage.putBatch = vi.fn().mockRejectedValue(new Error('DB error'));
    const record: VectorRecord = { id: '1', vector: new Float32Array([1]), metadata: {}, timestamp: Date.now() };
    const promise = optimizer.put(record);
    await optimizer.flush();
    await expect(promise).rejects.toThrow('DB error');
  });

  it('should clear pending operations', async () => {
    const record: VectorRecord = { id: '1', vector: new Float32Array([1]), metadata: {}, timestamp: Date.now() };
    const promise = optimizer.put(record);
    optimizer.clear();
    await expect(promise).rejects.toThrow('Batch operations cleared');
    expect(optimizer.getPendingCount()).toBe(0);
  });

  it('should reject pending operations on clear', async () => {
    const record: VectorRecord = { id: '1', vector: new Float32Array([1]), metadata: {}, timestamp: Date.now() };
    const promise = optimizer.put(record);
    optimizer.clear();
    await expect(promise).rejects.toThrow('Batch operations cleared');
  });

  it('should dispose without error', async () => {
    const record: VectorRecord = { id: '1', vector: new Float32Array([1]), metadata: {}, timestamp: Date.now() };
    const promise = optimizer.put(record);
    optimizer.dispose();
    await expect(promise).rejects.toThrow('Batch operations cleared');
    expect(optimizer.getPendingCount()).toBe(0);
  });

  it('should handle mixed put and delete operations', async () => {
    const record: VectorRecord = { id: '1', vector: new Float32Array([1]), metadata: {}, timestamp: Date.now() };
    optimizer.put(record);
    optimizer.delete('2');
    optimizer.delete('3');
    await optimizer.flush();
    expect(storage.putBatch).toHaveBeenCalled();
    expect(storage.delete).toHaveBeenCalledTimes(2);
  });
});