/**
 * HnswBackedIndex — production ANN backend.
 *
 *  - Single source of truth: `hnswlib-wasm` ∈ Apache-2.0.
 *  - id ↔ label mapping: maps stable string ids (UUIDs, composite keys, …) to
 *    internally-assigned numeric labels that hnswlib-wasm's HNSW requires.
 *  - deletes: native `markDelete`; surfaced via `TombstoneLog` so reads can
 *    pre-skip and `compact()` can rebuild.
 *  - serialize: writes to a unique Emscripten MEMFS filename via
 *    `FS.writeFile`, then reads bytes back out via `FS.readFile`. The bytes
 *    are saved by `IndexedDBStorage`.  Inverse on load.
 *  - No IDBFS: persistence is the caller's job — that way we control the
 *    envelope (CBOR-lite header + raw body) end-to-end.
 */
import { loadHnswlib, } from 'hnswlib-wasm';
import { TombstoneLog } from './TombstoneLog';
const MAX_LABEL = 2 ** 31 - 2;
let __labelSeq = 1;
function nextLabel() {
    // monotonic, never 0 (we reserve 0 as "invalid")
    if (__labelSeq >= MAX_LABEL)
        __labelSeq = 1;
    return __labelSeq++;
}
const HEADER_PREFIX_LEN = 1; // first byte = schema version (0x02)
export class HnswBackedIndex {
    constructor(config) {
        this.backend = 'hnsw';
        this.module = null;
        this.index = null;
        this.fileHandle = null;
        /** stable id → numeric label */
        this.idToLabel = new Map();
        /** numeric label → stable id (inverted for has() / remove() / compact()) */
        this.labelToId = new Map();
        /** tombstones */
        this.tombstones = new TombstoneLog();
        this.customEfSearch = null;
        /** monotonic sequence so we can rebuild label→id ordering after deserialize */
        this.seq = 1;
        this.initialized = false;
        this.closed = false;
        this.dimensions = config.dimensions;
        this.metric = config.metric;
        this.m = config.m ?? 16;
        this.efConstruction = config.efConstruction ?? 200;
        // precedence: explicit tier override > default per-metric
        this.efSearch = config.efSearch ?? (this.metric === 'cosine' ? 80 : 50);
        this.maxElements = config.maxElements ?? 10000;
    }
    /**
     * Initialize the WASM module and allocate an empty HNSW graph.
     * Idempotent — call after construction to be sure WASM is ready.
     */
    async init() {
        if (this.initialized)
            return;
        this.module = await loadHnswlib();
        this.allocateIndex(this.maxElements);
        this.fileHandle = `/haven-${randomSuffix()}.idx`;
        this.initialized = true;
    }
    /**
     * Allocate a fresh HNSW instance sized to at least `capacity`.
     * Existing graph is discarded if any.  Used both at init and after compact().
     */
    allocateIndex(capacity) {
        if (!this.module) {
            throw new Error('HnswBackedIndex: init() not called');
        }
        const space = spaceName(this.metric);
        const index = new this.module.HierarchicalNSW(space, this.dimensions, '');
        index.initIndex(capacity, this.m, this.efConstruction, 100);
        index.setEfSearch(this.customEfSearch ?? this.efSearch);
        this.index = index;
    }
    /** COSINE in hnswlib is `1 - cos_sim`, normalised vectors only. */
    has(_id) {
        this.assertReady();
        return Promise.resolve(this.idToLabel.has(_id));
    }
    size() {
        return this.idToLabel.size - this.tombstones.count();
    }
    getIdByLabel(label) {
        return this.labelToId.get(label) ?? null;
    }
    async upsert(id, vector) {
        this.assertReady();
        if (vector.length !== this.dimensions) {
            throw new Error(`HnswBackedIndex: dimension mismatch (expected ${this.dimensions}, got ${vector.length})`);
        }
        if (!Number.isFinite(this.sum(vector))) {
            throw new Error('HnswBackedIndex: vector contains NaN/Infinity');
        }
        const norm = this.metric === 'cosine' ? this.normalizeInPlace(vector) : vector;
        const existing = this.idToLabel.get(id);
        if (existing !== undefined) {
            // re-add at the same label; replaceDelete clears tombstone
            this.index.addPoint(norm, existing, true);
            this.tombstones.set(existing, 0);
            return existing;
        }
        const label = nextLabel();
        if (label + 1 > this.maxElements) {
            const newCap = Math.max(this.maxElements * 2, label + 1);
            this.index.resizeIndex(newCap);
            this.maxElements = newCap;
        }
        this.index.addPoint(norm, label, false);
        this.idToLabel.set(id, label);
        this.labelToId.set(label, id);
        this.seq++;
        return label;
    }
    async upsertBatch(items) {
        for (const { id, vector } of items) {
            await this.upsert(id, vector);
        }
    }
    async remove(id) {
        this.assertReady();
        const label = this.idToLabel.get(id);
        if (label === undefined)
            return false;
        if (this.tombstones.get(label)) {
            // already gone logically; report success
            return true;
        }
        this.index.markDelete(label);
        this.tombstones.set(label, 1);
        if (this.tombstones.count() > this.size() * 0.3) {
            // opportunistic compaction; cheap enough at moderate scale
            await this.compact();
        }
        return true;
    }
    /**
     * Rebuild the HNSW graph from live (non-tombstoned) entries.
     * Closes + re-allocs, reinserts vectors, preserves id↔label maps.
     */
    async compact() {
        this.assertReady();
        if (this.tombstones.count() === 0)
            return;
        if (this.size() === 0) {
            this.allocateIndex(this.maxElements);
            this.tombstones.clear();
            this.idToLabel.clear();
            this.labelToId.clear();
            return;
        }
        // capture live (id, normalized-vector) pairs before rebuilding
        const live = [];
        for (const [id, label] of this.idToLabel) {
            if (this.tombstones.get(label))
                continue;
            const vec = this.index.getPoint(label);
            const f32 = vec instanceof Float32Array ? vec : new Float32Array(vec);
            live.push({ id, label, vector: f32 });
        }
        // rebuild — fresh labels starting from 1 for determinism
        __labelSeq = 1;
        const newCap = Math.max(this.maxElements, live.length * 2);
        this.allocateIndex(newCap);
        this.maxElements = newCap;
        this.idToLabel.clear();
        this.labelToId.clear();
        this.tombstones.clear();
        for (const { id, vector } of live) {
            const label = nextLabel();
            this.index.addPoint(vector, label, false);
            this.idToLabel.set(id, label);
            this.labelToId.set(label, id);
        }
        this.seq++;
    }
    async search(query, k) {
        this.assertReady();
        if (query.length !== this.dimensions) {
            throw new Error(`HnswBackedIndex: query dimension mismatch (expected ${this.dimensions}, got ${query.length})`);
        }
        if (this.size() === 0)
            return [];
        if (this.metric === 'cosine') {
            query = new Float32Array(query);
            this.normalizeInPlace(query);
        }
        // Search a wider window to give the post-filter a fair shot.
        const live = this.size();
        const fetchK = Math.min(Math.max(k * 4, 64), live);
        if (fetchK <= 0)
            return [];
        const result = this.index.searchKnn(query, fetchK, undefined);
        const hits = [];
        const seen = new Set();
        for (let i = 0; i < result.neighbors.length; i++) {
            const label = result.neighbors[i];
            if (this.tombstones.get(label))
                continue;
            if (label === 0)
                continue;
            const id = this.labelToId.get(label);
            if (!id || seen.has(id))
                continue;
            seen.add(id);
            const dist = result.distances[i];
            hits.push({ id, score: distanceToScore(this.metric, dist) });
            if (hits.length >= k)
                break;
        }
        return hits;
    }
    serialize() {
        this.assertReady();
        return Promise.resolve().then(() => {
            const header = {
                backend: 'hnsw',
                metric: this.metric,
                dimensions: this.dimensions,
                m: this.m,
                efConstruction: this.efConstruction,
                efSearch: this.customEfSearch ?? this.efSearch,
                maxElements: this.maxElements,
                idMapCount: this.idToLabel.size,
                tombstoneCount: this.tombstones.count(),
                liveCount: this.size(),
                seq: this.seq,
            };
            const headerJson = JSON.stringify(header);
            const headerBytes = new TextEncoder().encode(headerJson);
            // Write HNSW bytes into MEMFS through hnswlib-wasm's writeIndex;
            // then readFile the bytes out.
            this.index.writeIndex(this.fileHandle);
            const raw = this.module.FS.readFile(this.fileHandle);
            const bodyBytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
            const tombBytes = this.tombstones.serialize();
            const out = new Uint8Array(HEADER_PREFIX_LEN + 4 + headerBytes.length + 4 + tombBytes.length + bodyBytes.length);
            out[0] = 0x02; // schema version
            const dv = new DataView(out.buffer);
            let off = 1;
            dv.setUint32(off, headerBytes.length, true);
            off += 4;
            out.set(headerBytes, off);
            off += headerBytes.length;
            dv.setUint32(off, tombBytes.length, true);
            off += 4;
            out.set(tombBytes, off);
            off += tombBytes.length;
            out.set(bodyBytes, off);
            // delete the temp file so MEMFS doesn't grow unboundedly
            try {
                this.module.FS.unlink(this.fileHandle);
            }
            catch {
                /* file may have been auto-cleaned */
            }
            return out;
        });
    }
    load(blob) {
        this.assertReady();
        const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
        if (blob.length < HEADER_PREFIX_LEN + 8) {
            throw new Error('HnswBackedIndex: blob too small');
        }
        if (blob[0] !== 0x02) {
            throw new Error(`HnswBackedIndex: unsupported blob version ${blob[0]}, expected 0x02`);
        }
        let off = 1;
        const headerLen = dv.getUint32(off, true);
        off += 4;
        const headerBytes = blob.slice(off, off + headerLen);
        off += headerLen;
        const header = JSON.parse(new TextDecoder().decode(headerBytes));
        if (header.dimensions !== this.dimensions) {
            throw new Error(`HnswBackedIndex: dimension mismatch in blob (${header.dimensions} vs ${this.dimensions})`);
        }
        const tombLen = dv.getUint32(off, true);
        off += 4;
        const tombBytes = blob.slice(off, off + tombLen);
        off += tombLen;
        const bodyBytes = blob.slice(off);
        // materialise the HNSW graph inside MEMFS
        this.module.FS.writeFile(this.fileHandle, bodyBytes);
        this.allocateIndex(header.maxElements);
        this.index.readIndex(this.fileHandle, header.maxElements);
        this.index.setEfSearch(header.efSearch);
        this.customEfSearch = header.efSearch;
        this.tombstones.load(tombBytes);
        // rebuild id↔label maps by scanning used labels
        this.idToLabel.clear();
        this.labelToId.clear();
        const used = this.index.getUsedLabels();
        // The library does not return the original string ids — we use a synthetic
        // "label-N" mapping.  In practice `IndexManager` re-hydrates the stable
        // ids by reading the in-IndexedDB vectors table (it owns the source of
        // truth).  This means: after load() the user MUST call
        // `IndexManager.rehydrateIdsFromStorage()` to bind real ids.
        for (const label of used) {
            this.labelToId.set(label, `__label-${label}`);
            this.idToLabel.set(`__label-${label}`, label);
        }
        this.seq = header.seq;
        // delete file from MEMFS to keep heap small
        try {
            this.module.FS.unlink(this.fileHandle);
        }
        catch {
            /* ignore */
        }
        return Promise.resolve();
    }
    async close() {
        if (this.closed)
            return;
        this.closed = true;
        if (this.index) {
            this.index = null;
        }
        if (this.module && this.fileHandle) {
            try {
                this.module.FS.unlink(this.fileHandle);
            }
            catch {
                /* ignore */
            }
        }
        this.fileHandle = null;
        this.idToLabel.clear();
        this.labelToId.clear();
        this.tombstones.clear();
    }
    stats() {
        return {
            backend: this.backend,
            dimensions: this.dimensions,
            metric: this.metric,
            live: this.size(),
            tombstoned: this.tombstones.count(),
            maxElements: this.maxElements,
        };
    }
    /* --------------- private helpers --------------- */
    assertReady() {
        if (this.closed)
            throw new Error('HnswBackedIndex: closed');
        if (!this.initialized || !this.index) {
            throw new Error('HnswBackedIndex: init() not called');
        }
    }
    sum(v) {
        let s = 0;
        for (let i = 0; i < v.length; i++)
            s += v[i];
        return s;
    }
    /** Returns the (now-mutated) vector so we avoid a copy in hot paths. */
    normalizeInPlace(v) {
        let norm = 0;
        for (let i = 0; i < v.length; i++)
            norm += v[i] * v[i];
        norm = Math.sqrt(norm);
        if (norm === 0)
            norm = 1;
        for (let i = 0; i < v.length; i++)
            v[i] = v[i] / norm;
        return v;
    }
}
function spaceName(metric) {
    if (metric === 'l2')
        return 'l2';
    if (metric === 'ip')
        return 'ip';
    return 'cosine';
}
function distanceToScore(metric, dist) {
    if (metric === 'l2')
        return 1 / (1 + dist);
    if (metric === 'ip')
        return 1 - dist;
    // cosine: distance is 1 - similarity, so score = 1 - dist
    return 1 - dist;
}
function randomSuffix() {
    return Math.random().toString(36).slice(2, 10);
}
//# sourceMappingURL=HnswBackedIndex.js.map