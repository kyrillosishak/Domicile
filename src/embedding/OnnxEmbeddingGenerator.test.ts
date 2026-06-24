import { describe, it, expect, vi } from 'vitest';
import { OnnxEmbeddingGenerator, type OnnxEmbeddingGeneratorConfig, type OnnxModelSpec } from './OnnxEmbeddingGenerator';

describe('OnnxEmbeddingGenerator', () => {
  describe('config types', () => {
    it('should accept string model spec', () => {
      const config: OnnxEmbeddingGeneratorConfig = {
        model: 'Xenova/all-MiniLM-L6-v2',
      };
      expect(config.model).toBe('Xenova/all-MiniLM-L6-v2');
    });

    it('should accept object model spec', () => {
      const config: OnnxEmbeddingGeneratorConfig = {
        model: { repo: 'Xenova/all-MiniLM-L6-v2', file: 'model.onnx', dimensions: 384 },
      };
      expect(typeof config.model).toBe('object');
      if (typeof config.model === 'object') {
        expect(config.model.repo).toBe('Xenova/all-MiniLM-L6-v2');
      }
    });

    it('should accept optional config fields', () => {
      const config: OnnxEmbeddingGeneratorConfig = {
        model: 'test-model',
        preloadedWeightsBytes: new Uint8Array([1, 2, 3]),
        allowRemote: false,
        threads: 4,
        forceTier: 'wasm',
        maxRetries: 5,
        retryDelayMs: 1000,
      };
      expect(config.allowRemote).toBe(false);
      expect(config.threads).toBe(4);
      expect(config.forceTier).toBe('wasm');
      expect(config.maxRetries).toBe(5);
      expect(config.retryDelayMs).toBe(1000);
    });
  });

  describe('OnnxModelSpec', () => {
    it('should have all required and optional fields', () => {
      const spec: OnnxModelSpec = {
        repo: 'test/repo',
        file: 'model.onnx',
        dimensions: 384,
        quantized: 'fp16',
        baseUrl: 'https://custom-host.com',
      };
      expect(spec.repo).toBe('test/repo');
      expect(spec.file).toBe('model.onnx');
      expect(spec.dimensions).toBe(384);
      expect(spec.quantized).toBe('fp16');
      expect(spec.baseUrl).toBe('https://custom-host.com');
    });

    it('should work with minimal fields', () => {
      const spec: OnnxModelSpec = { repo: 'test/repo' };
      expect(spec.repo).toBe('test/repo');
      expect(spec.file).toBeUndefined();
    });
  });
});