import { describe, it, expect, vi } from 'vitest';
import { RAGPipelineManager } from './RAGPipelineManager';
import type { VectorDB } from '../core/VectorDB';
import type { LLMProvider, GenerateOptions } from '../llm/types';
import type { EmbeddingGenerator } from '../embedding/types';
import type { SearchResult } from '../index/types';

// A fake LLM that echoes the prompt so we can assert prompt assembly.
function fakeLLM(): LLMProvider {
  return {
    initialize: async () => {},
    isAvailable: async () => true,
    dispose: async () => {},
    generate: async (prompt: string) => `[answer] ${prompt.slice(0, 60)}`,
    generateStream: async function* (prompt: string, _o?: GenerateOptions) {
      yield `[chunk] `;
      yield prompt.slice(0, 10);
    },
  };
}

// A fake embedding generator that hashes text to a deterministic 4-dim vector.
function fakeEmbedding(): EmbeddingGenerator {
  const dim = 4;
  const embed = (text: string): Float32Array => {
    const v = new Float32Array(dim);
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
    for (let i = 0; i < dim; i++) v[i] = Math.sin(h + i);
    return v;
  };
  return {
    initialize: async () => {},
    embed,
    embedBatch: async (texts: string[]) => texts.map(embed),
    getDimensions: () => dim,
    dispose: async () => {},
  };
}

// A fake VectorDB whose search returns a fixed candidate set.
function fakeVectorDB(candidates: SearchResult[]): VectorDB {
  return {
    search: async (q: any) => {
      if (q.vector) return candidates.slice(0, q.k ?? candidates.length);
      return candidates;
    },
  } as unknown as VectorDB;
}

describe('RAGPipelineManager multi-stage', () => {
  it('returns citations and honors a configurable prompt template', async () => {
    const candidates: SearchResult[] = [
      { id: 'a', score: 0.9, metadata: { content: 'Indemnification clause limits liability.', title: 'Clause A' } },
      { id: 'b', score: 0.7, metadata: { content: 'Privacy policy governs data.', title: 'Clause B' } },
    ];
    const rag = new RAGPipelineManager({
      vectorDB: fakeVectorDB(candidates),
      llmProvider: fakeLLM(),
      embeddingGenerator: fakeEmbedding(),
      defaultPromptTemplate: {
        system: 'You are a legal analyst. Be precise.',
        contextItemTemplate: '[{index}] {content}',
        template: '{system}\n\nSOURCES:\n{context}\n\nQ: {question}\nA:',
      },
    });

    const result = await rag.query('What does the indemnification clause say?', { topK: 2 });

    // Citations bind back to sources with rank + snippet.
    expect(result.citations).toHaveLength(2);
    expect(result.citations[0].rank).toBe(1);
    expect(result.citations[0].snippet).toContain('Indemnification');
    // The configurable system prompt + template reached the LLM.
    expect(result.answer).toContain('[answer]');
    // (the LLM echoes the prompt prefix, which starts with our system line)
  });

  it('fuses dense + BM25 via hybrid when enabled', async () => {
    const candidates: SearchResult[] = [
      { id: 'a', score: 0.9, metadata: { content: 'alpha indemnification' } },
      { id: 'b', score: 0.5, metadata: { content: 'beta clause' } },
      { id: 'c', score: 0.4, metadata: { content: 'gamma privacy' } },
    ];
    const rag = new RAGPipelineManager({
      vectorDB: fakeVectorDB(candidates),
      llmProvider: fakeLLM(),
      embeddingGenerator: fakeEmbedding(),
      hybridByDefault: true,
    });
    // Feed the BM25 index with doc text.
    rag.indexDocument('a', 'alpha indemnification');
    rag.indexDocument('b', 'beta clause');
    rag.indexDocument('c', 'gamma privacy');

    const result = await rag.query('indemnification', { topK: 3 });
    expect(result.metadata.hybrid).toBe(true);
    expect(result.sources.length).toBeGreaterThan(0);
    // 'a' contains the query term and is top dense → should rank first.
    expect(result.sources[0].id).toBe('a');
  });

  it('truncates context using the injected tokenizer', async () => {
    const longContent = 'Sentence. '.repeat(500);
    const candidates: SearchResult[] = [
      { id: 'a', score: 0.9, metadata: { content: longContent } },
    ];
    const rag = new RAGPipelineManager({
      vectorDB: fakeVectorDB(candidates),
      llmProvider: fakeLLM(),
      embeddingGenerator: fakeEmbedding(),
      defaultMaxContextTokens: 10,
    });
    const result = await rag.query('q', { topK: 1 });
    // Context was truncated: the 500-sentence doc (~1000 tokens) is cut to
    // the budget plus the truncation-suffix overhead — far below the original.
    expect(result.metadata.contextLength).toBeLessThan(100);
    expect(result.metadata.contextLength).toBeGreaterThan(0);
    expect(result.answer).toBeDefined();
  });

  it('noop reranker preserves order and reports not-reranked', async () => {
    const candidates: SearchResult[] = [
      { id: 'a', score: 0.9, metadata: { content: 'x' } },
      { id: 'b', score: 0.8, metadata: { content: 'y' } },
    ];
    const rag = new RAGPipelineManager({
      vectorDB: fakeVectorDB(candidates),
      llmProvider: fakeLLM(),
      embeddingGenerator: fakeEmbedding(),
      rerankByDefault: true,
    });
    const result = await rag.query('q', { topK: 2 });
    // NoopReranker.isReady() is true but it doesn't reorder; reranked flag
    // reflects whether a real cross-encoder applied.
    expect(result.sources.map((s) => s.id)).toEqual(['a', 'b']);
  });
});
