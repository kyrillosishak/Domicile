/**
 * WllamaProvider - WASM-based LLM inference using wllama
 */
export class WllamaProvider {
    constructor(config) {
        this.wllama = null;
        this.initialized = false;
        this.modelLoaded = false;
        this.config = config;
    }
    async initialize() {
        if (this.initialized) {
            return;
        }
        try {
            // Dynamic import of wllama to avoid bundling issues
            const { Wllama } = await import('@wllama/wllama');
            // Initialize wllama instance
            this.wllama = new Wllama(this.config.wasmPaths || {});
            this.initialized = true;
            // Load the model
            await this.loadModel();
        }
        catch (error) {
            throw new Error(`Failed to initialize WllamaProvider: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async loadModel() {
        if (!this.wllama) {
            throw new Error('Wllama not initialized');
        }
        if (this.modelLoaded) {
            return;
        }
        try {
            // Load model with progress tracking
            await this.wllama.loadModelFromUrl(this.config.modelUrl, {
                n_ctx: this.config.modelConfig?.n_ctx || 2048,
                n_batch: this.config.modelConfig?.n_batch || 512,
                n_threads: this.config.modelConfig?.n_threads || 1,
                embeddings: this.config.modelConfig?.embeddings || false,
                progressCallback: this.config.progressCallback
                    ? ({ loaded, total }) => {
                        this.config.progressCallback?.({ loaded, total });
                    }
                    : undefined,
            });
            this.modelLoaded = true;
        }
        catch (error) {
            throw new Error(`Failed to load model from ${this.config.modelUrl}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Non-throwing capability probe. wllama runs on WASM, so it is available
     * wherever WebAssembly exists — the universal fallback. Model-load
     * availability (network/reachability of the model URL) is not checked
     * here; only runtime capability.
     */
    async isAvailable() {
        return typeof WebAssembly === 'object';
    }
    async generate(prompt, options) {
        if (!this.initialized || !this.wllama) {
            throw new Error('WllamaProvider not initialized. Call initialize() first.');
        }
        if (!this.modelLoaded) {
            throw new Error('Model not loaded');
        }
        try {
            const result = await this.wllama.createCompletion(prompt, {
                nPredict: options?.maxTokens || 512,
                sampling: {
                    temp: options?.temperature ?? 0.7,
                    top_p: options?.topP ?? 0.9,
                    top_k: options?.topK ?? 40,
                },
                stopTokens: options?.stopSequences,
            });
            return result;
        }
        catch (error) {
            throw new Error(`Failed to generate text: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async *generateStream(prompt, options) {
        if (!this.initialized || !this.wllama) {
            throw new Error('WllamaProvider not initialized. Call initialize() first.');
        }
        if (!this.modelLoaded) {
            throw new Error('Model not loaded');
        }
        // wllama v2 streams via an onToken callback that receives Uint8Array
        // token bytes. We decode each token and yield it as it arrives, so the
        // UI renders progressively instead of waiting for the whole completion.
        // (The previous implementation called createCompletion without a callback,
        // got back a full string, and yielded it once — a silent no-op "stream".)
        const queue = [];
        let resolveNext = null;
        let done = false;
        let streamError = null;
        const flush = () => {
            if (resolveNext) {
                const r = resolveNext;
                resolveNext = null;
                r();
            }
        };
        try {
            const completionPromise = this.wllama.createCompletion(prompt, {
                nPredict: options?.maxTokens || 512,
                sampling: {
                    temp: options?.temperature ?? 0.7,
                    top_p: options?.topP ?? 0.9,
                    top_k: options?.topK ?? 40,
                },
                stopTokens: options?.stopSequences,
                onToken: (token) => {
                    queue.push(token);
                    flush();
                },
            });
            completionPromise
                .then(() => { done = true; flush(); })
                .catch((err) => { streamError = err instanceof Error ? err : new Error(String(err)); done = true; flush(); });
            const decoder = new TextDecoder();
            while (true) {
                // Drain anything already queued.
                while (queue.length > 0) {
                    const token = queue.shift();
                    yield decoder.decode(token, { stream: true });
                }
                if (done)
                    break;
                // Wait for the next token (or completion).
                await new Promise((resolve) => { resolveNext = resolve; });
            }
            // Flush the decoder's internal state.
            yield decoder.decode();
            if (streamError) {
                throw streamError;
            }
        }
        catch (error) {
            throw new Error(`Failed to generate streaming text: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async dispose() {
        if (this.wllama) {
            try {
                // Exit and cleanup wllama resources
                await this.wllama.exit();
            }
            catch (error) {
                console.warn('Error during wllama cleanup:', error);
            }
            this.wllama = null;
            this.initialized = false;
            this.modelLoaded = false;
        }
    }
    /**
     * Check if the provider is initialized
     */
    isInitialized() {
        return this.initialized && this.modelLoaded;
    }
    /**
     * Get model information
     */
    getModelInfo() {
        return {
            url: this.config.modelUrl,
            loaded: this.modelLoaded,
        };
    }
}
//# sourceMappingURL=WllamaProvider.js.map