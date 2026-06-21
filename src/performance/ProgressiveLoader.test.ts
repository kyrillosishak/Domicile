/**
 * Tests for ProgressiveLoader chunk-yielding fix (P1 #5).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProgressiveLoader } from './ProgressiveLoader';
import { IndexedDBStorage } from '../storage/IndexedDBStorage';
import type { VectorRecord } from '../storage/types';

describe('ProgressiveLoader', () => {
  let storage: IndexedDBStorage;

  beforeEach(async () => {
    storage = new IndexedDBStorage({ dbName: `prog-${Math.random()}`, version: 1 });
    await storage.initialize();
    // Seed 25 records at 384-dim
    const make = (id: string) => ({
      id,
      vector: new Float32Array(Array.from({ length: 384 }, (_, i) => Math.sin(i))),
      metadata: { id },
      timestamp: Date.now(),
    });
    await storage.putBatch(Array.from({ length: 25 }, (_, i) => make(`r${i}`)));
  });

  afterEach(async () => {
    await storage.close();
  });

  it('loadVectorsInChunks yields N/chunkSize chunks (was broken)', async () => {
    const loader = new ProgressiveLoader({ chunkSize: 10 });
    const collected: VectorRecord[] = [];
    let chunkCount = 0;
    for await (const chunk of loader.loadVectorsInChunks(storage)) {
      chunkCount++;
      collected.push(...chunk);
    }
    expect(chunkCount).toBe(3); // 10 + 10 + 5
    expect(collected.length).toBe(25);
  });

  it('exportInChunks yields chunks of the requested size', async () => {
    const loader = new ProgressiveLoader({ chunkSize: 8 });
    const collected: any[] = [];
    let chunkCount = 0;
    for await (const chunk of loader.exportInChunks(storage)) {
      chunkCount++;
      collected.push(...chunk);
    }
    expect(chunkCount).toBe(4); // 8 + 8 + 8 + 1
    expect(collected.length).toBe(25);
  });

  it('loadVectorsInChunks handles empty storage', async () => {
    await storage.clear();
    const loader = new ProgressiveLoader({ chunkSize: 10 });
    const gen = loader.loadVectorsInChunks(storage);
    const first = await gen.next();
    expect(first.done).toBe(true);
  });
});
