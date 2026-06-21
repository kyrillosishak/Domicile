/**
 * Tests for the citation-accuracy benchmark (TECHNICAL_VALIDATION.md §5).
 */

import { describe, it, expect } from 'vitest';
import {
  benchmarkCitationAccuracy,
  DEFAULT_LEGAL_CORPUS,
  DEFAULT_LEGAL_QUESTIONS,
} from './CitationBenchmark';

describe('citation-accuracy benchmark', () => {
  it('runs all four pipeline variants and returns metrics', async () => {
    const result = await benchmarkCitationAccuracy({ k: 3 });
    expect(result.variants).toHaveLength(4);
    const variantNames = result.variants.map((v) => v.variant);
    expect(variantNames).toEqual(['dense', 'dense+hybrid', 'dense+rerank', 'dense+hybrid+rerank']);

    for (const v of result.variants) {
      expect(v.citationRecallAtK).toBeGreaterThanOrEqual(0);
      expect(v.citationRecallAtK).toBeLessThanOrEqual(1);
      expect(v.meanExpectedRank).toBeGreaterThanOrEqual(1);
      expect(v.perQuestion).toHaveLength(DEFAULT_LEGAL_QUESTIONS.length);
    }
  }, 30000);

  it('every default question maps to a passage that exists in the corpus', () => {
    const ids = new Set(DEFAULT_LEGAL_CORPUS.map((p) => p.id));
    for (const q of DEFAULT_LEGAL_QUESTIONS) {
      expect(ids.has(q.expectedId)).toBe(true);
    }
  });

  it('dense retrieval cites the right source for at least half the questions', async () => {
    const result = await benchmarkCitationAccuracy({ k: 3 });
    const dense = result.variants.find((v) => v.variant === 'dense')!;
    // Bag-of-words dense should get most keyword-overlap questions right.
    expect(dense.citationRecallAtK).toBeGreaterThanOrEqual(0.5);
  }, 30000);

  it('reports per-question hit/miss with a valid rank', async () => {
    const result = await benchmarkCitationAccuracy({ k: 3 });
    const dense = result.variants.find((v) => v.variant === 'dense')!;
    for (const pq of dense.perQuestion) {
      expect(pq.hit).toBe(pq.rank <= 3);
      expect(pq.rank).toBeGreaterThanOrEqual(1);
    }
  }, 30000);

  it('the full pipeline does not regress citation recall below dense-only', async () => {
    const result = await benchmarkCitationAccuracy({ k: 3 });
    const dense = result.variants.find((v) => v.variant === 'dense')!;
    const full = result.variants.find((v) => v.variant === 'dense+hybrid+rerank')!;
    expect(full.citationRecallAtK).toBeGreaterThanOrEqual(dense.citationRecallAtK);
  }, 30000);
});
