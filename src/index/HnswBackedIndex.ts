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

import {
  loadHnswlib,
  type HnswlibModule,
  type HierarchicalNSW,
} from 'hnswlib-wasm';
import {
  type BackedIndex,
  type BackedIndexConfig,
  type BackendName,
  type MetricName,
  type SearchHit,
  type BackedIndexStats,
} from './BackedIndex';
import { TombstoneLog } from './TombstoneLog';

const MAX_LABEL = 2 ** 31 - 2;
let __labelSeq = 1;
function nextLabel(): number {
  // monotonic, never 0 (we reserve 0 as "invalid")
  if (__labelSeq >= MAX_LABEL) __labelSeq = 1;
  return __labelSeq++;
}

interface PersistedHeader {
  backend: BackendName;
  metric: MetricName;
  dimensions: number;
  m: number;
  efConstruction: number;
  efSearch: number;
  maxElements: number;
  idMapCount: number;
  tombstoneCount: number;
  liveCount: number;
  seq: number;
}

const HEADER_PREFIX_LEN = 1; // first byte = schema version (0x02)

export class HnswBackedIndex implements BackedIndex {
  public readonly backend: BackendName = 'hnsw';
  public readonly dimensions: number;
  public readonly metric: MetricName;

  private module: HnswlibModule | null = null;
  private index: HierarchicalNSW | null = null;
  private fileHandle: string | null = null;

  /** stable id → numeric label */
  private idToLabel = new Map<string, number>();
  /** numeric label → stable id (inverted for has() / remove() / compact()) */
  private labelToId = new Map<number, string>();
  /** tombstones */
  public readonly tombstones = new TombstoneLog();

  private m: number;
  private efConstruction: number;
  private efSearch: number;
  private maxElements: number;
  private customEfSearch: number | null = null;

  /** monotonic sequence so we can rebuild label→id ordering after deserialize */
  private seq = 1;
  private initialized = false;
  private closed = false;

  constructor(config: BackedIndexConfig) {
    this.dimensions = config.dimensions;
    this.metric = config.metric;
    this.m = config.m ?? 16;
    this.efConstruction = config.efConstruction ?? 200;
    // precedence: explicit tier override > default per-metric
    this.efSearch = config.efSearch ?? (this.metric === 'cosine' ? 80 : 50);
    this.maxElements = config.maxElements ?? 10_000;
  }
  /**
   * Initialize the WASM module and allocate an empty HNSW graph.
   * Idempotent — call after construction to be sure WASM is ready.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.module = await loadHnswlib();
    this.allocateIndex(this.maxElements);
    this.fileHandle = `/haven-${randomSuffix()}.idx`;
    this.initialized = true;
  }

  /**
   * Allocate a fresh HNSW instance sized to at least `capacity`.
   * Existing graph is discarded if any.  Used both at init and after compact().
   */
  private allocateIndex(capacity: number): void {
    if (!this.module) {
      throw new Error('HnswBackedIndex: init() not called');
    }
    const space = spaceName(this.metric);
    const index = new this.module.HierarchicalNSW(
      space,
      this.dimensions,
      '', // no autoSaveFilename — we manage FS ourselves
    );
    index.initIndex(capacity, this.m, this.efConstruction, 100);
    index.setEfSearch(this.customEfSearch ?? this.efSearch);
    this.index = index;
  }

  /** COSINE in hnswlib is `1 - cos_sim`, normalised vectors only. */
  has(_id: string): Promise<boolean> {
    this.assertReady();
    return Promise.resolve(this.idToLabel.has(_id));
  }

  size(): number {
    return this.idToLabel.size - this.tombstones.count();
  }

  getIdByLabel(label: number): string | null {
    return this.labelToId.get(label) ?? null;
  }

  async upsert(id: string, vector: Float32Array): Promise<number> {
    this.assertReady();
    if (vector.length !== this.dimensions) {
      throw new Error(
        `HnswBackedIndex: dimension mismatch (expected ${this.dimensions}, got ${vector.length})`,
      );
    }
    if (!Number.isFinite(this.sum(vector))) {
      throw new Error('HnswBackedIndex: vector contains NaN/Infinity');
    }

    const norm = this.metric === 'cosine' ? this.normalizeInPlace(vector) : vector;
    const existing = this.idToLabel.get(id);
    if (existing !== undefined) {
      // re-add at the same label; replaceDelete clears tombstone
      this.index!.addPoint(norm, existing, true);
      this.tombstones.set(existing, 0);
      return existing;
    }
    const label = nextLabel();
    if (label + 1 > this.maxElements) {
      const newCap = Math.max(this.maxElements * 2, label + 1);
      this.index!.resizeIndex(newCap);
      this.maxElements = newCap;
    }
    this.index!.addPoint(norm, label, false);
    this.idToLabel.set(id, label);
    this.labelToId.set(label, id);
    this.seq++;
    return label;
  }

  async upsertBatch(
    items: Array<{ id: string; vector: Float32Array }>,
  ): Promise<void> {
    for (const { id, vector } of items) {
      await this.upsert(id, vector);
    }
  }

