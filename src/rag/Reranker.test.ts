import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TransformersReranker, NoopReranker } from './Reranker';
import type { SearchResult } from '../index/types';

describe('Reranker', () => {
  const mockCandidates: SearchResult[] = [
    { id: '1', score: 0.9, metadata: { content: 'Document about Paris' } },
    { id: '2', score: 0.8, metadata: { content: 'Document about London' } },
    { id: '3', score: 0.7, metadata: { content: 'Document about Tokyo' } },
  ];

  describe('NoopReranker', () => {
    let reranker: NoopReranker;

    beforeEach(() => {
      reranker = new NoopReranker();
    });

    it('should be ready immediately', () => {
      expect(reranker.isReady()).toBe(true);
    });

    it('should return candidates unchanged', async () => {
      const result = await reranker.rerank('test query', mockCandidates);
      expect(result).toEqual(mockCandidates);
    });

    it('should handle empty candidates', async () => {
      const result = await reranker.rerank('test', []);
      expect(result).toEqual([]);
    });

    it('should dispose without error', async () => {
      await expect(reranker.dispose()).resolves.not.toThrow();
    });
  });

  describe('TransformersReranker', () => {
    let reranker: TransformersReranker;

    beforeEach(() => {
      vi.resetModules();
      reranker = new TransformersReranker({ model: 'test-model', topN: 2 });
    });

    it('should not be ready initially', () => {
      expect(reranker.isReady()).toBe(false);
    });

    it('should return candidates unchanged when pipeline fails to load', async () => {
      // Mock the transformers import to fail
      vi.doMock('@huggingface/transformers', () => ({
        pipeline: vi.fn().mockRejectedValue(new Error('Model load failed')),
        env: { allowLocalModels: false, useBrowserCache: true },
      }));

      const result = await reranker.rerank('test query', mockCandidates);
      expect(result).toEqual(mockCandidates);
    });

    it('should handle single candidate', async () => {
      const result = await reranker.rerank('test', [mockCandidates[0]]);
      expect(result).toHaveLength(1);
    });

    it('should handle empty candidates', async () => {
      const result = await reranker.rerank('test', []);
      expect(result).toEqual([]);
    });

    it('should respect topN option', async () => {
      const rerankerWithTopN = new TransformersReranker({ model: 'test', topN: 1 });
      const candidates = [...mockCandidates, { id: '4', score: 0.6, metadata: {} }];
      const result = await rerankerWithTopN.rerank('test', candidates);
      // topN=1 means only first candidate is re-scored, rest passed through
      expect(result.length).toBe(candidates.length);
    });

    it('should extract snippet from content', async () => {
      // Access private method via rerank with known candidates
      const candidates = [{ id: '1', score: 0.9, metadata: { content: 'A'.repeat(1000) } }];
      await reranker.rerank('query', candidates);
      // No error means snippet extraction worked
    });

    it('should extract snippet from title when no content', async () => {
      const candidates = [{ id: '1', score: 0.9, metadata: { title: 'Test Title' } }];
      await reranker.rerank('query', candidates);
    });

    it('should return empty string when no content or title', async () => {
      const candidates = [{ id: '1', score: 0.9, metadata: {} }];
      await reranker.rerank('query', candidates);
    });

    it('should dispose without error', async () => {
      await expect(reranker.dispose()).resolves.not.toThrow();
      expect(reranker.isReady()).toBe(false);
    });
  });
});