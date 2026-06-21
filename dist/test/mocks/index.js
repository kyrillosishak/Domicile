/**
 * Centralized mock utilities and exports for testing
 * Provides easy access to all mock factories and setup utilities
 */
import { vi } from 'vitest';
// Re-export all mock factories and types
export { createMockPipeline, } from './transformers.js';
export { createMockMLCEngine, } from './webllm.js';
/**
 * Setup Transformers.js module mocks
 * Replaces @huggingface/transformers with mock implementations
 *
 * @param options Optional configuration for mock pipeline
 *
 * @example
 * ```typescript
 * // In your test file
 * setupTransformersMocks({ dimensions: 384 });
 *
 * // Now all imports from @huggingface/transformers will use mocks
 * const embedding = new TransformersEmbedding();
 * await embedding.initialize(); // Uses mock pipeline
 * ```
 */
export function setupTransformersMocks(options) {
    vi.mock('@huggingface/transformers', async () => {
        const { createMockPipeline } = await import('./transformers.js');
        return {
            pipeline: vi.fn().mockImplementation(async (_task, _model, _pipelineOptions) => {
                return createMockPipeline(options);
            }),
            env: {
                allowLocalModels: true,
                useBrowserCache: false,
                allowRemoteModels: true,
                cacheDir: './.cache/huggingface',
            },
        };
    });
}
/**
 * Setup WebLLM module mocks
 * Replaces @mlc-ai/web-llm with mock implementations
 *
 * @param options Optional configuration for mock MLCEngine
 *
 * @example
 * ```typescript
 * // In your test file
 * setupWebLLMMocks({
 *   defaultResponse: 'Custom test response',
 *   simulateDelay: 10
 * });
 *
 * // Now all imports from @mlc-ai/web-llm will use mocks
 * const provider = new WebLLMProvider();
 * await provider.initialize(); // Uses mock engine
 * ```
 */
export function setupWebLLMMocks(options) {
    vi.mock('@mlc-ai/web-llm', async () => {
        const { createMockMLCEngine } = await import('./webllm.js');
        return {
            CreateMLCEngine: vi.fn().mockImplementation(async (_model, config) => {
                // Simulate initialization progress callbacks
                if (config?.initProgressCallback) {
                    config.initProgressCallback({
                        progress: 0.3,
                        text: 'Loading model...',
                        timeElapsed: 100,
                    });
                    config.initProgressCallback({
                        progress: 0.7,
                        text: 'Initializing...',
                        timeElapsed: 200,
                    });
                    config.initProgressCallback({
                        progress: 1.0,
                        text: 'Model loaded',
                        timeElapsed: 300,
                    });
                }
                return createMockMLCEngine(options);
            }),
            hasModelInCache: vi.fn().mockResolvedValue(false),
            prebuiltAppConfig: {
                model_list: [
                    {
                        model_id: 'mock-model',
                        model_url: 'https://mock.url',
                    },
                ],
            },
        };
    });
}
/**
 * Setup all mocks (Transformers.js and WebLLM)
 * Convenience function to mock all external ML libraries at once
 *
 * @param transformersOptions Optional configuration for Transformers.js mocks
 * @param webllmOptions Optional configuration for WebLLM mocks
 *
 * @example
 * ```typescript
 * // In your test setup file or individual test
 * setupAllMocks(
 *   { dimensions: 384 },
 *   { defaultResponse: 'Test response' }
 * );
 *
 * // All ML library imports now use mocks
 * ```
 */
export function setupAllMocks(transformersOptions, webllmOptions) {
    setupTransformersMocks(transformersOptions);
    setupWebLLMMocks(webllmOptions);
}
/**
 * Reset all mocks to their initial state
 * Clears mock call history and resets mock implementations
 *
 * @example
 * ```typescript
 * describe('My test suite', () => {
 *   beforeEach(() => {
 *     setupAllMocks();
 *   });
 *
 *   afterEach(() => {
 *     resetAllMocks();
 *   });
 *
 *   it('should work', () => {
 *     // Test code
 *   });
 * });
 * ```
 */
export function resetAllMocks() {
    vi.clearAllMocks();
    vi.resetAllMocks();
}
//# sourceMappingURL=index.js.map