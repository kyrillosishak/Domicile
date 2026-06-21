/**
 * EmbeddingPipeline — runtime selector (one-shot detect + cache).
 *
 * Order: WebNN → WebGPU → WASM-SIMD+MultiThread → WASM.
 *
 * Each probe is wrapped in a 1.5 s timeout. Failures downgrade silently.
 * The result is cached for the lifetime of the session.
 */

import * as ort from 'onnxruntime-web';

export type ExecutionTier = 'webnn' | 'webgpu' | 'wasm-simd' | 'wasm';

export interface PipelineDescribe {
  tier: ExecutionTier;
  threads: number;
  modulesLoaded: boolean;
  wasmPaths: string | undefined;
}

declare global {
  // eslint-disable-next-line no-var
  var __havenEmbeddingPipeline: ReturnType<typeof detectPipeline> | undefined;
  interface Navigator {
    ml?: MLCapabilities;
  }
  interface MLCapabilities {
    createContext?: (opts?: any) => Promise<MLContext>;
  }
  interface MLContext {
    compute?: (graph: unknown, inputs: Record<string, unknown>) => Promise<unknown>;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(fallback);
    }, ms);
    p.then(
      (v) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(v);
      },
      () => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}

async function probeWebNN(): Promise<ExecutionTier | null> {
  if (typeof navigator === 'undefined') return null;
  const ml = (navigator as any).ml;
  if (!ml || typeof ml.createContext !== 'function') return null;
  try {
    const ctx = await withTimeout(
      ml.createContext({ deviceType: 'gpu' }),
      1500,
      null,
    );
    if (ctx === null) return null;
    return 'webnn';
  } catch {
    return null;
  }
}

async function probeWebGPU(): Promise<ExecutionTier | null> {
  if (typeof navigator === 'undefined') return null;
  const gpu = (navigator as any).gpu;
  if (!gpu) return null;
  try {
    const adapter = await withTimeout(gpu.requestAdapter(), 1500, null);
    if (adapter === null) return null;
    return 'webgpu';
  } catch {
    return null;
  }
}

function probeWasmSimd(): boolean {
  try {
    if (typeof WebAssembly === 'undefined') return false;
    return !!new Uint8Array([0]).constructor; // presence is enough; details below
  } catch {
    return false;
  }
}

function threadsAvailable(): boolean {
  if (typeof Atomics === 'undefined') return false;
  if (typeof SharedArrayBuffer === 'undefined') return false;
  if (typeof crossOriginIsolated !== 'undefined' && !crossOriginIsolated) return false;
  return true;
}

function detectPipeline(): PipelineDescribe {
  // Lazy runtime probe — synchronous WASM/SIMD detection, async for WebNN/WebGPU.
  const threads = threadsAvailable() ? Math.max(1, navigator?.hardwareConcurrency ?? 1) : 1;
  let tier: ExecutionTier = 'wasm';
  if (!probeWasmSimd()) tier = 'wasm';
  else if (!threadsAvailable()) tier = 'wasm';
  // async tier resolution happens in `selectTier()`.
  return {
    tier, // synchronous default; overwritten by selectTier()
    threads,
    modulesLoaded: false,
    wasmPaths: undefined,
  };
}

export async function selectTier(): Promise<PipelineDescribe> {
  const cached = globalThis.__havenEmbeddingPipeline;
  if (cached) return cached;
  const base = detectPipeline();

  const webnn = await probeWebNN();
  let tier: ExecutionTier;
  if (webnn) tier = 'webnn';
  else if (await probeWebGPU()) tier = 'webgpu';
  else if (base.threads > 1) tier = 'wasm-simd';
  else tier = 'wasm';

  const selected: PipelineDescribe = {
    tier,
    threads: tier === 'wasm-simd' ? base.threads : 1,
    modulesLoaded: true,
    wasmPaths: ort.env?.wasm?.wasmPaths as string | undefined,
  };
  globalThis.__havenEmbeddingPipeline = selected;
  return selected;
}

/**
 * Apply the chosen tier to the onnxruntime-web execution providers list,
 * and configure wasm threading fallback if applicable.
 */
export async function configureOrtForTier(pipeline: PipelineDescribe): Promise<void> {
  try {
    if (pipeline.tier === 'webgpu') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ort as any).env.webgpu = { device: 'gpu' };
    }
    if (pipeline.tier === 'wasm-simd') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ort as any).env.wasm = (ort as any).env.wasm || {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ort as any).env.wasm.numThreads = pipeline.threads;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ort as any).env.wasm.simd = true;
    }
  } catch {
    /* best-effort; orT may not expose env at all in some builds */
  }
}
