/**
 * Stub of hnswlib-wasm used by the test runner. Functions are minimal
 * but the surface matches the bits Haven currently touches.
 *
 * Tests that need to assert ANN behaviour still exercise HnswBackedIndex
 * via a thin wrapper stored on `globalThis.__havenHnsw`.
 */

import { vi } from 'vitest';

interface FakeHierarchicalNSW {
  inputNames: string[];
  initIndex: ReturnType<typeof vi.fn>;
  addPoint: ReturnType<typeof vi.fn>;
  addPoints: ReturnType<typeof vi.fn>;
  addItems: ReturnType<typeof vi.fn>;
  markDelete: ReturnType<typeof vi.fn>;
  unmarkDelete: ReturnType<typeof vi.fn>;
  searchKnn: ReturnType<typeof vi.fn>;
  resizeIndex: ReturnType<typeof vi.fn>;
  getUsedLabels: ReturnType<typeof vi.fn>;
  getDeletedLabels: ReturnType<typeof vi.fn>;
  getPoint: ReturnType<typeof vi.fn>;
  getMaxElements: ReturnType<typeof vi.fn>;
  getCurrentCount: ReturnType<typeof vi.fn>;
  getNumDimensions: ReturnType<typeof vi.fn>;
  getEfSearch: ReturnType<typeof vi.fn>;
  setEfSearch: ReturnType<typeof vi.fn>;
  writeIndex: ReturnType<typeof vi.fn>;
  readIndex: ReturnType<typeof vi.fn>;
  isIndexInitialized: ReturnType<typeof vi.fn>;
}

interface FakeBruteforceSearch {
  addPoint: ReturnType<typeof vi.fn>;
  removePoint: ReturnType<typeof vi.fn>;
  searchKnn: ReturnType<typeof vi.fn>;
  getCurrentCount: ReturnType<typeof vi.fn>;
  getMaxElements: ReturnType<typeof vi.fn>;
  getNumDimensions: ReturnType<typeof vi.fn>;
  isIndexInitialized: ReturnType<typeof vi.fn>;
  initIndex: ReturnType<typeof vi.fn>;
  writeIndex: ReturnType<typeof vi.fn>;
  readIndex: ReturnType<typeof vi.fn>;
}

interface FakeSpace {
  distance: ReturnType<typeof vi.fn>;
  getNumDimensions: ReturnType<typeof vi.fn>;
}

export interface FakeHnswlibModule extends Record<string, unknown> {
  HierarchicalNSW: new (
    space: 'l2' | 'ip' | 'cosine',
    dims: number,
    name: string,
  ) => FakeHierarchicalNSW;
  BruteforceSearch: new (
    space: 'l2' | 'ip' | 'cosine',
    dims: number,
  ) => FakeBruteforceSearch;
  L2Space: new (dims: number) => FakeSpace;
  InnerProductSpace: new (dims: number) => FakeSpace;
  EmscriptenFileSystemManager: {
    initializeFileSystem: (t: 'IDBFS') => void;
    isInitialized: () => boolean;
    isSynced: () => boolean;
    setDebugLogs: (b: boolean) => void;
    checkFileExists: (name: string) => boolean;
    syncFS: (read: boolean, cb: () => void) => Promise<boolean>;
  };
  FS: {
    readFile: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
    unlink: ReturnType<typeof vi.fn>;
  };
  asm: {
    malloc: ReturnType<typeof vi.fn>;
    free: ReturnType<typeof vi.fn>;
  };
}

