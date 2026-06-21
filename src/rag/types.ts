/**
 * RAG (Retrieval-Augmented Generation) layer types
 */

import type { SearchResult } from '../index/types';
import type { Filter } from '../storage/types';
import type { GenerateOptions } from '../llm/types';

/**
 * Configurable prompt template. Replaces the hardcoded English instruction
 * previously baked into the pipeline (PRODUCT_DESIGN.md B6, stage 4). Legal
 * use needs jurisdiction-aware instructions; this lets callers supply them
 * without forking the pipeline.
 *
 * Placeholders: {context} {question} {sources}
 */
export interface PromptTemplate {
  /** System/leading instruction, prepended to the context. */
  system?: string;
  /** How each context passage is framed. Placeholders: {index} {content} {title} */
  contextItemTemplate?: string;
  /** Joiner between context passages. Default '\n\n'. */
  contextJoin?: string;
  /** The full prompt assembly, with {system}{context}{question}. */
  template?: string;
}

export interface RAGOptions {
  topK?: number;
  filter?: Filter;
  contextTemplate?: string;
  promptTemplate?: PromptTemplate;
  generateOptions?: GenerateOptions;
  maxContextTokens?: number;
  includeSourcesInResponse?: boolean;
  /** Enable BM25+dense hybrid fusion. Default: pipeline config. */
  hybrid?: boolean;
  /** Enable cross-encoder reranking. Default: pipeline config. */
  rerank?: boolean;
}

export interface Citation {
  id: string;
  score: number;
  snippet: string;
  metadata: Record<string, any>;
  /** 1-based rank among sources returned. */
  rank: number;
}

export interface RAGResult {
  answer: string;
  sources: SearchResult[];
  citations: Citation[];
  metadata: {
    retrievalTime: number;
    generationTime: number;
    tokensGenerated?: number;
    contextLength?: number;
    reranked?: boolean;
    hybrid?: boolean;
  };
}

export interface RAGStreamChunk {
  type: 'retrieval' | 'generation' | 'complete';
  content: string;
  sources?: SearchResult[];
  metadata?: {
    retrievalTime?: number;
    generationTime?: number;
  };
}

export interface RAGPipeline {
  query(query: string, options?: RAGOptions): Promise<RAGResult>;
  queryStream(query: string, options?: RAGOptions): AsyncGenerator<RAGStreamChunk>;
}
