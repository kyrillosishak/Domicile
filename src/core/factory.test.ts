import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDomicile } from './factory';
import { VectorDB } from './VectorDB';
import { createMockPipeline } from '../test/mocks/transformers.js';

vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn().mockImplementation(async () => createMockPipeline({ dimensions: 384 })),
  env: {
    allowLocalModels: true,
    useBrowserCache: false,
    allowRemoteModels: true,
    cacheDir: './.cache/huggingface',
  },
}));

vi.mock('./capabilities', () => ({
  detectCapabilities: vi.fn().mockResolvedValue({
    webgpu: false,
    wasm: true,
    simd: true,
    sharedArrayBuffer: true,
    indexedDB: true,
    deviceMemoryGB: 8,
    maxTextureSize: 8192,
    deviceTier: 'mid',
  }),
}));

describe('createDomicile factory', () => {
  const validOptions = {
    storage: { dbName: `test-factory-${Math.random()}`, version: 1 },
    dimensions: 384,
    metric: 'cosine' as const,
    embedding: { model: 'Xenova/all-MiniLM-L6-v2', device: 'wasm' as const, cache: true },
    performance: { maxMemoryMB: 100 },
  };

  it('should create a VectorDB instance', async () => {
    const db = await createDomicile(validOptions);
    expect(db).toBeInstanceOf(VectorDB);
    await db.dispose();
  });

  it('should initialize with HNSW index', async () => {
    const db = await createDomicile(validOptions);
    const count = await db.size();
    expect(count).toBe(0);
    await db.dispose();
  });

  it('should validate embedding model dimensions', async () => {
    await expect(createDomicile({
      ...validOptions,
      embedding: { ...validOptions.embedding, model: 'Xenova/all-MiniLM-L6-v2' },
      dimensions: 768, // mismatch with 384-dim model
    })).rejects.toThrow();
  });

  it('should respect forceEmbeddingDevice', async () => {
    const db = await createDomicile({
      ...validOptions,
      forceEmbeddingDevice: 'wasm',
    });
    await db.dispose();
  });

  it('should use provided HNSW tuning params', async () => {
    const db = await createDomicile({
      ...validOptions,
      hnsw: { m: 16, efConstruction: 200, efSearch: 50 },
    });
    await db.dispose();
  });
});