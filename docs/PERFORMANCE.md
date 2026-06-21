# Performance Tuning Guide

Optimize Browser VectorDB for production workloads. This guide covers performance optimization techniques, benchmarking, and best practices.

## Performance Overview

Browser VectorDB performance depends on several factors:
- **Dataset size**: Number of vectors and dimensions
- **Hardware**: CPU, GPU, memory availability
- **Configuration**: Index type, cache settings, device selection
- **Usage patterns**: Batch vs individual operations, query frequency

## Quick Wins

### 1. Use WebGPU

WebGPU provides significant speedup for embedding generation:

```typescript
// Check WebGPU support
const hasWebGPU = 'gpu' in navigator;

const db = new VectorDB({
  storage: { dbName: 'my-app' },
  index: { indexType: 'hnsw', dimensions: 384, metric: 'cosine' },
  embedding: {
    model: 'Xenova/all-MiniLM-L6-v2',
    device: hasWebGPU ? 'webgpu' : 'wasm',  // Use GPU if available
  },
});
```

**Performance Impact:**
- Embedding generation: 3-5x faster
- Batch operations: 5-10x faster

### 2. Enable Caching

Cache models and embeddings to avoid recomputation:

```typescript
const db = new VectorDB({
  storage: { dbName: 'my-app' },
  index: { indexType: 'hnsw', dimensions: 384, metric: 'cosine' },
  embedding: {
    model: 'Xenova/all-MiniLM-L6-v2',
    device: 'wasm',
    cache: true,  // Enable model caching
  },
});
```

**Performance Impact:**
- First load: Downloads model (~23MB)
- Subsequent loads: <1 second from cache

### 3. Use Batch Operations

Batch operations are significantly faster than individual operations:

```typescript
// ✅ Fast - Single transaction
await db.insertBatch(documents);

// ❌ Slow - Multiple transactions
for (const doc of documents) {
  await db.insert(doc);
}
```

**Performance Impact:**
- 10-50x faster for large batches
- Reduced IndexedDB overhead

### 4. Optimize Vector Dimensions

Smaller dimensions = faster operations:

```typescript
// Fast: 384 dimensions (all-MiniLM-L6-v2)
embedding: { model: 'Xenova/all-MiniLM-L6-v2' }  // 384d

// Slower: 768 dimensions (larger models)
embedding: { model: 'Xenova/bge-base-en-v1.5' }  // 768d
```

**Performance Impact:**
- Search latency: 2x faster with 384d vs 768d
- Memory usage: 2x less with 384d vs 768d

### 5. Limit Result Count

Only retrieve what you need:

```typescript
// ✅ Good - Reasonable limit
const results = await db.search({ text: query, k: 10 });

// ❌ Bad - Unnecessary overhead
const results = await db.search({ text: query, k: 1000 });
```

## Configuration Optimization

### Storage Configuration

```typescript
storage: {
  dbName: 'my-app',
  maxVectors: 100000,  // Set reasonable limit
}
```

**Recommendations:**
- Set `maxVectors` based on expected dataset size
- Monitor storage quota usage
- Export and archive old data periodically

### Index Configuration

```typescript
index: {
  indexType: 'hnsw',
  dimensions: 384,
  metric: 'cosine',  // Fastest for normalized embeddings
}
```

**Metric Performance:**
- `cosine`: Fastest for normalized embeddings (recommended)
- `dot`: Fast, but requires normalized vectors
- `euclidean`: Slower, use only if needed

### Embedding Configuration

```typescript
embedding: {
  model: 'Xenova/all-MiniLM-L6-v2',  // Small, fast model
  device: 'webgpu',                   // Use GPU if available
  cache: true,                        // Cache model
  quantized: false,                   // Quantization trades quality for speed
}
```

**Model Selection:**

| Model | Dimensions | Size | Speed | Quality |
|-------|-----------|------|-------|---------|
| all-MiniLM-L6-v2 | 384 | 23MB | Fast | Good |
| bge-small-en-v1.5 | 384 | 33MB | Fast | Better |
| bge-base-en-v1.5 | 768 | 109MB | Slower | Best |

