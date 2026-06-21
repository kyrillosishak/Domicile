/**
 * domicile capabilities — print this machine's detected runtime capabilities.
 *
 * Wraps `detectCapabilities()` so an integrator can see, before deploy,
 * whether WebGPU/SIMD/SharedArrayBuffer are available and what device tier
 * the factory will infer (which drives model selection).
 */
import { parseFlags } from '../commands.js';
export async function cmdCapabilities(args) {
    const { values } = parseFlags(args, { flags: { json: 'boolean', help: 'boolean' } });
    if (values.help) {
        console.log(`domicile capabilities — print detected runtime capabilities

Options:
  --json    Emit machine-readable JSON
  --help    Show this help`);
        return 0;
    }
    const { detectCapabilities } = await import('../../index.js');
    const caps = await detectCapabilities(true);
    if (values.json) {
        console.log(JSON.stringify(caps, null, 2));
        return 0;
    }
    console.log('Domicile runtime capabilities:');
    console.log(`  WebGPU            ${caps.webgpu ? 'yes' : 'no'}`);
    console.log(`  WASM              ${caps.wasm ? 'yes' : 'no'}`);
    console.log(`  WASM SIMD         ${caps.simd ? 'yes' : 'no'}`);
    console.log(`  SharedArrayBuffer ${caps.sharedArrayBuffer ? 'yes' : 'no'}`);
    console.log(`  IndexedDB         ${caps.indexedDB ? 'yes' : 'no'}`);
    console.log(`  deviceMemory      ${caps.deviceMemoryGB ?? 'unknown'} GB`);
    console.log(`  maxTextureSize    ${caps.maxTextureSize ?? 'unknown'}`);
    console.log(`  deviceTier        ${caps.deviceTier}`);
    console.log();
    console.log(caps.webgpu
        ? '→ WebLLM (GPU) path available; FallbackLLMProvider will prefer it.'
        : '→ No WebGPU; FallbackLLMProvider will use the wllama (WASM) path.');
    return 0;
}
//# sourceMappingURL=capabilities.js.map