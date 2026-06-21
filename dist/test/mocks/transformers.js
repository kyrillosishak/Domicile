/**
 * Mock factory for Transformers.js pipeline
 * Provides deterministic embedding generation for testing without model downloads
 */
/**
 * Generate deterministic embedding using text hashing
 * Same text always produces same embedding
 */
function generateDeterministicEmbedding(text, dimensions) {
    const embedding = new Float32Array(dimensions);
    // Use text hash to seed the embedding
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) - hash) + text.charCodeAt(i);
        hash = hash & hash; // Convert to 32-bit integer
    }
    // Generate pseudo-random but deterministic values
    for (let i = 0; i < dimensions; i++) {
        const seed = hash + i;
        embedding[i] = Math.sin(seed) * 0.5;
    }
    // Normalize the embedding to ensure unit vector
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    for (let i = 0; i < dimensions; i++) {
        embedding[i] /= norm;
    }
    return embedding;
}
/**
 * Create a mock Transformers.js pipeline
 *
 * @param options Configuration options for the mock
 * @returns Mock pipeline function with state tracking
 *
 * @example
 * ```typescript
 * const mockPipeline = createMockPipeline({ dimensions: 384 });
 * const result = await mockPipeline('test text');
 * console.log(result.data); // Float32Array of embeddings
 * ```
 */
export function createMockPipeline(options = {}) {
    const { dimensions = 384, deterministicEmbeddings = true, simulateDelay = 0, } = options;
    // Track mock state
    const state = {
        initialized: true,
        disposed: false,
        callCount: 0,
        lastInput: null,
        lastOutput: null,
    };
    // Create the mock pipeline function
    const mockPipeline = async (input, _config) => {
        if (state.disposed) {
            throw new Error('Pipeline has been disposed');
        }
        // Simulate processing delay if configured
        if (simulateDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, simulateDelay));
        }
        // Batched input: an array of strings. Real Transformers.js returns a
        // 2D output (count × dims); the mock mirrors that with a flat
        // Float32Array of length count*dims and a 2D tolist().
        if (Array.isArray(input)) {
            const rows = input.map((t) => deterministicEmbeddings
                ? generateDeterministicEmbedding(t, dimensions)
                : new Float32Array(dimensions).map(() => Math.random() - 0.5));
            const flat = new Float32Array(rows.length * dimensions);
            for (let i = 0; i < rows.length; i++)
                flat.set(rows[i], i * dimensions);
            state.callCount++;
            state.lastInput = input.join('\n');
            const batchOutput = {
                data: flat,
                tolist: () => rows.map((r) => Array.from(r)),
            };
            state.lastOutput = batchOutput;
            return batchOutput;
        }
        // Convert input to string for hashing
        let textInput;
        if (typeof input === 'string') {
            textInput = input;
        }
        else if (input instanceof Blob) {
            textInput = `blob_${input.size}_${input.type}`;
        }
        else {
            textInput = `image_${input.width}_${input.height}`;
        }
        // Generate embedding
        const embedding = deterministicEmbeddings
            ? generateDeterministicEmbedding(textInput, dimensions)
            : new Float32Array(dimensions).map(() => Math.random() - 0.5);
        // Create output object
        const output = {
            data: embedding,
            tolist: () => Array.from(embedding),
        };
        // Update state
        state.callCount++;
        state.lastInput = textInput;
        state.lastOutput = output;
        return output;
    };
    // Add dispose method
    mockPipeline.dispose = async () => {
        state.disposed = true;
        state.lastInput = null;
        state.lastOutput = null;
    };
    // Attach state for testing/debugging
    mockPipeline._mockState = state;
    return mockPipeline;
}
//# sourceMappingURL=transformers.js.map