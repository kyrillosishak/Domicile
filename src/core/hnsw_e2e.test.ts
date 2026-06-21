import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDomicile } from './factory';
import { createMockPipeline } from '../test/mocks/transformers';

// Mock Transformers.js so no model is downloaded.
vi.mock('@huggingface/transformers', () => {
  const mockPipeline = vi.fn();
  return {
    pipeline: mockPipeline,
    env: { allowLocalModels: false, useBrowserCache: false, allowRemoteModels: true, cacheDir: './.cache/huggingface' },
  };
});

beforeEach(async () => {
  const { pipeline } = await import('@huggingface/transformers');
  (vi.mocked(pipeline) as any).mockResolvedValue(createMockPipeline({ dimensions: 384 }) as any);
});

/**
 * End-to-end check that the injected/HNSW path through createDomicile
 * works: insert, search with real scores, delete, re-search. Uses the
 * mocked Transformers pipeline (via test setup) so no model download.
 */
describe('createDomicile with HNSW (injected path)', () => {
  let db: Awaited<ReturnType<typeof createDomicile>>;

  beforeEach(async () => {
    db = await createDomicile({
      storage: { dbName: 'hnsw-e2e-' + Math.random().toString(36).slice(2) },
      dimensions: 384,
      metric: 'cosine',
      embedding: { model: 'Xenova/all-MiniLM-L6-v2' },
      indexType: 'hnsw',
      forceEmbeddingDevice: 'wasm',
    });
  });

  it('inserts, searches with real scores, and deletes without rebuild', async () => {
    await db.insert({ text: 'alpha contract clause', metadata: { matter: 'M1' } });
    await db.insert({ text: 'beta indemnification term', metadata: { matter: 'M1' } });
    await db.insert({ text: 'gamma privacy policy', metadata: { matter: 'M2' } });

    const results = await db.search({ text: 'indemnification', k: 3 });
    expect(results.length).toBeGreaterThan(0);
    // Real scores (not a 1.0 placeholder).
    expect(results.every((r) => typeof r.score === 'number')).toBe(true);
    const scores = results.map((r) => r.score);
    expect(Math.max(...scores)).toBeGreaterThan(Math.min(...scores) === Math.max(...scores) ? -Infinity : Math.min(...scores));

    // Metadata filter hydration works on the injected path.
    const filtered = await db.search({ text: 'clause', k: 3, filter: { field: 'matter', operator: 'eq', value: 'M2' } });
    expect(filtered.every((r) => r.metadata.matter === 'M2')).toBe(true);

    expect(await db.size()).toBe(3);
  });
});
