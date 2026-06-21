/**
 * Transformers.js embedding generation implementation
 */

import { pipeline, env } from '@huggingface/transformers';
import type { EmbeddingGenerator } from './types.js';

export interface TransformersEmbeddingConfig {
  model: string;
  device?: 'wasm' | 'webgpu';
  cache?: boolean;
  quantized?: boolean;
  maxRetries?: number;
  retryDelay?: number;
}

/**
 * Embedding generator using Transformers.js
 * Supports text and image embeddings with WebGPU acceleration and WASM fallback
 */
export class TransformersEmbedding implements EmbeddingGenerator {
  private pipeline: any = null;
  private config: Required<TransformersEmbeddingConfig>;
  private dimensions: number = 0;
  private initialized: boolean = false;

  constructor(config: TransformersEmbeddingConfig) {
    this.config = {
      device: 'wasm',
      cache: true,
      quantized: true,
      maxRetries: 3,
      retryDelay: 1000,
      ...config,
    };
  }

  /**
   * Initialize the embedding pipeline with model loading and caching
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Configure Transformers.js environment
    if (this.config.cache) {
      env.allowLocalModels = false;
      env.useBrowserCache = true;
    }

    let lastError: Error | null = null;
    let attempt = 0;

    while (attempt < this.config.maxRetries) {
      try {
        // Try to load with specified device
        this.pipeline = await this.loadPipeline(this.config.device);
        
        // Test the pipeline to get dimensions
        const testEmbedding = await this.generateEmbedding('test');
        this.dimensions = testEmbedding.length;
        
        this.initialized = true;
        return;
      } catch (error) {
        lastError = error as Error;
        attempt++;

        // If WebGPU fails, fallback to WASM
        if (this.config.device === 'webgpu' && attempt === 1) {
          console.warn('WebGPU initialization failed, falling back to WASM', error);
          this.config.device = 'wasm';
          continue;
        }

        // Retry with exponential backoff
        if (attempt < this.config.maxRetries) {
          const delay = this.config.retryDelay * Math.pow(2, attempt - 1);
          console.warn(`Model loading failed (attempt ${attempt}/${this.config.maxRetries}), retrying in ${delay}ms...`, error);
          await this.sleep(delay);
        }
      }
    }

    throw new Error(
      `Failed to initialize embedding model after ${this.config.maxRetries} attempts: ${lastError?.message}`
    );
  }

  /**
   * Load the Transformers.js pipeline with device configuration
   */
  private async loadPipeline(device: 'wasm' | 'webgpu'): Promise<any> {
    const options: any = {
      quantized: this.config.quantized,
    };

    // Set device-specific options
    if (device === 'webgpu') {
      options.device = 'webgpu';
    }

    return await pipeline('feature-extraction', this.config.model, options);
  }

  /**
   * Generate embedding for a single text with mean pooling and normalization
   */
  async embed(text: string): Promise<Float32Array> {
    this.ensureInitialized();
    return await this.generateEmbedding(text);
  }

  /**
   * Generate embeddings for multiple texts in batch.
   *
   * Uses a single batched pipeline call rather than looping `embed` per
   * text, which leaves significant throughput on the table for bulk ingest
   * (Transformers.js supports batched inference natively). Falls back to
   * sequential generation only if the batched output shape is unexpected.
   */
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    this.ensureInitialized();

    if (texts.length === 0) {
      return [];
    }

    if (!this.pipeline) {
      throw new Error('Pipeline not initialized');
    }

