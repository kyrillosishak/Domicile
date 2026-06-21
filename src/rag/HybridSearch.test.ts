import { describe, it, expect } from 'vitest';
import { BM25Index, reciprocalRankFusion, tokenize } from './HybridSearch';

describe('tokenize', () => {
  it('lowercases, strips punctuation, drops stopwords and single chars', () => {
    expect(tokenize('The Indemnification, Clause 4.2!')).toEqual(
      expect.arrayContaining(['indemnification', 'clause'])
    );
    // single-char tokens ('4','2' from '4.2') are dropped as non-informative.
    expect(tokenize('The Indemnification, Clause 4.2!')).not.toContain('4');
    expect(tokenize('The of a an')).toEqual([]);
  });
});

describe('BM25Index', () => {
  it('ranks documents with query terms above those without', () => {
    const idx = new BM25Index();
    idx.add('d1', 'The indemnification clause limits liability.');
    idx.add('d2', 'Privacy policy governs data usage.');
    idx.add('d3', 'Indemnification and indemnification again.');

    const results = idx.search('indemnification');
    expect(results.length).toBe(2);
    // d3 has the term twice → should rank above d1.
    expect(results[0].id).toBe('d3');
    expect(results[1].id).toBe('d1');
  });

  it('returns empty for a query with no matching terms', () => {
    const idx = new BM25Index();
    idx.add('d1', 'alpha beta');
    expect(idx.search('gamma')).toEqual([]);
  });

  it('supports remove', () => {
    const idx = new BM25Index();
    idx.add('d1', 'indemnification clause');
    idx.add('d2', 'indemnification term');
    expect(idx.search('indemnification')).toHaveLength(2);
    idx.remove('d1');
    expect(idx.search('indemnification')).toHaveLength(1);
    expect(idx.search('indemnification')[0].id).toBe('d2');
  });
});

describe('reciprocalRankFusion', () => {
  it('fuses dense and sparse ranks, boosting docs present in both', () => {
    const dense = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const sparse = [{ id: 'b' }, { id: 'd' }, { id: 'a' }];
    const fused = reciprocalRankFusion(dense, sparse);

    // 'a' and 'b' appear in both → higher fused score than 'c' or 'd'.
    const top = fused.slice(0, 2).map((f) => f.id).sort();
    expect(top).toEqual(['a', 'b']);
    // 'c' (dense only) and 'd' (sparse only) rank below.
    const tail = fused.slice(2).map((f) => f.id).sort();
    expect(tail).toEqual(['c', 'd']);
  });

  it('handles one empty list', () => {
    const fused = reciprocalRankFusion([{ id: 'a' }], []);
    expect(fused).toHaveLength(1);
    expect(fused[0].id).toBe('a');
  });
});
