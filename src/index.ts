/**
 * Browser-based Vector Database
 * 
 * A production-quality vector database that runs entirely in the browser
 * with support for semantic search, RAG pipelines, and local LLM integration.
 */

// Core API
// `Domicile` is the public name; `VectorDB` remains as an alias for back-compat.
export { VectorDB } from './core/VectorDB';
export { VectorDB as Domicile } from './core/VectorDB';
export { createDomicile } from './core/factory';
export type { CreateDomicileOptions } from './core/factory';
export type {
  VectorDBConfig,
  InjectedConfig,
  StorageConfig,
  IndexConfig,
  EmbeddingConfig,
  LLMConfig,
  InsertData,
  ExportData,
  ExportOptions,
  ImportOptions
} from './core/types';

// Core seam contracts + capabilities + residency
export type {
  StorageManager as StorageManagerContract,
  Index,
  IndexHit,
  SerializedIndex,
  EmbeddingGenerator as EmbeddingGeneratorContract,
  LLMProvider as LLMProviderContract,
  GenerateOptions as GenerateOptionsContract,
} from './core/contracts';
export { detectCapabilities } from './core/capabilities';
export type { Capabilities } from './core/capabilities';
export { ResidencyGuard, ResidencyViolationError } from './core/residency';
export type { ResidencyConfig } from './core/residency';

// Model registry — curated catalog + init/pre-flight gating
export { ModelRegistry, getModelRegistry } from './core/ModelRegistry';
export type {
  EmbeddingModelEntry,
  LLMModelEntry,
  CanRunResult,
  DeviceTier as ModelDeviceTier,
  EmbeddingDevice,
  LLMProviderKind,
} from './core/ModelRegistry';

// Storage
export type { VectorRecord, MetadataFilter, CompoundFilter, Filter, StorageManager } from './storage/types';
export { IndexedDBStorage } from './storage/IndexedDBStorage';

// Index
export type { SearchQuery, SearchResult, IndexStats } from './index/types';
export { HnswIndex } from './index/HnswIndex';
export type { HnswIndexConfig } from './index/HnswIndex';
export { benchmarkIndex, benchmarkSuite } from './index/IndexBenchmark';
export type { BenchmarkScalePoint, IndexMetrics, BenchmarkOptions } from './index/IndexBenchmark';
export type { BenchmarkResult as IndexBenchmarkResult } from './index/IndexBenchmark';

// Citation-accuracy benchmark (TECHNICAL_VALIDATION.md §5)
export {
  benchmarkCitationAccuracy,
  DEFAULT_LEGAL_CORPUS,
  DEFAULT_LEGAL_QUESTIONS,
} from './rag/CitationBenchmark';
export type {
  CitationBenchmarkResult,
  CitationBenchmarkOptions,
  CitationVariant,
  CitationVariantResult,
  CorpusPassage,
  KnownAnswerQuestion,
} from './rag/CitationBenchmark';

// Embedding
export type { EmbeddingGenerator } from './embedding/types';
export { TransformersEmbedding, type TransformersEmbeddingConfig } from './embedding/TransformersEmbedding';

// LLM
export type { LLMProvider, GenerateOptions } from './llm/types';
export { WllamaProvider, type WllamaProviderConfig } from './llm/WllamaProvider';
export { WebLLMProvider, type WebLLMProviderConfig } from './llm/WebLLMProvider';
export { FallbackLLMProvider } from './llm/FallbackLLMProvider';

// RAG
export { RAGPipelineManager, type RAGPipelineConfig } from './rag/RAGPipelineManager';
export type { RAGPipeline, RAGOptions, RAGResult, RAGStreamChunk, PromptTemplate, Citation } from './rag/types';
export { SentenceChunker } from './rag/Chunker';
export type { Chunker, ChunkerOptions, Chunk } from './rag/Chunker';
export { BM25Index, reciprocalRankFusion, tokenize } from './rag/HybridSearch';
export type { HybridSearchOptions, RankedDoc } from './rag/HybridSearch';
export { TransformersReranker, NoopReranker } from './rag/Reranker';
export type { Reranker, RerankerOptions } from './rag/Reranker';
export { CharTokenizer, TransformersTokenizer } from './rag/Tokenizer';
export type { Tokenizer } from './rag/Tokenizer';

// MCP
export { MCPServer, type MCPServerConfig } from './mcp/MCPServer';
export type { MCPTool, JSONSchema } from './mcp/types';

// React hooks (optional surface; consumers bring their own React)
export {
  useDomicile,
  useSearch,
  useRag,
  useRagStream,
  useCapabilities,
  useIngestProgress,
} from './react';
export type {
  UseDomicileConfig,
  UseDomicileResult,
  UseSearchResult,
  UseRagResult,
  UseRagStreamResult,
  UseCapabilitiesResult,
  UseIngestProgressResult,
  IngestProgress,
} from './react';

// Errors
export { 
  VectorDBError, 
  StorageQuotaError, 
  DimensionMismatchError, 
  ModelLoadError, 
  IndexCorruptedError,
  InputValidator,
  ErrorHandler,
  DEFAULT_RETRY_CONFIG,
  type RetryConfig
} from './errors';

// Performance
export { 
  LRUCache,
  MemoryManager,
  WorkerPool,
  ProgressiveLoader,
  BatchOptimizer,
  PerformanceOptimizer,
  Benchmark,
  BenchmarkRunner
} from './performance';
export type {
  CacheEntry,
  LRUCacheConfig,
  MemoryManagerConfig,
  MemoryStats,
  WorkerTask,
  WorkerResponse,
  WorkerPoolConfig,
  ProgressiveLoaderConfig,
  LoadProgress,
  BatchOptimizerConfig,
  PendingOperation,
  PerformanceConfig,
  BenchmarkResult,
  BenchmarkEnvironment,
  BenchmarkSuite
} from './performance';

// Version
export const VERSION = '0.2.0';
