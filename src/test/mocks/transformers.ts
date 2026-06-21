/**
 * Mock factory for Transformers.js pipeline
 * Provides deterministic embedding generation for testing without model downloads
 */

export interface MockPipelineOptions {
  dimensions?: number;
  deterministicEmbeddings?: boolean;
  simulateDelay?: number;
}

export interface MockPipelineOutput {
  data: Float32Array;
  tolist: () => number[] | number[][];
}

export interface MockPipeline {
  (input: string | ImageData | Blob | string[], config?: any): Promise<MockPipelineOutput>;
  dispose?: () => Promise<void>;
  _mockState?: MockState;
}

interface MockState {
  initialized: boolean;
  disposed: boolean;
  callCount: number;
  lastInput: string | null;
  lastOutput: MockPipelineOutput | null;
}

/**
 * Generate deterministic embedding using text hashing
 * Same text always produces same embedding
 */
function generateDeterministicEmbedding(text: string, dimensions: number): Float32Array {
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
export function createMockPipeline(options: MockPipelineOptions = {}): MockPipeline {
  const {
    dimensions = 384,
    deterministicEmbeddings = true,
    simulateDelay = 0,
  } = options;

  // Track mock state
  const state: MockState = {
    initialized: true,
    disposed: false,
    callCount: 0,
    lastInput: null,
    lastOutput: null,
  };

  // Create the mock pipeline function
  const mockPipeline: MockPipeline = async (
    input: string | ImageData | Blob | string[],
    _config?: any
  ): Promise<MockPipelineOutput> => {
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
      const rows = input.map((t) =>
        deterministicEmbeddings
          ? generateDeterministicEmbedding(t, dimensions)
          : new Float32Array(dimensions).map(() => Math.random() - 0.5)
      );
      const flat = new Float32Array(rows.length * dimensions);
      for (let i = 0; i < rows.length; i++) flat.set(rows[i], i * dimensions);

      state.callCount++;
      state.lastInput = input.join('\n');
      const batchOutput: MockPipelineOutput = {
        data: flat,
        tolist: () => rows.map((r) => Array.from(r)),
      };
      state.lastOutput = batchOutput;
      return batchOutput;
    }

    // Convert input to string for hashing
    let textInput: string;
    if (typeof input === 'string') {
      textInput = input;
    } else if (input instanceof Blob) {
      textInput = `blob_${input.size}_${input.type}`;
    } else {
      textInput = `image_${input.width}_${input.height}`;
    }

    // Generate embedding
    const embedding = deterministicEmbeddings
      ? generateDeterministicEmbedding(textInput, dimensions)
      : new Float32Array(dimensions).map(() => Math.random() - 0.5);

    // Create output object
    const output: MockPipelineOutput = {
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
  mockPipeline.dispose = async (): Promise<void> => {
    state.disposed = true;
    state.lastInput = null;
    state.lastOutput = null;
  };

  // Attach state for testing/debugging
  mockPipeline._mockState = state;

  return mockPipeline;
}
