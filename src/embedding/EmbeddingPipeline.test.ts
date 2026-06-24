import { describe, it, expect, beforeEach, vi } from 'vitest';
import { selectTier, configureOrtForTier, detectPipeline, threadsAvailable, probeWasmSimd, ExecutionTier } from './EmbeddingPipeline';

describe('EmbeddingPipeline', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (globalThis as any).__havenEmbeddingPipeline;
    vi.stubGlobal('WebAssembly', { Module: vi.fn(), validate: vi.fn() });
    vi.stubGlobal('Atomics', {});
    vi.stubGlobal('SharedArrayBuffer', class {});
    vi.stubGlobal('crossOriginIsolated', true);
    vi.stubGlobal('navigator', {
      hardwareConcurrency: 4,
      gpu: undefined,
      ml: undefined,
    });
  });

  describe('probeWasmSimd', () => {
    it('should return true when WebAssembly is available', () => {
      expect(probeWasmSimd()).toBe(true);
    });

    it('should return false when WebAssembly is not available', () => {
      vi.stubGlobal('WebAssembly', undefined);
      expect(probeWasmSimd()).toBe(false);
    });
  });

  describe('threadsAvailable', () => {
    it('should return true when Atomics and SharedArrayBuffer are available', () => {
      expect(threadsAvailable()).toBe(true);
    });

    it('should return false when Atomics is not available', () => {
      vi.stubGlobal('Atomics', undefined);
      expect(threadsAvailable()).toBe(false);
    });

    it('should return false when SharedArrayBuffer is not available', () => {
      vi.stubGlobal('SharedArrayBuffer', undefined);
      expect(threadsAvailable()).toBe(false);
    });

    it('should return false when crossOriginIsolated is false', () => {
      vi.stubGlobal('crossOriginIsolated', false);
      expect(threadsAvailable()).toBe(false);
    });
  });

  describe('detectPipeline', () => {
    it('should return a PipelineDescribe object', () => {
      const result = detectPipeline();
      expect(result).toHaveProperty('tier');
      expect(result).toHaveProperty('threads');
      expect(result).toHaveProperty('modulesLoaded');
      expect(result).toHaveProperty('wasmPaths');
      expect(typeof result.tier).toBe('string');
      expect(typeof result.threads).toBe('number');
      expect(typeof result.modulesLoaded).toBe('boolean');
    });

    it('should default to wasm tier when SIMD not available', () => {
      vi.stubGlobal('WebAssembly', undefined);
      const result = detectPipeline();
      expect(result.tier).toBe('wasm');
    });

    it('should use hardwareConcurrency for threads when available', () => {
      const result = detectPipeline();
      expect(result.threads).toBeGreaterThanOrEqual(1);
    });
  });

  describe('selectTier', () => {
    it('should return cached result on second call', async () => {
      const first = await selectTier();
      const second = await selectTier();
      expect(first).toBe(second);
    });

    it('should return a valid ExecutionTier', async () => {
      const result = await selectTier();
      const validTiers: ExecutionTier[] = ['webnn', 'webgpu', 'wasm-simd', 'wasm'];
      expect(validTiers).toContain(result.tier);
    });

    it('should have threads configured for wasm-simd', async () => {
      const result = await selectTier();
      if (result.tier === 'wasm-simd') {
        expect(result.threads).toBeGreaterThan(1);
      }
    });
  });

  describe('configureOrtForTier', () => {
    it('should not throw when called', async () => {
      const pipeline = await selectTier();
      await expect(configureOrtForTier(pipeline)).resolves.not.toThrow();
    });
  });
});