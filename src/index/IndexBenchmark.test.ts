/**
 * HnswIndex benchmark gate test. Runs at a small scale (fast in CI) and
 * asserts the quality gate: HnswIndex returns real, varied scores and
 * recall at/above the floor vs a brute-force ground truth.
 */

import { describe, it, expect } from 'vitest';
import { benchmarkIndex, benchmarkSuite } from './IndexBenchmark';

describe('IndexBenchmark (HnswIndex gate)', () => {
  it('HnswIndex returns real, varied scores with high recall', async () => {
    const result = await benchmarkIndex(
      { size: 500, dimensions: 64 },
      { queries: 50, k: 10, deleteFraction: 0.1 }
    );

    // HnswIndex must produce non-constant scores (the whole reason it exists).
    expect(result.hnsw.hasRealScores).toBe(true);

    // HnswIndex recall should be high (HNSW at these sizes is near-exact).
    expect(result.hnsw.recallAtK).toBeGreaterThan(0.9);
  }, 60000);

  it('gate passes for the small scale point', async () => {
    const result = await benchmarkIndex(
      { size: 800, dimensions: 64 },
      { queries: 40, k: 10, deleteFraction: 0.05 }
    );
    expect(result.pass).toBe(true);
  }, 60000);

  it('benchmarkSuite aggregates pass/fail across scale points', async () => {
    const suite = await benchmarkSuite(
      [{ size: 300, dimensions: 32 }, { size: 600, dimensions: 32 }],
      { queries: 30, k: 5, deleteFraction: 0.05 }
    );
    expect(suite.results).toHaveLength(2);
    expect(suite.overallPass).toBe(true);
    for (const r of suite.results) {
      expect(r.hnsw.hasRealScores).toBe(true);
    }
  }, 90000);
});
