/**
 * Test setup file for Vitest
 */
import 'fake-indexeddb/auto';
import { env } from '@huggingface/transformers';
// Configure Transformers.js for test environment
env.allowLocalModels = true;
env.useBrowserCache = false;
env.allowRemoteModels = true;
// Set up cache directory for models in test environment
if (typeof process !== 'undefined' && process.env) {
    // Use a local cache directory for tests
    env.cacheDir = './.cache/huggingface';
}
// Mock Cache API if not available (for happy-dom)
if (typeof globalThis.caches === 'undefined') {
    const mockCache = {
        match: async () => undefined,
        put: async () => { },
        delete: async () => false,
        keys: async () => [],
    };
    globalThis.caches = {
        open: async () => mockCache,
        has: async () => false,
        delete: async () => false,
        keys: async () => [],
        match: async () => undefined,
    };
}
// Global test setup is handled by Vitest's globals: true configuration
//# sourceMappingURL=setup.js.map