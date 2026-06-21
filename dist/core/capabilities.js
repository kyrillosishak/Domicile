/**
 * Centralized runtime capability detection.
 *
 * Every adapter probes the environment through this single source of truth
 * instead of scattered inline checks. `createDomicile()` uses it to pick
 * WebLLM vs wllama and the device tier; the Desktop app renders it as the
 * capability matrix.
 */
let cached = null;
export async function detectCapabilities(force = false) {
    if (cached && !force)
        return cached;
    const wasm = typeof WebAssembly === 'object';
    let simd = false;
    try {
        // wasm-simd is detected via a feature-test module.
        if (wasm) {
            // @ts-ignore - minimal SIMD probe; ignored if unsupported
            new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 0, 11]));
            simd = true;
        }
    }
    catch {
        simd = false;
    }
    const sharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
    const hasIndexedDB = typeof indexedDB !== 'undefined';
    let webgpu = false;
    let maxTextureSize;
    try {
        const gpu = navigator.gpu;
        if (gpu) {
            const adapter = await gpu.requestAdapter();
            if (adapter) {
                webgpu = true;
                try {
                    const info = await adapter.requestAdapterInfo?.();
                    // maxTextureSize isn't always on adapterInfo; leave undefined if unknown.
                    maxTextureSize = info?.maxTextureSize;
                }
                catch {
                    // non-fatal
                }
            }
        }
    }
    catch {
        webgpu = false;
    }
    const deviceMemoryGB = navigator.deviceMemory;
    const deviceTier = inferTier(webgpu, deviceMemoryGB);
    cached = { webgpu, wasm, simd, sharedArrayBuffer, indexedDB: hasIndexedDB, deviceMemoryGB, maxTextureSize, deviceTier };
    return cached;
}
function inferTier(webgpu, memoryGB) {
    if (!webgpu)
        return 'low';
    if (memoryGB === undefined)
        return 'mid';
    if (memoryGB <= 4)
        return 'low';
    if (memoryGB <= 8)
        return 'mid';
    return 'high';
}
//# sourceMappingURL=capabilities.js.map