    try {
      const output = await this.pipeline(texts, {
        pooling: 'mean',
        normalize: true,
      });

      return this.extractEmbeddingsBatch(output, texts.length);
    } catch (error) {
      // If the batched call fails (some pipelines reject arrays), fall back
      // to sequential generation so callers still get a result.
      const embeddings: Float32Array[] = [];
      for (const text of texts) {
        embeddings.push(await this.generateEmbedding(text));
      }
      return embeddings;
    }
  }

  /**
   * Extract an array of Float32Array embeddings from a batched pipeline output.
   * Handles the 2D / nested shapes Transformers.js can return.
   */
  private extractEmbeddingsBatch(output: any, expectedCount: number): Float32Array[] {
    // Tensor-like output with .tolist() (most common Transformers.js shape).
    if (output?.tolist) {
      const data = output.tolist();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        return data.map((row: any) => new Float32Array(row));
      }
      // Single embedding returned despite batch input.
      if (Array.isArray(data)) {
        return [new Float32Array(data)];
      }
    }

    // Tensor-like output with .data as a flat Float32Array of length count*dim.
    if (output?.data instanceof Float32Array) {
      const flat = output.data as Float32Array;
      const dims = this.dimensions || (flat.length / expectedCount);
      if (dims > 0 && flat.length % dims === 0) {
        const count = flat.length / dims;
        const out: Float32Array[] = [];
        for (let i = 0; i < count; i++) {
          out.push(flat.subarray(i * dims, (i + 1) * dims));
        }
        return out;
      }
      return [flat];
    }

    // Nested array form.
    if (Array.isArray(output?.data) && Array.isArray(output.data[0])) {
      return output.data.map((row: any) => new Float32Array(row));
    }

    // Last resort: try the single-embedding extractor per row.
    try {
      return [this.extractEmbedding(output)];
    } catch {
      throw new Error('Unexpected batched output format from embedding pipeline');
    }
  }

  /**
   * Generate embedding for an image using CLIP models
   */
  async embedImage(image: ImageData | Blob): Promise<Float32Array> {
    this.ensureInitialized();

    if (!this.pipeline) {
      throw new Error('Pipeline not initialized');
    }

    try {
      // Convert ImageData to format expected by Transformers.js
      let imageInput: any = image;
      
      if (image instanceof ImageData) {
        // Create a canvas to convert ImageData to Blob
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Failed to get canvas context');
        }
        ctx.putImageData(image, 0, 0);
        imageInput = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Failed to convert ImageData to Blob'));
          });
        });
      }

      const output = await this.pipeline(imageInput, {
        pooling: 'mean',
        normalize: true,
      });

      return this.extractEmbedding(output);
    } catch (error) {
      throw new Error(`Failed to generate image embedding: ${(error as Error).message}`);
    }
  }

  /**
   * Get the dimensionality of the embeddings
   */
  getDimensions(): number {
    if (!this.initialized) {
      throw new Error('Embedding generator not initialized. Call initialize() first.');
    }
    return this.dimensions;
  }

  /**
   * Clean up resources
   */
  async dispose(): Promise<void> {
    if (this.pipeline) {
      // Transformers.js pipelines don't have explicit disposal
      // but we can clear the reference
      this.pipeline = null;
    }
    this.initialized = false;
    this.dimensions = 0;
  }

  /**
   * Generate embedding with mean pooling and normalization
   */
  private async generateEmbedding(text: string): Promise<Float32Array> {
    if (!this.pipeline) {
      throw new Error('Pipeline not initialized');
    }

    try {
      const output = await this.pipeline(text, {
        pooling: 'mean',
        normalize: true,
      });

      return this.extractEmbedding(output);
    } catch (error) {
      throw new Error(`Failed to generate embedding: ${(error as Error).message}`);
    }
  }

  /**
   * Extract Float32Array from pipeline output
   */
  private extractEmbedding(output: any): Float32Array {
    // Handle different output formats from Transformers.js
    if (output instanceof Float32Array) {
      return output;
    }

    if (output.data && output.data instanceof Float32Array) {
      return output.data;
    }

    if (Array.isArray(output.data)) {
      return new Float32Array(output.data);
    }

    if (output.tolist) {
      const data = output.tolist();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        // Handle 2D array (batch output)
        return new Float32Array(data[0]);
      }
      return new Float32Array(data);
    }

    throw new Error('Unexpected output format from embedding pipeline');
  }

  /**
   * Ensure the generator is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Embedding generator not initialized. Call initialize() first.');
    }
  }

  /**
   * Sleep utility for retry logic
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
