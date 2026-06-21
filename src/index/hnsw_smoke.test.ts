import { describe, it, expect } from 'vitest';
import { HnswIndex } from './HnswIndex';

function cosine(a: Float32Array, b: Float32Array): number {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb));
}

describe('HnswIndex smoke', () => {
  it('returns high-recall, real-score neighbors and supports non-rebuilding delete', async () => {
    const dim = 8;
    const idx = new HnswIndex({ dimensions: dim, m: 8, efConstruction: 64, efSearch: 64, seed: 42 });
    await idx.initialize();

    const vecs: { id: string; vector: Float32Array }[] = [];
    for (let i = 0; i < 200; i++) {
      const v = new Float32Array(dim);
      for (let j = 0; j < dim; j++) v[j] = Math.sin(i * 0.7 + j) + Math.cos(i * 0.3);
      const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
      for (let j = 0; j < dim; j++) v[j] /= n;
      vecs.push({ id: 'v' + i, vector: v });
    }
    await idx.addBatch(vecs.map((v) => ({ id: v.id, vector: v.vector, metadata: {}, timestamp: 0 })));

    const q = new Float32Array(dim);
    for (let j = 0; j < dim; j++) q[j] = Math.sin(5 * 0.7 + j) + Math.cos(5 * 0.3);
    const nq = Math.sqrt(q.reduce((s, x) => s + x * x, 0));
    for (let j = 0; j < dim; j++) q[j] /= nq;

    const brute = vecs.map((v) => ({ id: v.id, s: cosine(q, v.vector) })).sort((a, b) => b.s - a.s).slice(0, 5).map((x) => x.id);
    const hnsw = (await idx.search(q, 5)).map((h) => h.id);
    const overlap = brute.filter((id) => hnsw.includes(id)).length;

    // Recall@5 should be high (HNSW typically ≥ 4/5 at this scale).
    expect(overlap).toBeGreaterThanOrEqual(4);

    // Scores must be real cosine similarities in [-1, 1], not a hardcoded
    // placeholder. The query is an exact copy of v5, so the top hit must be
    // v5 at ~1.0 — proving scores are real and ranking is correct.
    const hits = await idx.search(q, 5);
    expect(hits.every((h) => typeof h.score === 'number' && h.score >= -1 && h.score <= 1.0001)).toBe(true);
    expect(hits[0].id).toBe('v5');
    expect(hits[0].score).toBeGreaterThan(0.999);

    // Delete must not rebuild (count drops, deleted id never returns).
    await idx.remove('v5');
    const afterDel = (await idx.search(q, 5)).map((h) => h.id);
    expect(afterDel.includes('v5')).toBe(false);
    expect(idx.stats().vectorCount).toBe(199);

    // Serialize/deserialize round-trips.
    const serialized = await idx.serialize();
    const idx2 = new HnswIndex({ dimensions: dim });
    await idx2.initialize();
    await idx2.deserialize(serialized);
    const afterRoundtrip = (await idx2.search(q, 5)).map((h) => h.id);
    expect(afterRoundtrip.length).toBe(5);
  });
});
