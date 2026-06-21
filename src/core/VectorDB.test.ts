/**
 * Tests for VectorDB core API
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VectorDB } from './VectorDB';
import type { VectorDBConfig } from './types';
import { createMockPipeline } from '../test/mocks/transformers.js';

// Mock @huggingface/transformers module
vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn().mockImplementation(async (task: string, model?: string, options?: any) => {
    return createMockPipeline({ dimensions: 384 });
  }),
  env: {
    allowLocalModels: true,
    useBrowserCache: false,
    allowRemoteModels: true,
    cacheDir: './.cache/huggingface',
  },
}));

describe('VectorDB', () => {
  let config: VectorDBConfig;
  let db: VectorDB;

  beforeEach(() => {
    const dbName = `test-db-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    config = {
      storage: { dbName },
      index: { dimensions: 384, metric: 'cosine', indexType: 'hnsw' },
      embedding: {
        model: 'Xenova/all-MiniLM-L6-v2',
        device: 'wasm',
        cache: true
      },
    };
  });

  afterEach(async () => {
    if (db) {
      await db.dispose();
    }
  });

  describe('Configuration and Initialization', () => {
    it('should create a VectorDB instance', () => {
      db = new VectorDB(config);
      expect(db).toBeInstanceOf(VectorDB);
    });

    it('should validate configuration on creation', () => {
      expect(() => new VectorDB({
        ...config,
        storage: { dbName: '' }
      })).toThrow('dbName');
    });

    it('should initialize successfully', async () => {
      db = new VectorDB(config);
      await db.initialize();
      const size = await db.size();
      expect(size).toBe(0);
    }, 30000);

    it('should allow multiple initialize calls', async () => {
      db = new VectorDB(config);
      await db.initialize();
      await db.initialize(); // Should not throw
      expect(await db.size()).toBe(0);
    }, 30000);

    it('should throw error when calling methods before initialization', async () => {
      db = new VectorDB(config);
      await expect(db.insert({ text: 'test' })).rejects.toThrow('not initialized');
    });
  });

  describe('Insert Operations', () => {
    beforeEach(async () => {
      db = new VectorDB(config);
      await db.initialize();
    }, 30000);

    it('should insert document with text', async () => {
      const id = await db.insert({
        text: 'Hello world',
        metadata: { title: 'Test Document' }
      });
      
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(await db.size()).toBe(1);
    }, 30000);

    it('should insert document with vector', async () => {
      const vector = new Float32Array(384).fill(0.1);
      const id = await db.insert({
        vector,
        metadata: { title: 'Vector Document' }
      });
      
      expect(id).toBeDefined();
      expect(await db.size()).toBe(1);
    }, 30000);

    it('should insert batch of documents', async () => {
      const ids = await db.insertBatch([
        { text: 'Document 1', metadata: { index: 1 } },
        { text: 'Document 2', metadata: { index: 2 } },
        { text: 'Document 3', metadata: { index: 3 } }
      ]);
      
      expect(ids).toHaveLength(3);
      expect(await db.size()).toBe(3);
    }, 30000);

    it('should throw error when inserting without text or vector', async () => {
      await expect(db.insert({ metadata: { title: 'Invalid' } }))
        .rejects.toThrow('vector or text');
    }, 30000);
  });

  describe('Search Operations', () => {
    beforeEach(async () => {
      db = new VectorDB(config);
      await db.initialize();
      
      // Insert test documents
      await db.insertBatch([
        { text: 'The quick brown fox', metadata: { category: 'animals' } },
        { text: 'Machine learning is fascinating', metadata: { category: 'tech' } },
        { text: 'A lazy dog sleeps', metadata: { category: 'animals' } }
      ]);
    }, 30000);

    it('should search with text query', async () => {
      const results = await db.search({
        text: 'fox and dog',
        k: 2
      });
      
      expect(results).toHaveLength(2);
      expect(results[0]).toHaveProperty('id');
      expect(results[0]).toHaveProperty('score');
      expect(results[0]).toHaveProperty('metadata');
    }, 30000);

    it('should search with vector query', async () => {
      const vector = new Float32Array(384).fill(0.1);
      const results = await db.search({
        vector,
        k: 3
      });
      
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(3);
    }, 30000);

    it('should throw error when searching without text or vector', async () => {
      await expect(db.search({ k: 5 }))
        .rejects.toThrow('vector or text');
    }, 30000);
  });

  describe('Delete and Update Operations', () => {
    let testId: string;

    beforeEach(async () => {
      db = new VectorDB(config);
      await db.initialize();
      testId = await db.insert({
        text: 'Test document',
        metadata: { title: 'Original' }
      });
    }, 30000);

    it('should delete document by id', async () => {
      const deleted = await db.delete(testId);
      expect(deleted).toBe(true);
      expect(await db.size()).toBe(0);
    }, 30000);

    it('should return false when deleting non-existent document', async () => {
      const deleted = await db.delete('non-existent-id');
      expect(deleted).toBe(false);
    }, 30000);

    it('should update document metadata', async () => {
      const updated = await db.update(testId, {
        metadata: { title: 'Updated' }
      });
      
      expect(updated).toBe(true);
    }, 30000);

    it('should update document with new text', async () => {
      const updated = await db.update(testId, {
        text: 'Updated text',
        metadata: { title: 'Updated' }
      });
      
      expect(updated).toBe(true);
    }, 30000);

    it('should return false when updating non-existent document', async () => {
      const updated = await db.update('non-existent-id', {
        metadata: { title: 'Updated' }
      });
      
      expect(updated).toBe(false);
    }, 30000);
  });

  describe('Utility Operations', () => {
    beforeEach(async () => {
      db = new VectorDB(config);
      await db.initialize();
    }, 30000);

    it('should clear all documents', async () => {
      await db.insertBatch([
        { text: 'Doc 1' },
        { text: 'Doc 2' },
        { text: 'Doc 3' }
      ]);
      
      expect(await db.size()).toBe(3);
      await db.clear();
      expect(await db.size()).toBe(0);
    }, 30000);

    it('should return correct size', async () => {
      expect(await db.size()).toBe(0);
      
      await db.insert({ text: 'Doc 1' });
      expect(await db.size()).toBe(1);
      
      await db.insert({ text: 'Doc 2' });
      expect(await db.size()).toBe(2);
    }, 30000);

    it('should export database', async () => {
      await db.insert({ text: 'Test document', metadata: { title: 'Test' } });
      
      const exportData = await db.export();
      
      expect(exportData).toHaveProperty('version');
      expect(exportData).toHaveProperty('config');
      expect(exportData).toHaveProperty('vectors');
      expect(exportData).toHaveProperty('index');
      expect(exportData.vectors).toHaveLength(1);
      expect(exportData.metadata.vectorCount).toBe(1);
    }, 30000);

    it('should import database', async () => {
      // Create and export data
      await db.insert({ text: 'Test document', metadata: { title: 'Test' } });
      const exportData = await db.export();
      
      // Clear and import
      await db.clear();
      expect(await db.size()).toBe(0);
      
      await db.import(exportData);
      expect(await db.size()).toBe(1);
    }, 30000);
  });

  describe('Enhanced Export and Import', () => {
    beforeEach(async () => {
      db = new VectorDB(config);
      await db.initialize();
    }, 30000);

    it('should export with progress callbacks', async () => {
      // Insert multiple documents
      await db.insertBatch([
        { text: 'Document 1', metadata: { title: 'Doc 1' } },
        { text: 'Document 2', metadata: { title: 'Doc 2' } },
        { text: 'Document 3', metadata: { title: 'Doc 3' } },
      ]);

      const progressUpdates: Array<{ loaded: number; total: number }> = [];
      const exportData = await db.export({
        onProgress: (loaded, total) => {
          progressUpdates.push({ loaded, total });
        },
      });

      expect(exportData.vectors).toHaveLength(3);
      expect(exportData.metadata.vectorCount).toBe(3);
      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[progressUpdates.length - 1].loaded).toBe(3);
    }, 30000);

    it('should export without index when specified', async () => {
      await db.insert({ text: 'Test document' });
      
      const exportData = await db.export({ includeIndex: false });
      
      expect(exportData.index).toBe('');
      expect(exportData.vectors).toHaveLength(1);
    }, 30000);

    it('should import with progress callbacks', async () => {
      // Create export data
      await db.insertBatch([
        { text: 'Document 1', metadata: { title: 'Doc 1' } },
        { text: 'Document 2', metadata: { title: 'Doc 2' } },
        { text: 'Document 3', metadata: { title: 'Doc 3' } },
      ]);
      const exportData = await db.export();

      // Clear and import with progress
      await db.clear();
      
      const progressUpdates: Array<{ loaded: number; total: number }> = [];
      await db.import(exportData, {
        onProgress: (loaded, total) => {
          progressUpdates.push({ loaded, total });
        },
      });

      expect(await db.size()).toBe(3);
      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[progressUpdates.length - 1].loaded).toBe(3);
    }, 30000);

    it('should validate export data schema', async () => {
      const invalidData = {
        version: '1.0.0',
        vectors: 'not an array',
        index: '',
        metadata: { exportedAt: Date.now(), vectorCount: 0, dimensions: 384 },
      } as any;

      await expect(db.import(invalidData)).rejects.toThrow('invalid vectors array');
    }, 30000);

    it('should validate dimension consistency during import', async () => {
      const invalidData = {
        version: '1.0.0',
        config: config,
        vectors: [],
        index: '',
        metadata: {
          exportedAt: Date.now(),
          vectorCount: 0,
          dimensions: 512, // Wrong dimensions
        },
      };

      await expect(db.import(invalidData)).rejects.toThrow('Dimension mismatch');
    }, 30000);

    it('should validate vector count matches', async () => {
      const invalidData = {
        version: '1.0.0',
        config: config,
        vectors: [
          { id: '1', vector: Array(384).fill(0.1), metadata: {}, timestamp: Date.now() },
        ],
        index: '',
        metadata: {
          exportedAt: Date.now(),
          vectorCount: 5, // Mismatch
          dimensions: 384,
        },
      };

      await expect(db.import(invalidData)).rejects.toThrow('Vector count mismatch');
    }, 30000);

    it('should validate version compatibility', async () => {
      const incompatibleData = {
        version: '2.0.0', // Major version mismatch
        config: config,
        vectors: [],
        index: '',
        metadata: {
          exportedAt: Date.now(),
          vectorCount: 0,
          dimensions: 384,
        },
      };

      await expect(db.import(incompatibleData)).rejects.toThrow('major version mismatch');
    }, 30000);

    it('should handle import without clearing existing data', async () => {
      // Insert initial data
      await db.insert({ text: 'Existing document', metadata: { title: 'Existing' } });
      
      // Create export data from another instance
      const exportData = {
        version: '1.0.0',
        config: config,
        vectors: [
          {
            id: 'imported-1',
            vector: Array(384).fill(0.2),
            metadata: { title: 'Imported' },
            timestamp: Date.now(),
          },
        ],
        index: '',
        metadata: {
          exportedAt: Date.now(),
          vectorCount: 1,
          dimensions: 384,
        },
      };

      await db.import(exportData, { clearExisting: false });
      
      // Should have both documents
      expect(await db.size()).toBe(2);
    }, 30000);

    it('should rebuild index if deserialization fails', async () => {
      await db.insert({ text: 'Test document' });
      const exportData = await db.export();
      
      // Corrupt the index data
      exportData.index = 'corrupted-index-data';
      
      await db.clear();
      
      // Should not throw, but rebuild index instead
      await db.import(exportData);
      
      expect(await db.size()).toBe(1);
      
      // Verify search still works
      const results = await db.search({ text: 'Test', k: 1 });
      expect(results).toHaveLength(1);
    }, 30000);

    it('should validate individual vector records during import', async () => {
      const invalidData = {
        version: '1.0.0',
        config: config,
        vectors: [
          { id: '1', vector: Array(384).fill(0.1), metadata: {}, timestamp: Date.now() },
          { id: '2', vector: Array(256).fill(0.1), metadata: {}, timestamp: Date.now() }, // Wrong dimensions
        ],
        index: '',
        metadata: {
          exportedAt: Date.now(),
          vectorCount: 2,
          dimensions: 384,
        },
      };

      await expect(db.import(invalidData)).rejects.toThrow('Dimension mismatch');
    }, 30000);

    it('should handle large dataset export with streaming', async () => {
      // Insert multiple documents
      const docs = Array.from({ length: 50 }, (_, i) => ({
        text: `Document ${i}`,
        metadata: { index: i },
      }));
      await db.insertBatch(docs);

      const exportData = await db.export({
        onProgress: (loaded, total) => {
          expect(loaded).toBeLessThanOrEqual(total);
          expect(total).toBe(50);
        },
      });

      expect(exportData.vectors).toHaveLength(50);
      expect(exportData.metadata.vectorCount).toBe(50);
    }, 30000);

    it('should preserve metadata during export/import cycle', async () => {
      const metadata = {
        title: 'Test Document',
        tags: ['test', 'export'],
        score: 0.95,
        nested: { key: 'value' },
      };

      await db.insert({ text: 'Test', metadata });
      const exportData = await db.export();
      
      await db.clear();
      await db.import(exportData);

      const results = await db.search({ text: 'Test', k: 1 });
      expect(results[0].metadata.title).toBe('Test Document');
      expect(results[0].metadata.tags).toEqual(['test', 'export']);
      expect(results[0].metadata.score).toBe(0.95);
      expect(results[0].metadata.nested).toEqual({ key: 'value' });
    }, 30000);

    it('should skip schema validation when disabled', async () => {
      await db.insert({ text: 'Test' });
      const exportData = await db.export();

      await db.clear();

      // Should not throw even with validation disabled
      await db.import(exportData, { validateSchema: false });
      expect(await db.size()).toBe(1);
    }, 30000);

    it('should yield vectors incrementally from exportStream, not as one batch', async () => {
      // Force a small chunk size so a true stream yields many vector chunks.
      const streamConfig: VectorDBConfig = {
        storage: { dbName: `stream-db-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` },
        index: { dimensions: 384, metric: 'cosine', indexType: 'hnsw' },
        embedding: { model: 'Xenova/all-MiniLM-L6-v2', device: 'wasm', cache: true },
        performance: { chunkSize: 10 } as any,
      };
      const streamingDb = new VectorDB(streamConfig);
      await streamingDb.initialize();

      // A corpus large enough to span several chunks at chunkSize 10.
      const docs = Array.from({ length: 50 }, (_, i) => ({
        text: `Document ${i}`,
        metadata: { index: i },
      }));
      await streamingDb.insertBatch(docs);

      const chunks: any[] = [];
      const progressUpdates: Array<{ loaded: number; total: number }> = [];
      for await (const chunk of streamingDb.exportStream({
        onProgress: (loaded, total) => progressUpdates.push({ loaded, total }),
      })) {
        chunks.push(chunk);
      }

      await streamingDb.dispose();

      const vectorChunks = chunks.filter((c) => c.type === 'vectors');
      const allVectors = vectorChunks.flatMap((c) => c.data);

      // The whole point of the fix: more than one vector chunk means the
      // stream yielded as the cursor advanced, rather than buffering all 50
      // into one array and yielding once at the end.
      expect(vectorChunks.length).toBeGreaterThan(1);
      expect(allVectors).toHaveLength(50);

      // Metadata + index chunks are present too.
      expect(chunks.find((c) => c.type === 'metadata')).toBeDefined();
      expect(chunks.find((c) => c.type === 'index')).toBeDefined();

      // Progress was reported as records streamed.
      expect(progressUpdates.length).toBeGreaterThan(0);
      const last = progressUpdates[progressUpdates.length - 1];
      expect(last.loaded).toBe(50);
      expect(last.total).toBe(50);
    }, 30000);

    it('should support breaking early out of exportStream without hanging', async () => {
      const streamConfig: VectorDBConfig = {
        storage: { dbName: `stream-early-db-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` },
        index: { dimensions: 384, metric: 'cosine', indexType: 'hnsw' },
        embedding: { model: 'Xenova/all-MiniLM-L6-v2', device: 'wasm', cache: true },
        performance: { chunkSize: 5 } as any,
      };
      const streamingDb = new VectorDB(streamConfig);
      await streamingDb.initialize();

      const docs = Array.from({ length: 30 }, (_, i) => ({
        text: `Document ${i}`,
        metadata: { index: i },
      }));
      await streamingDb.insertBatch(docs);

      let seen = 0;
      for await (const _chunk of streamingDb.exportStream()) {
        seen++;
        if (seen >= 2) break; // consumer abandons mid-stream
      }

      await streamingDb.dispose();
      expect(seen).toBeGreaterThanOrEqual(2);
    }, 30000);
  });

  describe('Resource Management', () => {
    it('should dispose resources properly', async () => {
      db = new VectorDB(config);
      await db.initialize();
      await db.insert({ text: 'Test' });
      
      await db.dispose();
      
      // Should throw after disposal
      await expect(db.size()).rejects.toThrow('not initialized');
    }, 30000);
  });
});
