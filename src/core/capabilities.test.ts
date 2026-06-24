import { describe, it, expect, beforeEach, vi } from 'vitest';
import { detectCapabilities, inferTier } from './capabilities';

describe('detectCapabilities', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('WebAssembly', { Module: vi.fn(), validate: vi.fn() });
    vi.stubGlobal('SharedArrayBuffer', class {});
    vi.stubGlobal('indexedDB', {});
    vi.stubGlobal('navigator', {
      gpu: undefined,
      deviceMemory: undefined,
    });
  });

  it('should detect basic capabilities', async () => {
    const caps = await detectCapabilities(true);
    expect(caps.wasm).toBe(true);
    expect(caps.sharedArrayBuffer).toBe(true);
    expect(caps.indexedDB).toBe(true);
    expect(['low', 'mid', 'high']).toContain(caps.deviceTier);
  });

  it('should cache results', async () => {
    const caps1 = await detectCapabilities();
    const caps2 = await detectCapabilities();
    expect(caps1).toBe(caps2);
  });

  it('should force re-detection when forced', async () => {
    const caps1 = await detectCapabilities();
    const caps2 = await detectCapabilities(true);
    expect(caps1).not.toBe(caps2);
  });
});

describe('inferTier', () => {
  it('should return low for no WebGPU', () => {
    expect(inferTier(false, 16)).toBe('low');
  });

  it('should return mid for WebGPU with unknown memory', () => {
    expect(inferTier(true, undefined)).toBe('mid');
  });

  it('should return low for WebGPU with <=4GB', () => {
    expect(inferTier(true, 4)).toBe('low');
    expect(inferTier(true, 2)).toBe('low');
  });

  it('should return mid for WebGPU with 5-8GB', () => {
    expect(inferTier(true, 6)).toBe('mid');
    expect(inferTier(true, 8)).toBe('mid');
  });

  it('should return high for WebGPU with >8GB', () => {
    expect(inferTier(true, 16)).toBe('high');
    expect(inferTier(true, 32)).toBe('high');
  });
});