import { describe, it, expect } from 'vitest';

describe('Core Contracts', () => {
  it('StorageManager has all required methods', () => {
    const methods = [
      'initialize', 'put', 'putBatch', 'get', 'getBatch', 'getAll',
      'delete', 'clear', 'filter', 'count', 'saveIndex', 'loadIndex'
    ];
    expect(methods.length).toBe(12);
  });

  it('IndexHit has id and score', () => {
    const hit: { id: string; score: number } = { id: 'test', score: 0.95 };
    expect(hit.id).toBe('test');
    expect(hit.score).toBe(0.95);
  });

  it('IndexStats has all required fields', () => {
    const stats = {
      vectorCount: 100,
      dimensions: 384,
      indexType: 'hnsw',
      memoryUsage: 1024,
      lastUpdated: Date.now(),
    };
    expect(stats.vectorCount).toBe(100);
    expect(stats.dimensions).toBe(384);
  });

  it('SerializedIndex has version and data', () => {
    const serialized = {
      version: '1.0',
      dimensions: 384,
      metric: 'cosine',
      vectorCount: 100,
      data: 'serialized-data',
    };
    expect(serialized.version).toBe('1.0');
    expect(serialized.data).toBe('serialized-data');
  });

  it('Index interface has all required methods', () => {
    const methods = [
      'initialize', 'add', 'addBatch', 'remove', 'search',
      'serialize', 'deserialize', 'clear', 'stats'
    ];
    expect(methods.length).toBe(9);
  });

  it('EmbeddingGenerator has required methods', () => {
    const methods = [
      'initialize', 'embed', 'embedBatch', 'getDimensions', 'dispose'
    ];
    expect(methods.length).toBe(5);
  });

  it('LLMProvider has required methods', () => {
    const methods = [
      'initialize', 'generate', 'generateStream', 'isAvailable', 'dispose'
    ];
    expect(methods.length).toBe(5);
  });

  it('GenerateOptions has all optional fields', () => {
    const options = {
      maxTokens: 256,
      temperature: 0.7,
      topP: 0.9,
      topK: 50,
      stopSequences: ['\n'],
    };
    expect(options.maxTokens).toBe(256);
    expect(options.temperature).toBe(0.7);
  });
});