## Memory Management

### LRU Cache

Use LRU cache to limit memory usage:

```typescript
import { LRUCache } from '@vectordb/browser-vectordb';

const cache = new LRUCache<string, Float32Array>({
  max: 1000,                          // Maximum items
  maxSize: 100 * 1024 * 1024,        // 100MB limit
  sizeCalculation: (v) => v.byteLength,
  dispose: (value, key) => {
    console.log(`Evicted ${key}`);
  },
});

// Use cache
cache.set('key1', vector);
const cached = cache.get('key1');
```

### Memory Manager

Monitor and manage memory usage:

```typescript
import { MemoryManager } from '@vectordb/browser-vectordb';

const memoryManager = new MemoryManager({
  maxMemoryMB: 500,           // Maximum memory usage
  evictionThreshold: 0.9,     // Evict at 90% usage
});

// Check memory usage
const usage = memoryManager.getMemoryUsage();
console.log(`Memory: ${usage.usedMB}MB / ${usage.totalMB}MB`);

// Evict if needed
if (memoryManager.checkMemoryPressure()) {
  await memoryManager.evictIfNeeded();
}
```

### Progressive Loading

Load large datasets progressively:

```typescript
import { ProgressiveLoader } from '@vectordb/browser-vectordb';

const loader = new ProgressiveLoader(db);

// Load in chunks
for await (const chunk of loader.loadVectorsInChunks(1000)) {
  console.log(`Loaded ${chunk.length} vectors`);
  // Process chunk
}
```

## Search Optimization

### Filter Early

Apply metadata filters during search, not after:

```typescript
// ✅ Good - Filter during search
const results = await db.search({
  text: query,
  k: 10,
  filter: {
    field: 'category',
    operator: 'eq',
    value: 'tech',
  },
});

// ❌ Bad - Filter after search
const allResults = await db.search({ text: query, k: 100 });
const filtered = allResults.filter(r => r.metadata.category === 'tech');
```

**Performance Impact:**
- 2-10x faster with early filtering
- Reduced memory usage

### Optimize Query Embeddings

Cache frequently used query embeddings:

```typescript
const queryCache = new Map<string, Float32Array>();

async function search(query: string, k: number) {
  // Check cache
  let vector = queryCache.get(query);
  
  if (!vector) {
    // Generate and cache
    vector = await db.embedding.embed(query);
    queryCache.set(query, vector);
  }
  
  // Search with cached vector
  return await db.search({ vector, k });
}
```

### Batch Queries

Process multiple queries in batch:

```typescript
// Generate embeddings in batch
const queries = ['query 1', 'query 2', 'query 3'];
const vectors = await db.embedding.embedBatch(queries);

// Search in parallel
const results = await Promise.all(
  vectors.map(vector => db.search({ vector, k: 10 }))
);
```

## Insertion Optimization

### Batch Inserts

Always use batch operations for multiple documents:

```typescript
// ✅ Fast - Batch insert
const documents = [...];  // 1000 documents
await db.insertBatch(documents);

// ❌ Slow - Individual inserts
for (const doc of documents) {
  await db.insert(doc);
}
```

**Performance Comparison:**

| Documents | Individual | Batch | Speedup |
|-----------|-----------|-------|---------|
| 100 | 5.2s | 0.3s | 17x |
| 1,000 | 52s | 2.1s | 25x |
| 10,000 | 520s | 18s | 29x |

### Pre-compute Embeddings

Generate embeddings in advance for faster insertion:

```typescript
// Generate embeddings in batch
const texts = documents.map(d => d.text);
const vectors = await db.embedding.embedBatch(texts);

// Insert with pre-computed vectors
const records = documents.map((doc, i) => ({
  vector: vectors[i],
  metadata: doc.metadata,
}));

await db.insertBatch(records);
```

### Defer Index Updates

For bulk inserts, consider rebuilding the index after:

```typescript
// Insert without index updates (if supported)
await db.insertBatch(documents, { updateIndex: false });

// Rebuild index once
await db.rebuildIndex();
```

