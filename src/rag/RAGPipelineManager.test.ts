/**
 * Tests for RAGPipelineManager
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RAGPipelineManager } from './RAGPipelineManager';
import type { VectorDB } from '../core/VectorDB';
import type { LLMProvider } from '../llm/types';
import type { EmbeddingGenerator } from '../embedding/types';
import type { SearchResult } from '../index/types';
import type { RAGStreamChunk } from './types';

describe('RAGPipelineManager', () => {
  let mockVectorDB: VectorDB;
  let mockLLMProvider: LLMProvider;
  let mockEmbeddingGenerator: EmbeddingGenerator;
  let ragPipeline: RAGPipelineManager;

  const mockSearchResults: SearchResult[] = [
    {
      id: '1',
      score: 0.95,
      metadata: {
        content: 'The capital of France is Paris.',
        title: 'France Facts',
      },
    },
    {
      id: '2',
      score: 0.85,
      metadata: {
        content: 'Paris is known for the Eiffel Tower.',
        title: 'Paris Landmarks',
      },
    },
  ];

  beforeEach(() => {
    // Mock VectorDB
    mockVectorDB = {
      search: vi.fn().mockResolvedValue(mockSearchResults),
    } as any;

    // Mock LLMProvider
    mockLLMProvider = {
      initialize: vi.fn().mockResolvedValue(undefined),
      generate: vi.fn().mockResolvedValue('Paris is the capital of France.'),
      generateStream: vi.fn().mockImplementation(async function* () {
        yield 'Paris ';
        yield 'is ';
        yield 'the ';
        yield 'capital ';
        yield 'of ';
        yield 'France.';
      }),
      dispose: vi.fn().mockResolvedValue(undefined),
    } as any;

    // Mock EmbeddingGenerator
    mockEmbeddingGenerator = {
      initialize: vi.fn().mockResolvedValue(undefined),
      embed: vi.fn().mockResolvedValue(new Float32Array([0.1, 0.2, 0.3])),
      embedBatch: vi.fn().mockResolvedValue([new Float32Array([0.1, 0.2, 0.3])]),
      embedImage: vi.fn().mockResolvedValue(new Float32Array([0.1, 0.2, 0.3])),
      getDimensions: vi.fn().mockReturnValue(3),
      dispose: vi.fn().mockResolvedValue(undefined),
    } as any;

    // Create RAG pipeline
    ragPipeline = new RAGPipelineManager({
      vectorDB: mockVectorDB,
      llmProvider: mockLLMProvider,
      embeddingGenerator: mockEmbeddingGenerator,
    });
  });

  describe('query', () => {
    it('should execute complete RAG query flow', async () => {
      const result = await ragPipeline.query('What is the capital of France?');

      // Verify embedding was generated
      expect(mockEmbeddingGenerator.embed).toHaveBeenCalledWith('What is the capital of France?');

      // Verify search was performed
      expect(mockVectorDB.search).toHaveBeenCalledWith({
        vector: expect.any(Float32Array),
        k: 5,
        filter: undefined,
        includeVectors: false,
      });

      // Verify LLM generation was called
      expect(mockLLMProvider.generate).toHaveBeenCalled();

      // Verify result structure
      expect(result).toHaveProperty('answer');
      expect(result).toHaveProperty('sources');
      expect(result).toHaveProperty('metadata');
      expect(result.answer).toBe('Paris is the capital of France.');
      expect(result.sources).toHaveLength(2);
      expect(result.metadata).toHaveProperty('retrievalTime');
      expect(result.metadata).toHaveProperty('generationTime');
      expect(result.metadata).toHaveProperty('tokensGenerated');
      expect(result.metadata).toHaveProperty('contextLength');
    });

    it('should use custom topK value', async () => {
      await ragPipeline.query('What is the capital of France?', { topK: 3 });

      expect(mockVectorDB.search).toHaveBeenCalledWith({
        vector: expect.any(Float32Array),
        k: 3,
        filter: undefined,
        includeVectors: false,
      });
    });

    it('should apply metadata filters', async () => {
      const filter = { field: 'category', operator: 'eq' as const, value: 'geography' };
      await ragPipeline.query('What is the capital of France?', { filter });

      expect(mockVectorDB.search).toHaveBeenCalledWith({
        vector: expect.any(Float32Array),
        k: 5,
        filter,
        includeVectors: false,
      });
    });

    it('should pass generation options to LLM', async () => {
      const generateOptions = {
        maxTokens: 100,
        temperature: 0.5,
      };

      await ragPipeline.query('What is the capital of France?', { generateOptions });

      expect(mockLLMProvider.generate).toHaveBeenCalledWith(
        expect.any(String),
        generateOptions
      );
    });

    it('should handle empty search results', async () => {
      mockVectorDB.search = vi.fn().mockResolvedValue([]);

      const result = await ragPipeline.query('Unknown query');

      expect(result.sources).toHaveLength(0);
      expect(mockLLMProvider.generate).toHaveBeenCalled();
    });

    it('should exclude sources when includeSourcesInResponse is false', async () => {
      const result = await ragPipeline.query('What is the capital of France?', {
        includeSourcesInResponse: false,
      });

      expect(result.sources).toHaveLength(0);
    });
  });

  describe('queryStream', () => {
    it('should stream RAG query results', async () => {
      const chunks: RAGStreamChunk[] = [];

      for await (const chunk of ragPipeline.queryStream('What is the capital of France?')) {
        chunks.push(chunk);
      }

      // Should have retrieval chunk, generation chunks, and complete chunk
      expect(chunks.length).toBeGreaterThan(2);

      // First chunk should be retrieval
      expect(chunks[0].type).toBe('retrieval');
      expect(chunks[0].sources).toHaveLength(2);
      expect(chunks[0].metadata).toHaveProperty('retrievalTime');

      // Middle chunks should be generation
      const generationChunks = chunks.filter(c => c.type === 'generation');
      expect(generationChunks.length).toBeGreaterThan(0);
      expect(generationChunks[0].content).toBeTruthy();

      // Last chunk should be complete
      expect(chunks[chunks.length - 1].type).toBe('complete');
      expect(chunks[chunks.length - 1].metadata).toHaveProperty('retrievalTime');
      expect(chunks[chunks.length - 1].metadata).toHaveProperty('generationTime');
    });

    it('should exclude sources in stream when includeSourcesInResponse is false', async () => {
      const chunks: RAGStreamChunk[] = [];

      for await (const chunk of ragPipeline.queryStream('What is the capital of France?', {
        includeSourcesInResponse: false,
      })) {
        chunks.push(chunk);
      }

      const retrievalChunk = chunks.find(c => c.type === 'retrieval');
      expect(retrievalChunk.sources).toHaveLength(0);
    });
  });

  describe('context formatting', () => {
    it('should use default context template', async () => {
      await ragPipeline.query('What is the capital of France?');

      const generateCall = (mockLLMProvider.generate as any).mock.calls[0][0];
      expect(generateCall).toContain('Document 1:');
      expect(generateCall).toContain('The capital of France is Paris.');
      expect(generateCall).toContain('Document 2:');
      expect(generateCall).toContain('Paris is known for the Eiffel Tower.');
    });

    it('should use custom context template', async () => {
      const customTemplate = '[{index}] {title}: {content}';
      await ragPipeline.query('What is the capital of France?', {
        contextTemplate: customTemplate,
      });

      const generateCall = (mockLLMProvider.generate as any).mock.calls[0][0];
      expect(generateCall).toContain('[1] France Facts: The capital of France is Paris.');
      expect(generateCall).toContain('[2] Paris Landmarks: Paris is known for the Eiffel Tower.');
    });

    it('should handle template with metadata placeholders', async () => {
      const customTemplate = '{content} (Score: {score})';
      await ragPipeline.query('What is the capital of France?', {
        contextTemplate: customTemplate,
      });

      const generateCall = (mockLLMProvider.generate as any).mock.calls[0][0];
      expect(generateCall).toContain('(Score: 0.9500)');
      expect(generateCall).toContain('(Score: 0.8500)');
    });
  });

  describe('context truncation', () => {
    it('should truncate long context to fit token limit', async () => {
      // Create a very long content
      const longContent = 'A'.repeat(10000);
      mockVectorDB.search = vi.fn().mockResolvedValue([
        {
          id: '1',
          score: 0.95,
          metadata: { content: longContent },
        },
      ]);

      await ragPipeline.query('Test query', { maxContextTokens: 100 });

      const generateCall = (mockLLMProvider.generate as any).mock.calls[0][0];
      // Should be truncated (100 tokens ≈ 400 chars)
      expect(generateCall.length).toBeLessThan(longContent.length + 500);
      expect(generateCall).toContain('[Context truncated due to length...]');
    });

    it('should not truncate short context', async () => {
      await ragPipeline.query('What is the capital of France?', { maxContextTokens: 5000 });

      const generateCall = (mockLLMProvider.generate as any).mock.calls[0][0];
      expect(generateCall).not.toContain('[Context truncated due to length...]');
    });
  });

  describe('configuration', () => {
    it('should allow setting custom context template', () => {
      const customTemplate = 'Custom: {content}';
      ragPipeline.setContextTemplate(customTemplate);

      const config = ragPipeline.getConfig();
      expect(config.defaultContextTemplate).toBe(customTemplate);
    });

    it('should allow setting max context tokens', () => {
      ragPipeline.setMaxContextTokens(1000);

      const config = ragPipeline.getConfig();
      expect(config.defaultMaxContextTokens).toBe(1000);
    });

    it('should use custom defaults from constructor', () => {
      const customPipeline = new RAGPipelineManager({
        vectorDB: mockVectorDB,
        llmProvider: mockLLMProvider,
        embeddingGenerator: mockEmbeddingGenerator,
        defaultContextTemplate: 'Custom: {content}',
        defaultMaxContextTokens: 1500,
      });

      const config = customPipeline.getConfig();
      expect(config.defaultContextTemplate).toBe('Custom: {content}');
      expect(config.defaultMaxContextTokens).toBe(1500);
    });
  });

  describe('prompt building', () => {
    it('should build proper prompt with context and query', async () => {
      await ragPipeline.query('What is the capital of France?');

      const generateCall = (mockLLMProvider.generate as any).mock.calls[0][0];
      expect(generateCall).toContain('Context:');
      expect(generateCall).toContain('Question: What is the capital of France?');
      expect(generateCall).toContain('Answer:');
    });
  });

  describe('metadata tracking', () => {
    it('should track retrieval and generation times', async () => {
      const result = await ragPipeline.query('What is the capital of France?');

      expect(result.metadata.retrievalTime).toBeGreaterThanOrEqual(0);
      expect(result.metadata.generationTime).toBeGreaterThanOrEqual(0);
    });

    it('should estimate token counts', async () => {
      const result = await ragPipeline.query('What is the capital of France?');

      expect(result.metadata.tokensGenerated).toBeGreaterThan(0);
      expect(result.metadata.contextLength).toBeGreaterThan(0);
    });
  });
});
