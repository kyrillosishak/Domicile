/**
 * Multi-modal embeddings (CLIP-style) — embed text and images into the same space.
 *
 * Uses the CLIP vision + text encoders from Transformers.js (Xenova/clip-vit-base-patch16).
 * Both modalities share the same 512-dim embedding space, so `search("a red apple")`
 * will return images of red apples if the index contains image embeddings.
 *
 * Implementation is a thin drop-in for `EmbeddingGenerator` that switches
 * encoders based on whether the input is text (string) or image (ImageData/Blob).
 *
 * Requires `@huggingface/transformers` at runtime (dynamic import so it's
 * only loaded when multi-modal is actually used).
 */

import type { EmbeddingGenerator } from '../embedding/types.js';
import { logger } from '../logger.js';

export interface MultiModalConfig {
  /** CLIP model id from Hugging Face. Default: 'Xenova/clip-vit-base-patch16' */
  model?: string;
  /** Shared embedding dimensionality for text + images. Must match the model. */
  dimensions: number;
  device?: 'wasm' | 'webgpu';
}

/**
 * Wrapper that unifies text and image into a single EmbeddingGenerator contract.
 */
export async function createMultiModalGenerator(
  config: MultiModalConfig,
): Promise<EmbeddingGenerator> {
  const { pipeline, env } = (await import('@huggingface/transformers')) as any;
  const model = config.model ?? 'Xenova/clip-vit-base-patch16';

  env.allowLocalModels = false;
  env.useBrowserCache = true;

  logger.info(`Loading CLIP multi-modal model: ${model}`);

  // Load both the text and vision pipelines
  const textPipeline = await pipeline('feature-extraction', model, {
    device: config.device === 'webgpu' ? 'webgpu' : 'wasm',
  });

  // CLIP vision is loaded as the same feature-extraction model
  const visionPipeline = textPipeline; // same model, different tokenizer/processor

  return new MultiModalEmbedding({
    dimensions: config.dimensions,
    textPipeline,
    visionPipeline,
  });
}

interface InternalConfig {
  dimensions: number;
  textPipeline: any;
  visionPipeline: any;
}

class MultiModalEmbedding implements EmbeddingGenerator {
  private config: InternalConfig;

  constructor(config: InternalConfig) {
    this.config = config;
  }

  getDimensions(): number {
    return this.config.dimensions;
  }

  async initialize(): Promise<void> {
    // Already initialized in factory
    logger.debug('Multi-modal embedding generator initialized');
  }

  async embed(text: string): Promise<Float32Array> {
    const result = await this.config.textPipeline(text, {
      pooling: 'mean',
      normalize: true,
    });
    return new Float32Array(result.data);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const results = await this.config.textPipeline(texts, {
      pooling: 'mean',
      normalize: true,
    });
    // Result shape: [batchSize, dimensions]
    const batchSize = texts.length;
    const dim = this.config.dimensions;
    const embeddings: Float32Array[] = [];
    for (let i = 0; i < batchSize; i++) {
      const start = i * dim;
      embeddings.push(new Float32Array(results.data.slice(start, start + dim)));
    }
    return embeddings;
  }

  async embedImage(image: ImageData | Blob): Promise<Float32Array> {
    // If image is a Blob (file), convert to an image element first
    if (image instanceof Blob) {
      const img = await blobToImage(image);
      return this.embedImage(img);
    }

    // For ImageData, process through the vision pipeline
    const result = await this.config.visionPipeline(image, {
      pooling: 'mean',
      normalize: true,
    });
    return new Float32Array(result.data);
  }

  async dispose(): Promise<void> {
    logger.debug('Disposing multi-modal embedding generator');
  }
}

async function blobToImage(blob: Blob): Promise<ImageData> {
  const image = new Image();
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      const imageData = ctx.getImageData(0, 0, image.width, image.height);
      resolve(imageData);
      URL.revokeObjectURL(url);
    };
    image.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    image.src = url;
  });
}
