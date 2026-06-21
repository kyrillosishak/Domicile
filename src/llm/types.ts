/**
 * LLM layer types
 */

export interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
}

export interface LLMProvider {
  initialize(): Promise<void>;
  generate(prompt: string, options?: GenerateOptions): Promise<string>;
  generateStream(prompt: string, options?: GenerateOptions): AsyncGenerator<string>;
  /**
   * Non-throwing capability probe. Returns true if this provider can run
   * in the current environment (e.g. WebGPU present for WebLLM). Used by
   * FallbackLLMProvider to cascade providers without try/catching a
   * thrown init.
   */
  isAvailable(): Promise<boolean>;
  dispose(): Promise<void>;
}