  async remove(id: string): Promise<boolean> {
    this.assertReady();
    const label = this.idToLabel.get(id);
    if (label === undefined) return false;
    if (this.tombstones.get(label)) {
      // already gone logically; report success
      return true;
    }
    this.index!.markDelete(label);
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
  async compact(): Promise<void> {
    this.assertReady();
    if (this.tombstones.count() === 0) return;
    if (this.size() === 0) {
      this.allocateIndex(this.maxElements);
      this.tombstones.clear();
      this.idToLabel.clear();
      this.labelToId.clear();
      return;
    }

    // capture live (id, normalized-vector) pairs before rebuilding
    const live: Array<{ id: string; label: number; vector: Float32Array }> = [];
    for (const [id, label] of this.idToLabel) {
      if (this.tombstones.get(label)) continue;
      const vec = this.index!.getPoint(label) as Float32Array | number[];
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
      this.index!.addPoint(vector as Float32Array, label, false);
      this.idToLabel.set(id, label);
      this.labelToId.set(label, id);
    }
    this.seq++;
  }

  async search(query: Float32Array, k: number): Promise<SearchHit[]> {
    this.assertReady();
    if (query.length !== this.dimensions) {
      throw new Error(
        `HnswBackedIndex: query dimension mismatch (expected ${this.dimensions}, got ${query.length})`,
      );
    }
    if (this.size() === 0) return [];

    if (this.metric === 'cosine') {
      query = new Float32Array(query);
      this.normalizeInPlace(query);
    }

    // Search a wider window to give the post-filter a fair shot.
    const live = this.size();
    const fetchK = Math.min(Math.max(k * 4, 64), live);
    if (fetchK <= 0) return [];

    const result = this.index!.searchKnn(query, fetchK, undefined);

    const hits: SearchHit[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < result.neighbors.length; i++) {
      const label = result.neighbors[i];
      if (this.tombstones.get(label)) continue;
      if (label === 0) continue;
      const id = this.labelToId.get(label);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const dist = result.distances[i];
      hits.push({ id, score: distanceToScore(this.metric, dist) });
      if (hits.length >= k) break;
    }
    return hits;
  }

  serialize(): Promise<Uint8Array> {
    this.assertReady();
    return Promise.resolve().then(() => {
      const header: PersistedHeader = {
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
      this.index!.writeIndex(this.fileHandle!);
      const raw = this.module!.FS.readFile(this.fileHandle);
      const bodyBytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw as ArrayBuffer);

      const tombBytes = this.tombstones.serialize();

      const out = new Uint8Array(
        HEADER_PREFIX_LEN + 4 + headerBytes.length + 4 + tombBytes.length + bodyBytes.length,
      );
      out[0] = 0x02; // schema version
      const dv = new DataView(out.buffer);
      let off = 1;
      dv.setUint32(off, headerBytes.length, true); off += 4;
      out.set(headerBytes, off); off += headerBytes.length;
      dv.setUint32(off, tombBytes.length, true); off += 4;
      out.set(tombBytes, off); off += tombBytes.length;
      out.set(bodyBytes, off);

      // delete the temp file so MEMFS doesn't grow unboundedly
      try {
        this.module!.FS.unlink(this.fileHandle);
      } catch {
        /* file may have been auto-cleaned */
      }

      return out;
    });
  }

  load(blob: Uint8Array): Promise<void> {
    this.assertReady();
    const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
    if (blob.length < HEADER_PREFIX_LEN + 8) {
      throw new Error('HnswBackedIndex: blob too small');
    }
    if (blob[0] !== 0x02) {
      throw new Error(
        `HnswBackedIndex: unsupported blob version ${blob[0]}, expected 0x02`,
      );
    }
    let off = 1;
    const headerLen = dv.getUint32(off, true); off += 4;
    const headerBytes = blob.slice(off, off + headerLen); off += headerLen;
    const header = JSON.parse(new TextDecoder().decode(headerBytes)) as PersistedHeader;

    if (header.dimensions !== this.dimensions) {
      throw new Error(
        `HnswBackedIndex: dimension mismatch in blob (${header.dimensions} vs ${this.dimensions})`,
      );
    }

    const tombLen = dv.getUint32(off, true); off += 4;
    const tombBytes = blob.slice(off, off + tombLen); off += tombLen;
    const bodyBytes = blob.slice(off);

    // materialise the HNSW graph inside MEMFS
    this.module!.FS.writeFile(this.fileHandle!, bodyBytes);
    this.allocateIndex(header.maxElements);
    this.index!.readIndex(this.fileHandle!, header.maxElements);
    this.index!.setEfSearch(header.efSearch);
    this.customEfSearch = header.efSearch;
    this.tombstones.load(tombBytes);
    // rebuild id↔label maps by scanning used labels
    this.idToLabel.clear();
    this.labelToId.clear();
    const used = this.index!.getUsedLabels();
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
      this.module!.FS.unlink(this.fileHandle!);
    } catch {
      /* ignore */
    }
    return Promise.resolve();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.index) {
      this.index = null;
    }
    if (this.module && this.fileHandle) {
      try {
        this.module.FS.unlink(this.fileHandle);
      } catch {
        /* ignore */
      }
    }
    this.fileHandle = null;
    this.idToLabel.clear();
    this.labelToId.clear();
    this.tombstones.clear();
  }

  stats(): BackedIndexStats {
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

  private assertReady(): void {
    if (this.closed) throw new Error('HnswBackedIndex: closed');
    if (!this.initialized || !this.index) {
      throw new Error('HnswBackedIndex: init() not called');
    }
  }

  private sum(v: Float32Array): number {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i];
    return s;
  }

  /** Returns the (now-mutated) vector so we avoid a copy in hot paths. */
  private normalizeInPlace(v: Float32Array): Float32Array {
    let norm = 0;
    for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    if (norm === 0) norm = 1;
    for (let i = 0; i < v.length; i++) v[i] = v[i] / norm;
    return v;
  }
}

function spaceName(metric: MetricName): 'cosine' | 'l2' | 'ip' {
  if (metric === 'l2') return 'l2';
  if (metric === 'ip') return 'ip';
  return 'cosine';
}

function distanceToScore(metric: MetricName, dist: number): number {
  if (metric === 'l2') return 1 / (1 + dist);
  if (metric === 'ip') return 1 - dist;
  // cosine: distance is 1 - similarity, so score = 1 - dist
  return 1 - dist;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}
