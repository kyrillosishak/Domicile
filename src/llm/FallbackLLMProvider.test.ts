import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FallbackLLMProvider } from './FallbackLLMProvider';
import type { LLMProvider, GenerateOptions } from './types';

function createMockProvider(name: string, available = true): LLMProvider {
  let initialized = false;
  return {
    name,
    async initialize() {
      initialized = true;
    },
    async generate(prompt: string, _options?: GenerateOptions) {
      if (!initialized) throw new Error(`${name} not initialized`);
      return `${name} response to: ${prompt}`;
    },
    async *generateStream(prompt: string, _options?: GenerateOptions) {
      if (!initialized) throw new Error(`${name} not initialized`);
      yield `${name} chunk 1 for: ${prompt}`;
      yield `${name} chunk 2 for: ${prompt}`;
    },
    async isAvailable() {
      return available;
    },
    async dispose() {
      initialized = false;
    },
  } as LLMProvider & { name: string };
}

describe('FallbackLLMProvider', () => {
  it('should require at least one provider', () => {
    expect(() => new FallbackLLMProvider([])).toThrow('at least one provider');
  });

  it('should initialize the first available provider', async () => {
    const p1 = createMockProvider('WebLLM', false);
    const p2 = createMockProvider('Wllama', true);
    const fallback = new FallbackLLMProvider([p1, p2]);

    await fallback.initialize();
    expect(fallback.getActiveProvider()).toBe(p2);
  });

  it('should throw if no provider is available', async () => {
    const p1 = createMockProvider('WebLLM', false);
    const p2 = createMockProvider('Wllama', false);
    const fallback = new FallbackLLMProvider([p1, p2]);

    await expect(fallback.initialize()).rejects.toThrow('no provider is available');
  });

  it('should generate using the active provider', async () => {
    const p1 = createMockProvider('WebLLM', false);
    const p2 = createMockProvider('Wllama', true);
    const fallback = new FallbackLLMProvider([p1, p2]);

    await fallback.initialize();
    const result = await fallback.generate('Hello');
    expect(result).toContain('Wllama');
  });

  it('should stream using the active provider', async () => {
    const p1 = createMockProvider('WebLLM', false);
    const p2 = createMockProvider('Wllama', true);
    const fallback = new FallbackLLMProvider([p1, p2]);

    await fallback.initialize();
    const chunks: string[] = [];
    for await (const chunk of fallback.generateStream('Hello')) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toContain('Wllama');
  });

  it('should cascade to next provider on generate error', async () => {
    const p1 = createMockProvider('WebLLM', true);
    const p2 = createMockProvider('Wllama', true);
    const fallback = new FallbackLLMProvider([p1, p2]);

    await fallback.initialize();
    expect(fallback.getActiveProvider()).toBe(p1);

    // Make p1 fail on generate
    const failingProvider = createMockProvider('WebLLM', true);
    failingProvider.generate = vi.fn().mockRejectedValue(new Error('GPU lost'));
    const fallback2 = new FallbackLLMProvider([failingProvider, p2]);
    await fallback2.initialize();

    const result = await fallback2.generate('Hello');
    expect(result).toContain('Wllama');
    expect(fallback2.getActiveProvider()).toBe(p2);
  });

  it('should cascade on stream error before yielding', async () => {
    const failingProvider = createMockProvider('WebLLM', true);
    failingProvider.generateStream = vi.fn().mockImplementation(async function* () {
      throw new Error('GPU lost');
    });

    const p2 = createMockProvider('Wllama', true);
    const fallback = new FallbackLLMProvider([failingProvider, p2]);
    await fallback.initialize();

    const chunks: string[] = [];
    for await (const chunk of fallback.generateStream('Hello')) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toContain('Wllama');
    expect(fallback.getActiveProvider()).toBe(p2);
  });

  it('should NOT cascade on stream error AFTER yielding', async () => {
    const failingProvider = createMockProvider('WebLLM', true);
    failingProvider.generateStream = vi.fn().mockImplementation(async function* () {
      yield 'first chunk';
      throw new Error('GPU lost after yield');
    });

    const p2 = createMockProvider('Wllama', true);
    const fallback = new FallbackLLMProvider([failingProvider, p2]);
    await fallback.initialize();

    await expect(
      (async () => {
        for await (const chunk of fallback.generateStream('Hello')) {
          // consume
        }
      })()
    ).rejects.toThrow('GPU lost after yield');
  });

  it('should report available if any provider is available', async () => {
    const p1 = createMockProvider('WebLLM', false);
    const p2 = createMockProvider('Wllama', true);
    const fallback = new FallbackLLMProvider([p1, p2]);

    expect(await fallback.isAvailable()).toBe(true);
  });

  it('should dispose all providers', async () => {
    const p1 = createMockProvider('WebLLM', true);
    const p2 = createMockProvider('Wllama', true);
    const fallback = new FallbackLLMProvider([p1, p2]);

    await fallback.initialize();
    await fallback.dispose();

    // Both providers should have dispose called (no error thrown)
    expect(fallback.getActiveProvider()).toBeNull();
  });

  it('should handle isAvailable throwing defensively', async () => {
    const p1 = createMockProvider('WebLLM', true);
    p1.isAvailable = vi.fn().mockRejectedValue(new Error('probe failed'));
    const p2 = createMockProvider('Wllama', true);
    const fallback = new FallbackLLMProvider([p1, p2]);

    await fallback.initialize();
    expect(fallback.getActiveProvider()).toBe(p2);
  });

  it('should return active provider via getActiveProvider', async () => {
    const p1 = createMockProvider('WebLLM', false);
    const p2 = createMockProvider('Wllama', true);
    const fallback = new FallbackLLMProvider([p1, p2]);

    expect(fallback.getActiveProvider()).toBeNull();
    await fallback.initialize();
    expect(fallback.getActiveProvider()).toBe(p2);
  });
});