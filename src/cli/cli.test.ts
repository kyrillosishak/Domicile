/**
 * CLI smoke tests. Covers the pure-logic commands (init scaffold, help flags,
 * bench size parsing) without spinning up the full browser-born engine, which
 * needs WASM + IndexedDB shims and is exercised end-to-end in the example
 * scripts instead.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cmdInit } from './commands/init.js';
import { cmdCapabilities } from './commands/capabilities.js';
import { cmdBench } from './commands/bench.js';
import { looksLikeNdjson, parseNdjson } from './commands/import.js';

describe('domicile CLI', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'domicile-cli-'));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('init', () => {
    it('scaffolds a legal template with createDomicile wired', async () => {
      const code = await cmdInit(['--template', 'legal', '--out', tmpDir]);
      expect(code).toBe(0);
      expect(existsSync(join(tmpDir, 'index.ts'))).toBe(true);
      expect(existsSync(join(tmpDir, 'README.md'))).toBe(true);
      expect(existsSync(join(tmpDir, 'package.snippet.json'))).toBe(true);

      const entry = readFileSync(join(tmpDir, 'index.ts'), 'utf-8');
      expect(entry).toContain('createDomicile');
      expect(entry).toContain("indexType: 'hnsw'");
      expect(entry).toContain("'Xenova/all-MiniLM-L6-v2'");
      // Legal template carries a matter scope.
      expect(entry).toMatch(/matter|scope|M-DEMO/);
    }, 10000);

    it('scaffolds the blank template without a matter scope', async () => {
      const code = await cmdInit(['--template', 'blank', '--out', tmpDir]);
      expect(code).toBe(0);
      const entry = readFileSync(join(tmpDir, 'index.ts'), 'utf-8');
      expect(entry).toContain('createDomicile');
      expect(entry).not.toMatch(/M-DEMO|PATIENT-DEMO/);
    }, 10000);

    it('rejects an unknown template', async () => {
      const code = await cmdInit(['--template', 'finance', '--out', tmpDir]);
      expect(code).toBe(1);
    }, 10000);

    it('prints help and exits 0', async () => {
      const code = await cmdInit(['--help']);
      expect(code).toBe(0);
    }, 10000);
  });

  describe('capabilities', () => {
    it('prints human-readable capabilities', async () => {
      const code = await cmdCapabilities([]);
      expect(code).toBe(0);
    }, 10000);

    it('prints JSON when --json', async () => {
      const code = await cmdCapabilities(['--json']);
      expect(code).toBe(0);
    }, 10000);
  });

  describe('bench', () => {
    it('prints help and exits 0', async () => {
      const code = await cmdBench(['--help']);
      expect(code).toBe(0);
    }, 10000);
  });

  describe('import — NDJSON stream parsing', () => {
    const ndjson = [
      JSON.stringify({
        type: 'metadata',
        data: {
          version: '1.0.0',
          config: { storage: { dbName: 'm', version: 1 } },
          metadata: { exportedAt: 123, vectorCount: 2, dimensions: 4 },
        },
      }),
      JSON.stringify({
        type: 'vectors',
        data: [
          { id: 'a', vector: [1, 0, 0, 0], metadata: {}, timestamp: 1 },
          { id: 'b', vector: [0, 1, 0, 0], metadata: {}, timestamp: 2 },
        ],
      }),
      JSON.stringify({ type: 'index', data: 'IDXBLOB' }),
    ].join('\n');

    it('detects NDJSON vs single-object JSON', () => {
      expect(looksLikeNdjson(ndjson)).toBe(true);
      expect(looksLikeNdjson(JSON.stringify({ version: '1.0.0', vectors: [] }))).toBe(false);
      // pretty-printed single object (many lines, none a complete `{...}`) is not NDJSON
      expect(looksLikeNdjson(JSON.stringify({ version: '1.0.0', vectors: [] }, null, 2))).toBe(false);
    });

    it('reassembles metadata + vectors + index from an NDJSON stream', () => {
      const data = parseNdjson(ndjson);
      expect(data.version).toBe('1.0.0');
      expect(data.metadata.dimensions).toBe(4);
      expect(data.metadata.vectorCount).toBe(2);
      expect(data.vectors).toHaveLength(2);
      expect(data.vectors[0].id).toBe('a');
      expect(data.index).toBe('IDXBLOB');
    });

    it('infers vectorCount when the metadata header omits it', () => {
      const noCount = ndjson.replace('"vectorCount":2', '"vectorCount":0');
      const data = parseNdjson(noCount);
      expect(data.metadata.vectorCount).toBe(2);
    });
  });
});
