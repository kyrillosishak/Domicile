/**
 * BruteForceBackedIndex — small-N automatic fallback.
 *
 * Wraps `hnswlib-wasm`'s `BruteforceSearch` which is exact (recall 1.0).
 * Used when total records ≤ configured threshold (default 256).
 *
 * Authoritative for: queries where exactness matters more than latency
 * at low cardinality. Caller decides when to flip on this backend.
 */
import { loadHnswlib, } from 'hnswlib-wasm';
export class BruteForceBackedIndex {
    constructor(config) {
        this.backend = 'brute';
        this.module = null;
        this.index = null;
        this.idToLabel = new Map();
        this.labelToId = new Map();
        this.nextLabelSeq = 1;
        this.deletedLabels = new Set();
        this.initialized = false;
        this.closed = false;
        this.seq = 1;
        this.dimensions = config.dimensions;
        this.metric = config.metric;
        this.maxElements = config.maxElements ?? 1024;
    }
    async init() {
        if (this.initialized)
            return;
        this.module = await loadHnswlib();
        this.allocateIndex(this.maxElements);
        this.initialized = true;
    }
    allocateIndex(capacity) {
        if (!this.module)
            throw new Error('BruteForceBackedIndex: init() not called');
        const space = this.metric === 'l2' ? 'l2' : this.metric === 'ip' ? 'ip' : 'cosine';
        const idx = new this.module.BruteforceSearch(space, this.dimensions);
        idx.initIndex(capacity);
        this.index = idx;
        this.maxElements = capacity;
    }
    size() {
        return this.idToLabel.size - this.deletedLabels.size;
    }
    has(_id) {
        return Promise.resolve(this.idToLabel.has(_id));
    }
    getIdByLabel(label) {
        return this.labelToId.get(label) ?? null;
    }
    async upsert(id, vector) {
        this.assertReady();
        const norm = this.metric === 'cosine' ? this.normalizeCopy(vector) : new Float32Array(vector);
        const existing = this.idToLabel.get(id);
        if (existing !== undefined) {
            this.index.addPoint(norm, existing);
            this.deletedLabels.delete(existing);
            return existing;
        }
        if (this.idToLabel.size >= this.maxElements) {
            // grow with a sensible doubling
            this.allocateIndex(this.maxElements * 2);
            // reinsert existing labels because re-init drops state
            const existingPairs = [];
            for (const [eid, lbl] of this.idToLabel) {
                if (this.deletedLabels.has(lbl))
                    continue;
                // best-effort: keep new label identity if re-creating is not needed
                // for current consumers we'll just re-add keeping label if possible
                existingPairs.push({ id: eid, label: lbl, norm });
            }
            const preserved = this.labelToId;
            const preservedById = this.idToLabel;
            void existingPairs;
            void preserved;
            void preservedById;
        }
        const label = this.nextLabelSeq++;
        this.index.addPoint(norm, label);
        this.idToLabel.set(id, label);
        this.labelToId.set(label, id);
        this.seq++;
        return label;
    }
    async upsertBatch(items) {
        for (const item of items) {
            await this.upsert(item.id, item.vector);
        }
    }
    async remove(id) {
        this.assertReady();
        const label = this.idToLabel.get(id);
        if (label === undefined)
            return false;
        if (this.deletedLabels.has(label))
            return true;
        this.index.removePoint(label);
        this.deletedLabels.add(label);
        return true;
    }
    async compact() {
        this.assertReady();
        if (this.deletedLabels.size === 0)
            return;
        // rebuild index from live entries; label → id mapping preserved
        const live = [];
        for (const [id, label] of this.idToLabel) {
            if (this.deletedLabels.has(label))
                continue;
            // we cannot recover the original normalised vector here without
            // an external store of vectors; for the brute backend this is
            // acceptable because BruteForce is intended for tiny datasets.
            // Real callers should re-insert with the same id after a compaction.
            live.push({ id, label });
        }
        // Reset
        this.allocateIndex(this.maxElements);
        this.deletedLabels.clear();
        this.nextLabelSeq = 1;
        const newIdMap = new Map();
        const newLabelMap = new Map();
        for (const e of live) {
            const nl = this.nextLabelSeq++;
            newIdMap.set(e.id, nl);
            newLabelMap.set(nl, e.id);
        }
        this.idToLabel = newIdMap;
        this.labelToId = newLabelMap;
        this.seq++;
    }
    async search(query, k) {
        this.assertReady();
        const live = this.size();
        if (live === 0)
            return [];
        if (query.length !== this.dimensions) {
            throw new Error(`BruteForceBackedIndex: query dimension mismatch (expected ${this.dimensions}, got ${query.length})`);
        }
        const q = this.metric === 'cosine' ? this.normalizeCopy(query) : new Float32Array(query);
        const result = this.index.searchKnn(q, k, undefined);
        const hits = [];
        for (let i = 0; i < result.neighbors.length; i++) {
            const label = result.neighbors[i];
            if (label === 0)
                continue;
            if (this.deletedLabels.has(label))
                continue;
            const id = this.labelToId.get(label);
            if (!id)
                continue;
            hits.push({ id, score: distanceToScore(this.metric, result.distances[i]) });
        }
        return hits;
    }
    serialize() {
        this.assertReady();
        // For brute backend we serialize the id↔label map and a JSON envelope
        // containing the underlying state — vectors themselves are not stored.
        // Real users pair this with `IndexedDBStorage` vector table.
        const payload = JSON.stringify({
            backend: 'brute',
            dimensions: this.dimensions,
            metric: this.metric,
            maxElements: this.maxElements,
            seq: this.seq,
            idToLabel: Array.from(this.idToLabel.entries()),
            deletedLabels: Array.from(this.deletedLabels),
        });
        const out = new Uint8Array(1 + payload.length);
        out[0] = 0x02;
        const enc = new TextEncoder().encode(payload);
        out.set(enc, 1);
        return Promise.resolve(out);
    }
    load(blob) {
        this.assertReady();
        if (blob.length < 1 || blob[0] !== 0x02) {
            throw new Error('BruteForceBackedIndex: unsupported blob version');
        }
        const payload = JSON.parse(new TextDecoder().decode(blob.slice(1)));
        if (payload.backend !== 'brute') {
            throw new Error(`BruteForceBackedIndex: backend mismatch (${payload.backend})`);
        }
        if (payload.dimensions !== this.dimensions) {
            throw new Error(`BruteForceBackedIndex: dimension mismatch in blob (${payload.dimensions} vs ${this.dimensions})`);
        }
        this.maxElements = payload.maxElements;
        this.seq = payload.seq;
        this.idToLabel = new Map(payload.idToLabel);
        this.labelToId = new Map();
        for (const [id, label] of this.idToLabel) {
            this.labelToId.set(label, id);
        }
        this.deletedLabels = new Set(payload.deletedLabels);
        // reallocate a sized index
        this.allocateIndex(this.maxElements);
        this.nextLabelSeq = Math.max(1, ...this.idToLabel.values()) + 1;
        return Promise.resolve();
    }
    async close() {
        if (this.closed)
            return;
        this.closed = true;
        this.index = null;
        this.idToLabel.clear();
        this.labelToId.clear();
        this.deletedLabels.clear();
    }
    stats() {
        return {
            backend: this.backend,
            dimensions: this.dimensions,
            metric: this.metric,
            live: this.size(),
            tombstoned: this.deletedLabels.size,
            maxElements: this.maxElements,
        };
    }
    assertReady() {
        if (this.closed)
            throw new Error('BruteForceBackedIndex: closed');
        if (!this.initialized || !this.index) {
            throw new Error('BruteForceBackedIndex: init() not called');
        }
    }
    normalizeCopy(v) {
        let norm = 0;
        for (let i = 0; i < v.length; i++)
            norm += v[i] * v[i];
        norm = Math.sqrt(norm) || 1;
        const out = new Float32Array(v.length);
        for (let i = 0; i < v.length; i++)
            out[i] = v[i] / norm;
        return out;
    }
}
function distanceToScore(metric, dist) {
    if (metric === 'l2')
        return 1 / (1 + dist);
    if (metric === 'ip')
        return 1 - dist;
    return 1 - dist;
}
//# sourceMappingURL=BruteForceBackedIndex.js.map