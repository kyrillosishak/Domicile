import { describe, it, expect, vi } from 'vitest';
import { CharTokenizer, TransformersTokenizer, heuristicTokenizer } from './Tokenizer';

describe('Tokenizer', () => {
  describe('CharTokenizer', () => {
    let tokenizer: CharTokenizer;

    beforeEach(() => {
      tokenizer = new CharTokenizer();
    });

    it('should count tokens using length/4 heuristic', async () => {
      expect(await tokenizer.count('hello')).toBe(2); // 5 chars / 4 = 1.25 -> 2
      expect(await tokenizer.count('')).toBe(0);
      expect(await tokenizer.count('a')).toBe(1);
      expect(await tokenizer.count('abcd')).toBe(1); // 4 chars / 4 = 1
      expect(await tokenizer.count('abcde')).toBe(2); // 5 chars / 4 = 1.25 -> 2
    });

    it('should truncate to maxTokens', async () => {
      const text = 'This is a test sentence. Another one here.';
      const truncated = await tokenizer.truncate(text, 3); // 3 tokens * 4 = 12 chars
      // Truncation adds a suffix, so check it contains the truncation marker
      expect(truncated).toContain('[Context truncated');
    });

    it('should not truncate if text fits', async () => {
      const text = 'Short';
      const truncated = await tokenizer.truncate(text, 10);
      expect(truncated).toBe(text);
    });

    it('should prefer sentence boundary when truncating', async () => {
      const text = 'First sentence. Second sentence. Third sentence.';
      const truncated = await tokenizer.truncate(text, 8); // 8 * 4 = 32 chars
      expect(truncated).toContain('First sentence.');
    });

    it('should dispose without error', async () => {
      await expect(tokenizer.dispose()).resolves.not.toThrow();
    });
  });

  describe('TransformersTokenizer', () => {
    it('should create with model name', () => {
      const tokenizer = new TransformersTokenizer('test-model');
      expect(tokenizer).toBeDefined();
    });

    it('should fall back to heuristic when model fails to load', async () => {
      const tokenizer = new TransformersTokenizer('non-existent-model');
      // Mock the import to fail
      vi.doMock('@huggingface/transformers', () => ({
        AutoTokenizer: { from_pretrained: vi.fn().mockRejectedValue(new Error('Failed')) },
        env: { allowLocalModels: false, useBrowserCache: true },
      }));

      const count = await tokenizer.count('hello world');
      expect(count).toBeGreaterThan(0);
    });

    it('should truncate using heuristic fallback', async () => {
      const tokenizer = new TransformersTokenizer('non-existent-model');
      vi.doMock('@huggingface/transformers', () => ({
        AutoTokenizer: { from_pretrained: vi.fn().mockRejectedValue(new Error('Failed')) },
        env: { allowLocalModels: false, useBrowserCache: true },
      }));

      const text = 'This is a test sentence. Another one here.';
      const truncated = await tokenizer.truncate(text, 3);
      expect(truncated).toContain('[Context truncated');
    });

    it('should dispose without error', async () => {
      const tokenizer = new TransformersTokenizer('test-model');
      await expect(tokenizer.dispose()).resolves.not.toThrow();
    });
  });

  describe('heuristicTokenizer', () => {
    it('should return a CharTokenizer instance', () => {
      const tokenizer = heuristicTokenizer();
      expect(tokenizer).toBeInstanceOf(CharTokenizer);
    });

    it('should count tokens', async () => {
      const tokenizer = heuristicTokenizer();
      expect(await tokenizer.count('test')).toBe(1);
    });

    it('should truncate text', async () => {
      const tokenizer = heuristicTokenizer();
      const text = 'This is a longer test sentence that will be truncated.';
      const truncated = await tokenizer.truncate(text, 2);
      expect(truncated).toContain('[Context truncated');
    });
  });
});