# API Reference

Complete API documentation for Browser VectorDB with TypeScript signatures and examples.

## Table of Contents

- [VectorDB](#vectordb)
- [Storage](#storage)
- [Index Manager](#index-manager)
- [Embedding Generator](#embedding-generator)
- [LLM Providers](#llm-providers)
- [RAG Pipeline](#rag-pipeline)
- [MCP Server](#mcp-server)
- [Performance](#performance)
- [Types](#types)

---

## VectorDB

The main entry point for all vector database operations.

### Constructor

```typescript
constructor(config: VectorDBConfig)
```

Creates a new VectorDB instance with the specified configuration.

**Parameters:**

```typescript
interface VectorDBConfig {
  storage: StorageConfig;
  index: IndexConfig;
  embedding: EmbeddingConfig;
  llm?: LLMConfig;
}

interface StorageConfig {
  dbName: string;           // IndexedDB database name
  version?: number;         // Database version (default: 1)
  maxVectors?: number;      // Maximum vectors to store
}

interface IndexConfig {
  indexType: 'hnsw';        // Index type (pure-TS HNSW)
  dimensions: number;       // Vector dimensions
  metric: 'cosine' | 'euclidean' | 'dot';  // Distance metric
  parameters?: Record<string, any>;        // Index-specific parameters
}

interface EmbeddingConfig {
  model: string;            // HuggingFace model ID
  device: 'wasm' | 'webgpu'; // Computation device
  cache?: boolean;          // Enable model caching (default: true)
  quantized?: boolean;      // Use quantized model (default: false)
}

interface LLMConfig {
  provider: 'wllama' | 'webllm';  // LLM provider
  model: string;                   // Model path or ID
  options?: Record<string, any>;   // Provider-specific options
}
```

**Example:**

```typescript
import { VectorDB } from '@vectordb/browser-vectordb';

const db = new VectorDB({
  storage: {
    dbName: 'my-app',
    maxVectors: 100000,
  },
  index: {
    indexType: 'hnsw',
    dimensions: 384,
    metric: 'cosine',
  },
  embedding: {
    model: 'Xenova/all-MiniLM-L6-v2',
    device: 'wasm',
    cache: true,
  },
  llm: {
    provider: 'wllama',
    model: 'https://huggingface.co/.../model.gguf',
  },
});
```

### initialize()

```typescript
async initialize(): Promise<void>
```

Initializes the database, loading storage, index, and embedding models.

**Throws:**
- `VectorDBError` - If initialization fails

**Example:**

```typescript
await db.initialize();
console.log('Database initialized');
```

### insert()

```typescript
async insert(data: InsertData): Promise<string>
```

Inserts a single document with automatic embedding generation.

**Parameters:**

```typescript
interface InsertData {
  text?: string;                    // Text to embed (if vector not provided)
  vector?: Float32Array;            // Pre-computed vector
  metadata?: Record<string, any>;   // Document metadata
}
```

**Returns:** Document ID (UUID v4)

**Throws:**
- `DimensionMismatchError` - If vector dimensions don't match
- `StorageQuotaError` - If storage quota exceeded

**Example:**

```typescript
const id = await db.insert({
  text: 'The quick brown fox jumps over the lazy dog',
  metadata: {
    title: 'Example Document',
    category: 'examples',
    tags: ['demo', 'test'],
    timestamp: Date.now(),
  },
});

console.log('Inserted document:', id);
```

### insertBatch()

```typescript
async insertBatch(data: InsertData[]): Promise<string[]>
```

Inserts multiple documents in a single batch operation for better performance.

**Parameters:** Array of `InsertData` objects

**Returns:** Array of document IDs

**Example:**

```typescript
const documents = [
  { text: 'Document 1', metadata: { category: 'tech' } },
  { text: 'Document 2', metadata: { category: 'science' } },
  { text: 'Document 3', metadata: { category: 'tech' } },
];

const ids = await db.insertBatch(documents);
console.log(`Inserted ${ids.length} documents`);
```

### search()

```typescript
async search(query: SearchQuery): Promise<SearchResult[]>
```

Searches for similar vectors using text or vector query.

**Parameters:**

```typescript
interface SearchQuery {
  text?: string;                    // Query text (will generate embedding)
  vector?: Float32Array;            // Pre-computed query vector
  k: number;                        // Number of results to return
  filter?: MetadataFilter;          // Metadata filtering
  includeVectors?: boolean;         // Include vectors in results (default: false)
}

interface MetadataFilter {
  field: string;                    // Metadata field name
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';
  value: any;                       // Filter value
}
```

**Returns:**

```typescript
interface SearchResult {
  id: string;                       // Document ID
  score: number;                    // Similarity score (0-1)
  metadata: Record<string, any>;    // Document metadata
  vector?: Float32Array;            // Vector (if includeVectors: true)
}
```

**Example:**

```typescript
// Text search
const results = await db.search({
  text: 'machine learning algorithms',
  k: 10,
});

// Vector search with filtering
const queryVector = await db.embedding.embed('AI research');
const filtered = await db.search({
  vector: queryVector,
  k: 5,
  filter: {
    field: 'category',
    operator: 'eq',
    value: 'tech',
  },
});

// Range filtering
const recent = await db.search({
  text: 'latest news',
  k: 10,
  filter: {
    field: 'timestamp',
    operator: 'gte',
    value: Date.now() - 86400000, // Last 24 hours
  },
});

// Array membership
const tagged = await db.search({
  text: 'tutorials',
  k: 10,
  filter: {
    field: 'tags',
    operator: 'contains',
    value: 'beginner',
  },
});
```

### delete()

```typescript
async delete(id: string): Promise<boolean>
```

Deletes a document by ID.

**Parameters:**
- `id` - Document ID to delete

**Returns:** `true` if deleted, `false` if not found

**Example:**

```typescript
const deleted = await db.delete('doc-id-123');
if (deleted) {
  console.log('Document deleted');
}
```

### update()

```typescript
async update(id: string, data: Partial<InsertData>): Promise<boolean>
```

Updates a document's metadata or vector.

**Parameters:**
- `id` - Document ID
- `data` - Partial update data

**Returns:** `true` if updated, `false` if not found

**Example:**

```typescript
await db.update('doc-id-123', {
  metadata: {
    category: 'updated-category',
    lastModified: Date.now(),
  },
});
```

### clear()

```typescript
async clear(): Promise<void>
```

Removes all documents from the database.

**Example:**

```typescript
await db.clear();
console.log('Database cleared');
```

### size()

```typescript
async size(): Promise<number>
```

Returns the number of documents in the database.

**Example:**

```typescript
const count = await db.size();
console.log(`Database contains ${count} documents`);
```

### export()

```typescript
async export(): Promise<ExportData>
```

Exports the entire database to a portable format.

**Returns:**

```typescript
interface ExportData {
  version: string;                  // Schema version
  config: VectorDBConfig;           // Database configuration
  vectors: VectorRecord[];          // All vectors and metadata
  index: string;                    // Serialized index
  metadata: {
    exportedAt: number;
    vectorCount: number;
    dimensions: number;
  };
}
```

**Example:**

```typescript
const data = await db.export();
const json = JSON.stringify(data);
// Save to file or send to server
localStorage.setItem('db-backup', json);
```

### import()

```typescript
async import(data: ExportData): Promise<void>
```

Imports data from an exported database.

**Parameters:**
- `data` - Exported database data

**Throws:**
- `VectorDBError` - If data is invalid or incompatible

**Example:**

```typescript
const json = localStorage.getItem('db-backup');
const data = JSON.parse(json);
await db.import(data);
console.log('Database imported');
```

### dispose()

```typescript
async dispose(): Promise<void>
```

Cleans up resources and closes the database.

**Example:**

```typescript
await db.dispose();
console.log('Database disposed');
```

---

## Storage

IndexedDB storage manager for vectors and metadata.

### IndexedDBStorage

```typescript
class IndexedDBStorage implements StorageManager
```

### put()

```typescript
async put(record: VectorRecord): Promise<void>
```

Stores a single vector record.

**Parameters:**

```typescript
interface VectorRecord {
  id: string;
  vector: Float32Array;
  metadata: Record<string, any>;
  timestamp: number;
}
```

### putBatch()

```typescript
async putBatch(records: VectorRecord[]): Promise<void>
```

Stores multiple vector records in a single transaction.

### get()

```typescript
async get(id: string): Promise<VectorRecord | null>
```

Retrieves a vector record by ID.

### getBatch()

```typescript
async getBatch(ids: string[]): Promise<VectorRecord[]>
```

Retrieves multiple vector records by IDs.

### delete()

```typescript
async delete(id: string): Promise<boolean>
```

Deletes a vector record by ID.

### clear()

```typescript
async clear(): Promise<void>
```

Removes all vector records.

### filter()

```typescript
async filter(predicate: MetadataFilter): Promise<VectorRecord[]>
```

Filters records by metadata criteria.

### count()

```typescript
async count(): Promise<number>
```

Returns the total number of records.

### saveIndex()

```typescript
async saveIndex(serializedIndex: string): Promise<void>
```

Persists the serialized index to storage.

### loadIndex()

```typescript
async loadIndex(): Promise<string | null>
```

Loads the serialized index from storage.

---

## Index

Vector indexing and similarity search using the pure-TypeScript HNSW graph
index (`HnswIndex`). Returns **real** similarity scores (cosine/euclidean/dot),
supports non-rebuilding mark-based delete, and recall-guaranteed filtered
search. It replaced the previous WASM k-d tree (Voy) after winning the
benchmark gate on real scores, delete latency, and recall parity.

> Construction is normally via `createDomicile()`, which wires an `HnswIndex`
> through the injection seam. The `IndexManager` (Voy) class has been removed.

### HnswIndex

```typescript
class HnswIndex
```

### build()

```typescript
async build(vectors: VectorRecord[]): Promise<void>
```

Builds the index from a collection of vectors.

### add()

```typescript
async add(vector: VectorRecord): Promise<void>
```

Adds a single vector to the index.

### addBatch()

```typescript
async addBatch(vectors: VectorRecord[]): Promise<void>
```

Adds multiple vectors to the index.

### remove()

```typescript
async remove(id: string): Promise<void>
```

Removes a vector from the index (mark-based; no full rebuild).

### search()

```typescript
async search(
  query: Float32Array,
  k: number,
  filter?: MetadataFilter
): Promise<SearchResult[]>
```

Searches for k nearest neighbors. Returns hits with real scores.

### serialize()

```typescript
async serialize(): Promise<string>
```

Serializes the index to a string.

### deserialize()

```typescript
async deserialize(data: string): Promise<void>
```

Deserializes the index from a string.

### getStats()

```typescript
getStats(): IndexStats
```

Returns index statistics.

**Returns:**

```typescript
interface IndexStats {
  vectorCount: number;
  dimensions: number;
  indexType: string;
  memoryUsage: number;
  lastUpdated: number;
}
```

---

## Embedding Generator

Text and image embedding generation using Transformers.js.

### TransformersEmbedding

```typescript
class TransformersEmbedding implements EmbeddingGenerator
```

### initialize()

```typescript
async initialize(): Promise<void>
```

Loads the embedding model.

### embed()

```typescript
async embed(text: string): Promise<Float32Array>
```

Generates an embedding for text.

**Example:**

```typescript
const embedding = new TransformersEmbedding({
  model: 'Xenova/all-MiniLM-L6-v2',
  device: 'wasm',
});

await embedding.initialize();
const vector = await embedding.embed('Hello world');
console.log(vector.length); // 384
```

### embedBatch()

```typescript
async embedBatch(texts: string[]): Promise<Float32Array[]>
```

Generates embeddings for multiple texts.

**Example:**

```typescript
const texts = ['Text 1', 'Text 2', 'Text 3'];
const vectors = await embedding.embedBatch(texts);
console.log(`Generated ${vectors.length} embeddings`);
```

### embedImage()

```typescript
async embedImage(image: ImageData | Blob): Promise<Float32Array>
```

Generates an embedding for an image (requires CLIP model).

**Example:**

```typescript
const embedding = new TransformersEmbedding({
  model: 'Xenova/clip-vit-base-patch32',
  device: 'wasm',
});

await embedding.initialize();

// From canvas
const canvas = document.getElementById('myCanvas');
const ctx = canvas.getContext('2d');
const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
const vector = await embedding.embedImage(imageData);

// From file
const file = document.getElementById('fileInput').files[0];
const blob = new Blob([await file.arrayBuffer()], { type: file.type });
const vector2 = await embedding.embedImage(blob);
```

### getDimensions()

```typescript
getDimensions(): number
```

Returns the embedding dimensions.

### dispose()

```typescript
async dispose(): Promise<void>
```

Cleans up model resources.

---

## LLM Providers

Local language model providers for text generation.

### WllamaProvider

WASM-based LLM inference using llama.cpp.

```typescript
class WllamaProvider implements LLMProvider
```

**Configuration:**

```typescript
interface WllamaConfig {
  model: string;                    // Model URL or path
  nThreads?: number;                // Number of threads (default: 4)
  nContext?: number;                // Context size (default: 2048)
  nGpuLayers?: number;              // GPU layers (default: 0)
}
```

**Example:**

```typescript
const llm = new WllamaProvider({
  model: 'https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf',
  nThreads: 4,
  nContext: 2048,
});

await llm.initialize();

const response = await llm.generate('What is machine learning?', {
  maxTokens: 256,
  temperature: 0.7,
});

console.log(response);
```

### WebLLMProvider

WebGPU-accelerated LLM inference.

```typescript
class WebLLMProvider implements LLMProvider
```

**Configuration:**

```typescript
interface WebLLMConfig {
  model: string;                    // Model ID from WebLLM catalog
  temperature?: number;             // Default temperature (default: 0.7)
  topP?: number;                    // Default top-p (default: 0.9)
}
```

**Example:**

```typescript
const llm = new WebLLMProvider({
  model: 'TinyLlama-1.1B-Chat-v1.0-q4f32_1-MLC',
  temperature: 0.7,
});

await llm.initialize();

// Streaming generation
const stream = llm.generateStream('Explain quantum computing', {
  maxTokens: 512,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

### Common Methods

Both providers implement the `LLMProvider` interface:

#### initialize()

```typescript
async initialize(): Promise<void>
```

Loads the language model.

#### generate()

```typescript
async generate(prompt: string, options?: GenerateOptions): Promise<string>
```

Generates text from a prompt.

**Options:**

```typescript
interface GenerateOptions {
  maxTokens?: number;               // Maximum tokens to generate
  temperature?: number;             // Sampling temperature (0-2)
  topP?: number;                    // Nucleus sampling threshold
  topK?: number;                    // Top-k sampling
  stopSequences?: string[];         // Stop generation at these sequences
}
```

#### generateStream()

```typescript
async generateStream(
  prompt: string,
  options?: GenerateOptions
): AsyncGenerator<ChatCompletionChunk>
```

Generates text with streaming output.

#### dispose()

```typescript
async dispose(): Promise<void>
```

Cleans up model resources.

---

## RAG Pipeline

Retrieval-Augmented Generation pipeline manager.

### RAGPipelineManager

```typescript
class RAGPipelineManager implements RAGPipeline
```

**Constructor:**

```typescript
constructor(
  vectorDB: VectorDB,
  llmProvider: LLMProvider,
  embeddingGenerator: EmbeddingGenerator
)
```

### query()

```typescript
async query(query: string, options?: RAGOptions): Promise<RAGResult>
```

Performs a RAG query with retrieval and generation.

**Parameters:**

```typescript
interface RAGOptions {
  topK?: number;                    // Number of documents to retrieve (default: 5)
  filter?: MetadataFilter;          // Metadata filtering
  contextTemplate?: string;         // Context formatting template
  generateOptions?: GenerateOptions; // LLM generation options
}
```

**Returns:**

```typescript
interface RAGResult {
  answer: string;                   // Generated answer
  sources: SearchResult[];          // Retrieved source documents
  metadata: {
    retrievalTime: number;          // Time spent on retrieval (ms)
    generationTime: number;         // Time spent on generation (ms)
    tokensGenerated: number;        // Number of tokens generated
  };
}
```

**Example:**

```typescript
const rag = new RAGPipelineManager(db, llm, embedding);

const result = await rag.query('What is machine learning?', {
  topK: 3,
  filter: {
    field: 'category',
    operator: 'eq',
    value: 'tech',
  },
  generateOptions: {
    maxTokens: 256,
    temperature: 0.7,
  },
});

console.log('Answer:', result.answer);
console.log('Sources:', result.sources.length);
console.log('Retrieval time:', result.metadata.retrievalTime, 'ms');
```

### queryStream()

```typescript
async queryStream(
  query: string,
  options?: RAGOptions
): AsyncGenerator<RAGStreamChunk>
```

Performs a RAG query with streaming generation.

**Returns:**

```typescript
interface RAGStreamChunk {
  type: 'retrieval' | 'generation';
  content: string;
  sources?: SearchResult[];
}
```

**Example:**

```typescript
const stream = rag.queryStream('Explain neural networks', {
  topK: 5,
});

for await (const chunk of stream) {
  if (chunk.type === 'retrieval') {
    console.log('Retrieved', chunk.sources?.length, 'documents');
  } else {
    process.stdout.write(chunk.content);
  }
}
```

---

## MCP Server

Model Context Protocol server for AI agent integration.

### MCPServer

```typescript
class MCPServer
```

**Constructor:**

```typescript
constructor(vectorDB: VectorDB, ragPipeline?: RAGPipeline)
```

### getTools()

```typescript
getTools(): MCPTool[]
```

Returns available MCP tools.

**Returns:**

```typescript
interface MCPTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  handler: (params: any) => Promise<any>;
}
```

### executeTool()

```typescript
async executeTool(name: string, params: any): Promise<any>
```

Executes an MCP tool by name.

**Example:**

```typescript
const mcp = new MCPServer(db, rag);

// Search vectors
const results = await mcp.executeTool('search_vectors', {
  query: 'machine learning',
  k: 5,
});

// Insert document
const id = await mcp.executeTool('insert_document', {
  content: 'Document text',
  metadata: { category: 'tech' },
});

// RAG query
const answer = await mcp.executeTool('rag_query', {
  query: 'What is AI?',
  topK: 3,
});
```

### Available Tools

#### search_vectors

Searches for similar vectors using text query.

**Parameters:**
- `query` (string, required): Search query text
- `k` (number, optional): Number of results (default: 5)
- `filter` (object, optional): Metadata filters

#### insert_document

Inserts a document with text content and metadata.

**Parameters:**
- `content` (string, required): Document text content
- `metadata` (object, optional): Document metadata

#### delete_document

Deletes a document by ID.

**Parameters:**
- `id` (string, required): Document ID

#### rag_query

Queries with retrieval-augmented generation.

**Parameters:**
- `query` (string, required): User question
- `topK` (number, optional): Number of documents to retrieve (default: 5)

---

## Performance

Performance optimization utilities.

### LRUCache

Least Recently Used cache implementation.

```typescript
class LRUCache<K, V>
```

**Constructor:**

```typescript
constructor(options: LRUCacheOptions)

interface LRUCacheOptions {
  max: number;                      // Maximum items
  maxSize?: number;                 // Maximum size in bytes
  sizeCalculation?: (value: V) => number;
  dispose?: (value: V, key: K) => void;
}
```

**Example:**

```typescript
const cache = new LRUCache<string, Float32Array>({
  max: 1000,
  maxSize: 100 * 1024 * 1024, // 100MB
  sizeCalculation: (v) => v.byteLength,
});

cache.set('key1', vector);
const cached = cache.get('key1');
```

### MemoryManager

Memory usage monitoring and management.

```typescript
class MemoryManager
```

**Methods:**

```typescript
getMemoryUsage(): MemoryInfo
checkMemoryPressure(): boolean
async evictIfNeeded(): Promise<void>
```

**Example:**

```typescript
const memoryManager = new MemoryManager({
  maxMemoryMB: 500,
  evictionThreshold: 0.9,
});

const usage = memoryManager.getMemoryUsage();
console.log('Memory used:', usage.usedMB, 'MB');

if (memoryManager.checkMemoryPressure()) {
  await memoryManager.evictIfNeeded();
}
```

### Benchmark

Performance benchmarking utilities.

```typescript
class Benchmark
```

**Methods:**

```typescript
async runSearchBenchmark(sizes: number[]): Promise<BenchmarkResult[]>
async runInsertBenchmark(count: number): Promise<BenchmarkResult>
async runMemoryBenchmark(): Promise<MemoryBenchmarkResult>
```

**Example:**

```typescript
const benchmark = new Benchmark(db);

const searchResults = await benchmark.runSearchBenchmark([1000, 10000, 50000]);
searchResults.forEach(r => {
  console.log(`${r.size} vectors: ${r.avgLatency}ms`);
});
```

---

## Types

### Core Types

```typescript
// Vector record
interface VectorRecord {
  id: string;
  vector: Float32Array;
  metadata: Record<string, any>;
  timestamp: number;
}

// Search query
interface SearchQuery {
  text?: string;
  vector?: Float32Array;
  k: number;
  filter?: MetadataFilter;
  includeVectors?: boolean;
}

// Search result
interface SearchResult {
  id: string;
  score: number;
  metadata: Record<string, any>;
  vector?: Float32Array;
}

// Metadata filter
interface MetadataFilter {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';
  value: any;
}
```

### Error Types

```typescript
class VectorDBError extends Error {
  code: string;
  details?: any;
}

class StorageQuotaError extends VectorDBError {}
class DimensionMismatchError extends VectorDBError {}
class ModelLoadError extends VectorDBError {}
class IndexCorruptedError extends VectorDBError {}
```

---

## Best Practices

### 1. Initialize Once

```typescript
// ✅ Good - Initialize once and reuse
const db = new VectorDB(config);
await db.initialize();

// ❌ Bad - Don't create multiple instances
const db1 = new VectorDB(config);
const db2 = new VectorDB(config);
```

### 2. Use Batch Operations

```typescript
// ✅ Good - Batch insert
await db.insertBatch(documents);

// ❌ Bad - Individual inserts
for (const doc of documents) {
  await db.insert(doc);
}
```

### 3. Clean Up Resources

```typescript
// ✅ Good - Dispose when done
try {
  await db.initialize();
  // Use database
} finally {
  await db.dispose();
}
```

### 4. Handle Errors

```typescript
// ✅ Good - Handle specific errors
try {
  await db.insert(data);
} catch (error) {
  if (error instanceof StorageQuotaError) {
    // Handle quota exceeded
    await db.export();
    await db.clear();
  } else if (error instanceof DimensionMismatchError) {
    // Handle dimension mismatch
    console.error('Vector dimensions do not match');
  } else {
    throw error;
  }
}
```

### 5. Use Metadata Filters

```typescript
// ✅ Good - Filter early
const results = await db.search({
  text: query,
  k: 10,
  filter: { field: 'category', operator: 'eq', value: 'tech' },
});

// ❌ Bad - Filter after search
const allResults = await db.search({ text: query, k: 100 });
const filtered = allResults.filter(r => r.metadata.category === 'tech');
```

---

## See Also

- [Quickstart Guide](./QUICKSTART.md)
- [RAG Tutorial](./RAG_TUTORIAL.md)
- [Performance Guide](./PERFORMANCE.md)
- [Examples](../examples/README.md)