## RAG Optimization

### Optimize Retrieval Count

Balance context quality and performance:

```typescript
// ✅ Good - Balanced
const result = await rag.query(question, { topK: 3 });

// ❌ Too few - Missing context
const result = await rag.query(question, { topK: 1 });

// ❌ Too many - Slow, noisy
const result = await rag.query(question, { topK: 50 });
```

**Recommendations:**
- Start with `topK: 3-5`
- Increase if answers lack context
- Decrease if generation is slow

### Stream Responses

Use streaming for better perceived performance:

```typescript
const stream = rag.queryStream(question, { topK: 3 });

for await (const chunk of stream) {
  if (chunk.type === 'generation') {
    // Display immediately
    process.stdout.write(chunk.content);
  }
}
```

### Cache RAG Results

Cache answers for common questions:

```typescript
const ragCache = new Map<string, RAGResult>();

async function queryWithCache(question: string) {
  // Check cache
  if (ragCache.has(question)) {
    return ragCache.get(question);
  }
  
  // Query and cache
  const result = await rag.query(question);
  ragCache.set(question, result);
  
  return result;
}
```

## Benchmarking

### Run Benchmarks

Use the built-in benchmark suite:

```typescript
import { Benchmark } from '@vectordb/browser-vectordb';

const benchmark = new Benchmark(db);

// Search latency
const searchResults = await benchmark.runSearchBenchmark([
  1000, 5000, 10000, 50000
]);

searchResults.forEach(r => {
  console.log(`${r.size} vectors: ${r.avgLatency}ms (p95: ${r.p95Latency}ms)`);
});

// Insert throughput
const insertResult = await benchmark.runInsertBenchmark(10000);
console.log(`Insert throughput: ${insertResult.throughput} docs/sec`);

// Memory usage
const memoryResult = await benchmark.runMemoryBenchmark();
console.log(`Memory usage: ${memoryResult.usedMB}MB`);
```

### Custom Benchmarks

Create custom benchmarks for your use case:

```typescript
async function benchmarkSearch(db: VectorDB, queries: string[], k: number) {
  const latencies: number[] = [];
  
  for (const query of queries) {
    const start = performance.now();
    await db.search({ text: query, k });
    const latency = performance.now() - start;
    latencies.push(latency);
  }
  
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const p95 = latencies.sort()[Math.floor(latencies.length * 0.95)];
  
  return { avg, p95, min: Math.min(...latencies), max: Math.max(...latencies) };
}

const results = await benchmarkSearch(db, testQueries, 10);
console.log('Search performance:', results);
```

## Performance Monitoring

### Track Metrics

Monitor key performance metrics:

```typescript
class PerformanceMonitor {
  private metrics = {
    searchLatency: [] as number[],
    insertLatency: [] as number[],
    cacheHits: 0,
    cacheMisses: 0,
  };

  recordSearch(latency: number) {
    this.metrics.searchLatency.push(latency);
  }

  recordInsert(latency: number) {
    this.metrics.insertLatency.push(latency);
  }

  recordCacheHit() {
    this.metrics.cacheHits++;
  }

  recordCacheMiss() {
    this.metrics.cacheMisses++;
  }

  getStats() {
    const avgSearch = this.average(this.metrics.searchLatency);
    const avgInsert = this.average(this.metrics.insertLatency);
    const cacheHitRate = this.metrics.cacheHits / 
      (this.metrics.cacheHits + this.metrics.cacheMisses);

    return {
      avgSearchLatency: avgSearch.toFixed(2) + 'ms',
      avgInsertLatency: avgInsert.toFixed(2) + 'ms',
      cacheHitRate: (cacheHitRate * 100).toFixed(1) + '%',
    };
  }

  private average(arr: number[]): number {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }
}

const monitor = new PerformanceMonitor();

// Track operations
const start = performance.now();
await db.search({ text: query, k: 10 });
monitor.recordSearch(performance.now() - start);

// View stats
console.log(monitor.getStats());
```

### Browser DevTools

