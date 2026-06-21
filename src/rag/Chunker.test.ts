import { describe, it, expect } from 'vitest';
import { SentenceChunker } from './Chunker';

describe('SentenceChunker', () => {
  it('returns [] for empty input', () => {
    expect(new SentenceChunker().chunk('')).toEqual([]);
    expect(new SentenceChunker().chunk('   ')).toEqual([]);
  });

  it('returns a single chunk for short text', () => {
    const chunks = new SentenceChunker({ chunkSize: 256 }).chunk('One short sentence.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain('One short sentence');
    expect(chunks[0].index).toBe(0);
  });

  it('splits long text into multiple overlapping, boundary-respecting chunks', () => {
    const sentences = Array.from({ length: 40 }, (_, i) => `This is sentence number ${i} with some legal wording about clause ${i}.`);
    const text = sentences.join(' ');
    const chunks = new SentenceChunker({ chunkSize: 32, overlap: 8, minChunkSize: 4 }).chunk(text);

    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should start at a sentence boundary (capital "This").
    for (const c of chunks) {
      expect(c.text.startsWith('This')).toBe(true);
    }
    // Chunks are indexed sequentially.
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
    // Overlap: the second chunk should share at least one sentence with the first.
    const firstWords = new Set(chunks[0].text.split(' '));
    const shared = chunks[1].text.split(' ').filter((w) => firstWords.has(w)).length;
    expect(shared).toBeGreaterThan(0);
  });

  it('does not infinite-loop when overlap >= chunkSize', () => {
    const chunks = new SentenceChunker({ chunkSize: 10, overlap: 100 }).chunk('A. B. C. D. E. F. G. H.');
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('merges a too-small trailing fragment into the previous chunk', () => {
    const text = Array.from({ length: 20 }, (_, i) => `Sentence ${i} here.`).join(' ') + ' tiny.';
    const chunks = new SentenceChunker({ chunkSize: 16, overlap: 2, minChunkSize: 8 }).chunk(text);
    // The last "tiny." fragment should have been absorbed, not emitted alone.
    expect(chunks[chunks.length - 1].text).toContain('tiny');
  });
});
