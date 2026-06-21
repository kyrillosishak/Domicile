/**
 * Tests for ModelRegistry — curated catalog + init/pre-flight gating
 * (TECHNICAL_VALIDATION risk #10).
 */

import { describe, it, expect } from 'vitest';
import { ModelRegistry, getModelRegistry } from './ModelRegistry';
import type { Capabilities } from './capabilities';
import { DimensionMismatchError } from '../errors';

function caps(overrides: Partial<Capabilities> = {}): Capabilities {
  return {
    webgpu: true,
    wasm: true,
    simd: true,
    sharedArrayBuffer: true,
    indexedDB: true,
    deviceMemoryGB: 8,
    deviceTier: 'mid',
    ...overrides,
  };
}

describe('ModelRegistry', () => {
  describe('catalog', () => {
    it('ships a non-empty curated catalog', () => {
      const r = new ModelRegistry();
      expect(r.listEmbeddingModels().length).toBeGreaterThan(0);
      expect(r.listLLMModels().length).toBeGreaterThan(0);
    });

    it('knows all-MiniLM-L6-v2 is 384d', () => {
      const r = new ModelRegistry();
      expect(r.getEmbeddingDimensions('Xenova/all-MiniLM-L6-v2')).toBe(384);
    });

    it('getModelRegistry returns a shared singleton', () => {
      expect(getModelRegistry()).toBe(getModelRegistry());
    });
  });

  describe('validateDimensions (init-time gate)', () => {
    it('passes when the index dims match the known model', () => {
      const r = new ModelRegistry();
      expect(() => r.validateDimensions('Xenova/all-MiniLM-L6-v2', 384)).not.toThrow();
    });

    it('throws DimensionMismatchError when dims disagree', () => {
      const r = new ModelRegistry();
      // bge-base is 768d; configuring a 384d index for it must fail at init.
      expect(() => r.validateDimensions('Xenova/bge-base-en-v1.5', 384)).toThrow(DimensionMismatchError);
    });

    it('skips the check for unknown models (best-effort)', () => {
      const r = new ModelRegistry();
      expect(() => r.validateDimensions('org/unknown-model', 999)).not.toThrow();
    });
  });

  describe('canRunLLMModel (pre-flight)', () => {
    it('rejects a WebLLM model when WebGPU is absent', () => {
      const r = new ModelRegistry();
      const res = r.canRunLLMModel('Llama-3.2-3B-Instruct-q4f32_1-MLC', caps({ webgpu: false }));
      expect(res.canRun).toBe(false);
      expect(res.reason).toContain('WebGPU');
    });

    it('rejects a model whose min tier exceeds the device tier', () => {
      const r = new ModelRegistry();
      // Qwen2.5-7B is high-tier; a mid device can't run it.
      const res = r.canRunLLMModel('Qwen2.5-7B-Instruct-q4f16_1-MLC', caps({ deviceTier: 'mid' }));
      expect(res.canRun).toBe(false);
      expect(res.reason).toContain('tier');
    });

    it('rejects a model larger than reported device memory', () => {
      const r = new ModelRegistry();
      const res = r.canRunLLMModel('Qwen2.5-7B-Instruct-q4f16_1-MLC', caps({ deviceTier: 'high', deviceMemoryGB: 4 }));
      expect(res.canRun).toBe(false);
      expect(res.reason).toContain('memory');
    });

    it('allows a wllama model on a low-tier, no-WebGPU device', () => {
      const r = new ModelRegistry();
      const res = r.canRunLLMModel('Llama-3.2-1B-Instruct', caps({ webgpu: false, deviceTier: 'low', deviceMemoryGB: 4 }));
      expect(res.canRun).toBe(true);
    });

    it('passes unknown models through (best-effort)', () => {
      const r = new ModelRegistry();
      const res = r.canRunLLMModel('org/unknown-llm', caps());
      expect(res.canRun).toBe(true);
    });
  });

  describe('canRunEmbeddingModel', () => {
    it('allows all-MiniLM on a low-tier device', () => {
      const r = new ModelRegistry();
      const res = r.canRunEmbeddingModel('Xenova/all-MiniLM-L6-v2', caps({ deviceTier: 'low' }));
      expect(res.canRun).toBe(true);
    });

    it('rejects a high-tier embedding model on a low device', () => {
      const r = new ModelRegistry();
      const res = r.canRunEmbeddingModel('Xenova/bge-large-en-v1.5', caps({ deviceTier: 'low' }));
      expect(res.canRun).toBe(false);
    });
  });

  describe('recommendLLM', () => {
    it('recommends a runnable model for a low-tier WebGPU device', () => {
      const r = new ModelRegistry();
      const rec = r.recommendLLM(caps({ deviceTier: 'low', webgpu: true, deviceMemoryGB: 4 }));
      expect(rec).toBeDefined();
      expect(rec!.provider).toBe('webllm');
    });

    it('falls back to a wllama model when WebGPU is absent', () => {
      const r = new ModelRegistry();
      const rec = r.recommendLLM(caps({ webgpu: false, deviceTier: 'low', deviceMemoryGB: 4 }));
      expect(rec).toBeDefined();
      expect(rec!.provider).toBe('wllama');
    });
  });

  describe('canRunModel (alias)', () => {
    it('routes LLM ids to the LLM check', () => {
      const r = new ModelRegistry();
      const res = r.canRunModel('Llama-3.2-3B-Instruct-q4f32_1-MLC', caps({ webgpu: false }));
      expect(res.canRun).toBe(false);
    });

    it('routes embedding ids to the embedding check', () => {
      const r = new ModelRegistry();
      const res = r.canRunModel('Xenova/all-MiniLM-L6-v2', caps({ deviceTier: 'low' }));
      expect(res.canRun).toBe(true);
    });
  });
});