Use browser DevTools for profiling:

1. **Performance Tab**: Record and analyze operations
2. **Memory Tab**: Monitor memory usage and detect leaks
3. **Network Tab**: Check model download times
4. **Console**: Log timing information

```typescript
// Add timing logs
console.time('search');
await db.search({ text: query, k: 10 });
console.timeEnd('search');

// Memory usage
if (performance.memory) {
  console.log('Memory:', {
    used: (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2) + 'MB',
    total: (performance.memory.totalJSHeapSize / 1024 / 1024).toFixed(2) + 'MB',
  });
}
```

## Best Practices

### 1. Choose the Right Model

```typescript
// ✅ Good - Small, fast model for most use cases
embedding: { model: 'Xenova/all-MiniLM-L6-v2' }

// ⚠️ Use larger models only if quality is critical
embedding: { model: 'Xenova/bge-base-en-v1.5' }
```

### 2. Use Appropriate Batch Sizes

```typescript
// ✅ Good - Reasonable batch size
const batchSize = 100;
for (let i = 0; i < documents.length; i += batchSize) {
  const batch = documents.slice(i, i + batchSize);
  await db.insertBatch(batch);
}

// ❌ Bad - Too large (memory issues)
await db.insertBatch(documents);  // 100,000 documents

// ❌ Bad - Too small (slow)
for (const doc of documents) {
  await db.insert(doc);
}
```

### 3. Implement Caching

```typescript
// ✅ Good - Cache frequently accessed data
const cache = new LRUCache({ max: 1000 });

async function getCachedEmbedding(text: string) {
  let vector = cache.get(text);
  if (!vector) {
    vector = await db.embedding.embed(text);
    cache.set(text, vector);
  }
  return vector;
}
```

### 4. Monitor Performance

```typescript
// ✅ Good - Track and log performance
const start = performance.now();
const results = await db.search({ text: query, k: 10 });
const latency = performance.now() - start;

if (latency > 100) {
  console.warn(`Slow search: ${latency}ms`);
}
```

### 5. Clean Up Resources

```typescript
// ✅ Good - Dispose when done
try {
  await db.initialize();
  // Use database
} finally {
  await db.dispose();
}
```

## Performance Targets

### Search Latency

| Dataset Size | Target Latency | Acceptable |
|-------------|---------------|-----------|
| 1,000 | <10ms | <50ms |
| 10,000 | <50ms | <100ms |
| 50,000 | <100ms | <200ms |
| 100,000 | <200ms | <500ms |

### Insert Throughput

| Operation | Target | Acceptable |
|-----------|--------|-----------|
| Single insert | >100/sec | >50/sec |
| Batch insert (100) | >1000/sec | >500/sec |
| Batch insert (1000) | >2000/sec | >1000/sec |

### Memory Usage

| Dataset Size | Target | Maximum |
|-------------|--------|---------|
| 10,000 vectors | <50MB | <100MB |
| 50,000 vectors | <200MB | <500MB |
| 100,000 vectors | <400MB | <1GB |

## Troubleshooting

### Slow Search

1. Check dataset size - consider reducing
2. Enable WebGPU if available
3. Use metadata filters to reduce search space
4. Reduce result count (k)
5. Check for memory pressure

### High Memory Usage

1. Reduce cache sizes
2. Use progressive loading
3. Implement LRU eviction
4. Clear unused data
5. Export and archive old data

### Slow Insertion

1. Use batch operations
2. Pre-compute embeddings
3. Increase batch size
4. Check storage quota
5. Optimize IndexedDB transactions

### Model Loading Slow

1. Enable caching
2. Use smaller models
3. Check network connection
4. Use CDN for models
5. Pre-load models on app start

## Next Steps

- **[API Reference](./API.md)** - Complete API documentation
- **[Benchmarking Guide](./BENCHMARKING.md)** - Detailed benchmarking
- **[Examples](../examples/performance-usage.ts)** - Performance examples
- **[Troubleshooting](./TROUBLESHOOTING.md)** - Common issues

---

Happy optimizing! 🚀
