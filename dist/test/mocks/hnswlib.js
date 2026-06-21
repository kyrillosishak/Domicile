/**
 * Stub of hnswlib-wasm used by the test runner. Functions are minimal
 * but the surface matches the bits Haven currently touches.
 *
 * Tests that need to assert ANN behaviour still exercise HnswBackedIndex
 * via a thin wrapper stored on `globalThis.__havenHnsw`.
 */
import { vi } from 'vitest';
export function makeFakeHnswlibModule() {
    const usedLabels = [];
    function makeIndex(space, dims) {
        const points = new Map();
        const obsolete = new Set();
        const idx = {
            inputNames: [],
            initIndex: vi.fn(),
            addPoint: vi.fn((vec, label, replace) => {
                if (obsolete.has(label) && !replace)
                    return;
                const arr = vec instanceof Float32Array ? Array.from(vec) : vec;
                points.set(label, arr);
                if (!usedLabels.includes(label))
                    usedLabels.push(label);
                obsolete.delete(label);
                return arr;
            }),
            addPoints: vi.fn((items, labels) => {
                items.forEach((it, i) => idx.addPoint(it, labels[i], false));
            }),
            addItems: vi.fn((items, replace) => {
                const resultLabels = [];
                items.forEach((it) => {
                    const lbl = usedLabels.length ? Math.max(...usedLabels) + 1 : 1;
                    idx.addPoint(it, lbl, replace);
                    resultLabels.push(lbl);
                });
                return resultLabels;
            }),
            markDelete: vi.fn((label) => {
                obsolete.add(label);
            }),
            unmarkDelete: vi.fn((label) => {
                obsolete.delete(label);
            }),
            searchKnn: vi.fn((query, k) => {
                const q = query instanceof Float32Array ? Array.from(query) : query;
                const cands = [];
                for (const [label, vec] of points) {
                    if (obsolete.has(label))
                        continue;
                    let d = 0;
                    const qn = norm(q);
                    const vn = norm(vec);
                    if (space === 'cosine') {
                        let dot = 0;
                        for (let i = 0; i < q.length; i++)
                            dot += (q[i] / (qn || 1)) * (vec[i] / (vn || 1));
                        d = 1 - dot;
                    }
                    else if (space === 'ip') {
                        let dot = 0;
                        for (let i = 0; i < q.length; i++)
                            dot += q[i] * vec[i];
                        d = 1 - dot;
                    }
                    else {
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
            getPoint: vi.fn((label) => points.get(label) ?? new Float32Array(dims)),
            getMaxElements: vi.fn(() => 1000000),
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
    const fileContents = new Map();
    function HierarchicalNSWCtor(space, dims) {
        return makeIndex(space, dims);
    }
    function BruteForceCtor(space, dims) {
        const points = new Map();
        const deleted = new Set();
        const bf = {
            addPoint: vi.fn((vec, label) => {
                points.set(label, vec instanceof Float32Array ? Array.from(vec) : vec);
                deleted.delete(label);
            }),
            removePoint: vi.fn((label) => {
                points.delete(label);
                deleted.add(label);
            }),
            searchKnn: vi.fn((q, k) => {
                const arr = q instanceof Float32Array ? Array.from(q) : q;
                const cands = [];
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
            getMaxElements: vi.fn(() => 1000000),
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
        HierarchicalNSW: HierarchicalNSWCtor,
        BruteforceSearch: BruteForceCtor,
        L2Space: ((dims) => ({
            distance: vi.fn(() => 0),
            getNumDimensions: vi.fn(() => dims),
        })),
        InnerProductSpace: ((dims) => ({
            distance: vi.fn(() => 0),
            getNumDimensions: vi.fn(() => dims),
        })),
        EmscriptenFileSystemManager: {
            initializeFileSystem: vi.fn(),
            isInitialized: vi.fn(() => true),
            isSynced: vi.fn(() => false),
            setDebugLogs: vi.fn(),
            checkFileExists: vi.fn((name) => fileContents.has(name)),
            syncFS: vi.fn(async () => true),
        },
        FS: {
            readFile: vi.fn((name) => {
                return fileContents.get(name) ?? new Uint8Array();
            }),
            writeFile: vi.fn((name, data) => {
                fileContents.set(name, data);
            }),
            unlink: vi.fn((name) => {
                fileContents.delete(name);
            }),
        },
        asm: {
            malloc: vi.fn(() => 1),
            free: vi.fn(),
        },
    };
}
function norm(v) {
    let s = 0;
    for (const x of v)
        s += x * x;
    return Math.sqrt(s);
}
function encodePoints(points, dead) {
    return JSON.stringify({
        points: Array.from(points.entries()),
        dead: Array.from(dead),
    });
}
void encodePoints;
//# sourceMappingURL=hnswlib.js.map