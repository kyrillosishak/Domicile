/**
 * FallbackLLMProvider - cascades across an ordered list of LLM providers.
 *
 * This is the provider the README/showcase promise ("automatic fallback")
 * but the codebase never delivered: previously WebLLM threw on init when
 * WebGPU was absent, with only an error message *suggesting* Wllama.
 *
 * Cascade strategy:
 *  - On initialize(): probe `isAvailable()` on each provider in order; keep
 *    the first that reports available and initialize it. Skip the rest.
 *  - On generate()/generateStream(): route to the active provider. If it
 *    throws at call time (e.g. GPU lost mid-session, model OOM), cascade
 *    to the next available provider and retry once.
 *
 * Typical ordering: [WebLLMProvider (WebGPU), WllamaProvider (WASM)].
 */

import type { LLMProvider, GenerateOptions } from './types';

export class FallbackLLMProvider implements LLMProvider {
  private providers: LLMProvider[];
  private activeIndex = -1;

  constructor(providers: LLMProvider[]) {
    if (!providers || providers.length === 0) {
      throw new Error('FallbackLLMProvider requires at least one provider');
    }
    this.providers = providers;
  }

  async initialize(): Promise<void> {
    // Find the first provider that is available in this environment.
    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];
      try {
        const available = await provider.isAvailable();
        if (available) {
          await provider.initialize();
          this.activeIndex = i;
          return;
        }
      } catch {
        // isAvailable is non-throwing by contract, but be defensive: a
        // provider whose probe throws is treated as unavailable.
        continue;
      }
    }

    throw new Error(
      'FallbackLLMProvider: no provider is available in this environment ' +
      `(${this.providers.length} tried)`
    );
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    const active = this.requireActive();
    try {
      return await active.generate(prompt, options);
    } catch (error) {
      // Try to cascade to the next available provider.
      const next = await this.nextAvailable(this.activeIndex);
      if (next === null || next === active) {
        throw error;
      }
      return next.generate(prompt, options);
    }
  }

  async *generateStream(
    prompt: string,
    options?: GenerateOptions
  ): AsyncGenerator<string> {
    const active = this.requireActive();
    // Streaming cascade: if the active provider's stream errors before
    // yielding anything, fall back to the next provider. Once tokens have
    // been yielded we cannot cleanly restart, so re-throw.
    let yielded = false;
    try {
      for await (const chunk of active.generateStream(prompt, options)) {
        yielded = true;
        yield chunk;
      }
    } catch (error) {
      if (yielded) throw error;
      const next = await this.nextAvailable(this.activeIndex);
      if (next === null || next === active) throw error;
      yield* next.generateStream(prompt, options);
    }
  }

  async isAvailable(): Promise<boolean> {
    // Available if any underlying provider is available.
    for (const provider of this.providers) {
      try {
        if (await provider.isAvailable()) return true;
      } catch {
        continue;
      }
    }
    return false;
  }

  async dispose(): Promise<void> {
    // Dispose all providers that were initialized (best-effort).
    await Promise.all(
      this.providers.map((p) =>
        p.dispose().catch(() => undefined)
      )
    );
    this.activeIndex = -1;
  }

  /** The currently active provider, or null if none initialized. */
  getActiveProvider(): LLMProvider | null {
    return this.activeIndex >= 0 ? this.providers[this.activeIndex] : null;
  }

  private requireActive(): LLMProvider {
    if (this.activeIndex < 0) {
      throw new Error('FallbackLLMProvider not initialized. Call initialize() first.');
    }
    return this.providers[this.activeIndex];
  }

  /**
   * Find the next available provider after `afterIndex`, initializing it.
   * Returns null if none found. Does not mutate activeIndex on failure.
   */
  private async nextAvailable(afterIndex: number): Promise<LLMProvider | null> {
    for (let i = afterIndex + 1; i < this.providers.length; i++) {
      const provider = this.providers[i];
      try {
        if (await provider.isAvailable()) {
          await provider.initialize();
          this.activeIndex = i;
          return provider;
        }
      } catch {
        continue;
      }
    }
    return null;
  }
}