export function makeFakeHnswlibModule(): FakeHnswlibModule {
  const usedLabels: number[] = [];

  function makeIndex(space: 'l2' | 'ip' | 'cosine', dims: number): FakeHierarchicalNSW {
    const points = new Map<number, number[]>();
    const obsolete = new Set<number>();
    const idx: FakeHierarchicalNSW = {
      inputNames: [],
      initIndex: vi.fn(),
      addPoint: vi.fn((vec: number[] | Float32Array, label: number, replace: boolean) => {
        if (obsolete.has(label) && !replace) return;
        const arr = vec instanceof Float32Array ? Array.from(vec) : vec;
        points.set(label, arr);
        if (!usedLabels.includes(label)) usedLabels.push(label);
        obsolete.delete(label);
        return arr;
      }),
      addPoints: vi.fn((items: (number[] | Float32Array)[], labels: number[]) => {
        items.forEach((it, i) => idx.addPoint(it, labels[i], false));
      }),
      addItems: vi.fn((items: (number[] | Float32Array)[], replace: boolean) => {
        const resultLabels: number[] = [];
        items.forEach((it) => {
          const lbl = usedLabels.length ? Math.max(...usedLabels) + 1 : 1;
          idx.addPoint(it, lbl, replace);
          resultLabels.push(lbl);
        });
        return resultLabels;
      }),
      markDelete: vi.fn((label: number) => {
        obsolete.add(label);
      }),
      unmarkDelete: vi.fn((label: number) => {
        obsolete.delete(label);
      }),
      searchKnn: vi.fn((query: number[] | Float32Array, k: number) => {
        const q = query instanceof Float32Array ? Array.from(query) : query;
        const cands: Array<{ label: number; distance: number }> = [];
        for (const [label, vec] of points) {
          if (obsolete.has(label)) continue;
          let d = 0;
          const qn = norm(q);
          const vn = norm(vec);
          if (space === 'cosine') {
            let dot = 0;
            for (let i = 0; i < q.length; i++) dot += (q[i] / (qn || 1)) * (vec[i] / (vn || 1));
            d = 1 - dot;
          } else if (space === 'ip') {
            let dot = 0;
            for (let i = 0; i < q.length; i++) dot += q[i] * vec[i];
            d = 1 - dot;
          } else {
            for (let i = 0; i < q.length; i++) {
              const dv = q[i] - vec[i];
              d += dv * dv;
            }
          }
          cands.push({ label, distance: d });
        }
        cands.sort((a, b) => a.distance - b.distance);
        return {
          neighbors: cands.slice(0, k).map((c) => c.label),
          distances: cands.slice(0, k).map((c) => c.distance),
        };
      }),
      resizeIndex: vi.fn(),
      getUsedLabels: vi.fn(() => Array.from(points.keys())),
      getDeletedLabels: vi.fn(() => Array.from(obsolete)),
      getPoint: vi.fn((label: number) => points.get(label) ?? new Float32Array(dims)),
      getMaxElements: vi.fn(() => 1_000_000),
      getCurrentCount: vi.fn(() => points.size - obsolete.size),
      getNumDimensions: vi.fn(() => dims),
      getEfSearch: vi.fn(() => 50),
      setEfSearch: vi.fn(),
      writeIndex: vi.fn(() => {
        const blob = encodePoints(points, obsolete);
        return blob;
      }),
      readIndex: vi.fn(async () => true),
      isIndexInitialized: vi.fn(() => true),
    };
    return idx;
  }

  // Code-path memory: each HnswBackedIndex writes to `FS.writeFile(<handle>, ...)`
  // and reads back via `FS.readFile(<handle>)`.  The fake FSM keeps the
  // last-written buffer indexed by handle so writeIndex + readFile is a
  // round-trippable idempotent pair.
  const fileContents = new Map<string, Uint8Array>();

  function HierarchicalNSWCtor(this: unknown, space: 'l2' | 'ip' | 'cosine', dims: number): FakeHierarchicalNSW {
    return makeIndex(space, dims);
  }
  function BruteForceCtor(this: unknown, space: 'l2' | 'ip' | 'cosine', dims: number): FakeBruteforceSearch {
    const points = new Map<number, number[]>();
    const deleted = new Set<number>();
    const bf: FakeBruteforceSearch = {
      addPoint: vi.fn((vec: number[] | Float32Array, label: number) => {
        points.set(label, vec instanceof Float32Array ? Array.from(vec) : vec);
        deleted.delete(label);
      }),
      removePoint: vi.fn((label: number) => {
        points.delete(label);
        deleted.add(label);
      }),
      searchKnn: vi.fn((q: number[] | Float32Array, k: number) => {
        const arr = q instanceof Float32Array ? Array.from(q) : q;
        const cands: Array<{ label: number; distance: number }> = [];
        for (const [label, vec] of points) {
          let d = 0;
          for (let i = 0; i < arr.length; i++) {
            const dv = arr[i] - vec[i];
            d += dv * dv;
          }
          cands.push({ label, distance: d });
        }
        cands.sort((a, b) => a.distance - b.distance);
        return {
          neighbors: cands.slice(0, k).map((c) => c.label),
          distances: cands.slice(0, k).map((c) => c.distance),
        };
      }),
      getCurrentCount: vi.fn(() => points.size),
      getMaxElements: vi.fn(() => 1_000_000),
      getNumDimensions: vi.fn(() => dims),
      isIndexInitialized: vi.fn(() => true),
      initIndex: vi.fn(),
      writeIndex: vi.fn(),
      readIndex: vi.fn(async () => true),
    };
    void space;
    return bf;
  }

  return {
    HierarchicalNSW: HierarchicalNSWCtor as unknown as FakeHnswlibModule['HierarchicalNSW'],
    BruteforceSearch: BruteForceCtor as unknown as FakeHnswlibModule['BruteforceSearch'],
    L2Space: ((dims: number) => ({
      distance: vi.fn(() => 0),
      getNumDimensions: vi.fn(() => dims),
    })) as any,
    InnerProductSpace: ((dims: number) => ({
      distance: vi.fn(() => 0),
      getNumDimensions: vi.fn(() => dims),
    })) as any,
    EmscriptenFileSystemManager: {
      initializeFileSystem: vi.fn() as any,
      isInitialized: vi.fn(() => true),
      isSynced: vi.fn(() => false),
      setDebugLogs: vi.fn() as any,
      checkFileExists: vi.fn((name: string) => fileContents.has(name)),
      syncFS: vi.fn(async () => true) as any,
    },
    FS: {
      readFile: vi.fn((name: string) => {
        return fileContents.get(name) ?? new Uint8Array();
      }),
      writeFile: vi.fn((name: string, data: Uint8Array) => {
        fileContents.set(name, data);
      }),
      unlink: vi.fn((name: string) => {
        fileContents.delete(name);
      }),
    },
    asm: {
      malloc: vi.fn(() => 1),
      free: vi.fn(),
    },
  };
}

function norm(v: number[]): number {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}

function encodePoints(points: Map<number, number[]>, dead: Set<number>): string {
  return JSON.stringify({
    points: Array.from(points.entries()),
    dead: Array.from(dead),
  });
}

void encodePoints;
