/**
 * Benchmark Runner for VectorDB
 * 
 * Runs comprehensive performance benchmarks including:
 * - Search latency for various dataset sizes (1K, 10K, 50K, 100K)
 * - Insertion throughput
 * - Memory usage profiling
 * - Model load times
 */

import { VectorDB } from '../core/VectorDB';
import type { VectorDBConfig } from '../core/types';
import { Benchmark, type BenchmarkSuite } from './Benchmark';

export interface BenchmarkRunnerConfig {
  // Dataset sizes to test
  datasetSizes?: number[];
  
  // Number of search queries per dataset
  searchQueries?: number;
  
  // Embedding model to use
  embeddingModel?: string;
  
  // Whether to test with real models or mock data
  useRealModels?: boolean;
  
  // Whether to clean up after each test
  cleanup?: boolean;
}

/**
 * Runs comprehensive performance benchmarks on VectorDB
 */
export class BenchmarkRunner {
  private benchmark: Benchmark;
  private config: Required<BenchmarkRunnerConfig>;

  constructor(config: BenchmarkRunnerConfig = {}) {
    this.benchmark = new Benchmark();
    this.config = {
      datasetSizes: [100, 1000, 10000],
      searchQueries: 100,
      embeddingModel: 'Xenova/all-MiniLM-L6-v2',
      useRealModels: false,
      cleanup: true,
      ...config,
    };
  }

  /**
   * Run all benchmarks
   */
  async runAll(): Promise<BenchmarkSuite> {
    console.log('Starting VectorDB Performance Benchmarks...\n');

    // 1. Model Load Time Benchmark
    if (this.config.useRealModels) {
      await this.benchmarkModelLoadTime();
    }

    // 2. Insertion Throughput Benchmark
    await this.benchmarkInsertionThroughput();

    // 3. Search Latency Benchmark (various dataset sizes)
    for (const size of this.config.datasetSizes) {
      await this.benchmarkSearchLatency(size);
    }

    // 4. Batch Operations Benchmark
    await this.benchmarkBatchOperations();

    // 5. Memory Usage Benchmark
    await this.benchmarkMemoryUsage();

    // 6. Cache Performance Benchmark
    await this.benchmarkCachePerformance();

    console.log('\nAll benchmarks complete!');
    return this.benchmark.getSummary();
  }

  /**
   * Benchmark 1: Model Load Time
   */
  private async benchmarkModelLoadTime(): Promise<void> {
    console.log('Running Model Load Time Benchmark...');

    const config: VectorDBConfig = {
      storage: { dbName: 'bench-model-load', version: 1 },
      index: { dimensions: 384, metric: 'cosine', indexType: 'hnsw' },
      embedding: {
        model: this.config.embeddingModel,
        device: 'wasm',
        cache: false, // Disable cache to measure true load time
      },
    };

    await this.benchmark.run(
      'Model Load Time',
      'Time to initialize embedding model from cold start',
      async () => {
        const db = new VectorDB(config);
        await db.initialize();
        await db.dispose();
      },
      { iterations: 3, warmup: 0 }
    );

    if (this.config.cleanup) {
      await this.cleanupDatabase('bench-model-load');
    }
  }

  /**
   * Benchmark 2: Insertion Throughput
   */
  private async benchmarkInsertionThroughput(): Promise<void> {
    console.log('Running Insertion Throughput Benchmark...');

    const db = await this.createTestDB('bench-insert-throughput');

    let counter = 0;
    await this.benchmark.runThroughput(
      'Single Insert Throughput',
      'Number of single document insertions per second',
      async () => {
        await db.insert({
          text: `Test document ${counter++}`,
          metadata: { index: counter },
        });
      },
      { duration: 3000, warmup: 10 }
    );

    // Batch insertion throughput
    counter = 0;
    await this.benchmark.runThroughput(
      'Batch Insert Throughput (100 docs)',
      'Number of batch insertions (100 docs each) per second',
      async () => {
        const batch = Array.from({ length: 100 }, (_, i) => ({
          text: `Batch document ${counter++}-${i}`,
          metadata: { batch: counter, index: i },
        }));
        await db.insertBatch(batch);
      },
      { duration: 3000, warmup: 2 }
    );

    await db.dispose();
    if (this.config.cleanup) {
      await this.cleanupDatabase('bench-insert-throughput');
    }
  }

  /**
   * Benchmark 3: Search Latency for Various Dataset Sizes
   */
  private async benchmarkSearchLatency(datasetSize: number): Promise<void> {
    console.log(`Running Search Latency Benchmark (${datasetSize} vectors)...`);

    const db = await this.createTestDB(`bench-search-${datasetSize}`);

    // Insert test dataset
    console.log(`  Inserting ${datasetSize} documents...`);
    const insertStart = performance.now();
    
    const batchSize = 100;
    for (let i = 0; i < datasetSize; i += batchSize) {
      const batch = Array.from(
        { length: Math.min(batchSize, datasetSize - i) },
        (_, j) => ({
          text: this.generateTestDocument(i + j),
          metadata: { 
            index: i + j,
            category: ['AI', 'ML', 'NLP', 'CV', 'RL'][Math.floor(Math.random() * 5)],
          },
        })
      );
      await db.insertBatch(batch);
    }
    
    const insertDuration = performance.now() - insertStart;
    console.log(`  Inserted in ${(insertDuration / 1000).toFixed(2)}s`);

    // Benchmark search latency
    const queries = [
      'machine learning algorithms',
      'deep neural networks',
      'natural language processing',
      'computer vision techniques',
      'reinforcement learning agents',
    ];

    let queryIndex = 0;
    await this.benchmark.run(
      `Search Latency (${datasetSize} vectors)`,
      `Average search time for k=10 on ${datasetSize} vector dataset`,
      async () => {
        const query = queries[queryIndex % queries.length];
        queryIndex++;
        await db.search({ text: query, k: 10 });
      },
      { iterations: this.config.searchQueries, warmup: 5 }
    );

    // Benchmark search with metadata filtering
    queryIndex = 0;
    await this.benchmark.run(
      `Search with Filter (${datasetSize} vectors)`,
      `Search time with metadata filter on ${datasetSize} vectors`,
      async () => {
        const query = queries[queryIndex % queries.length];
        queryIndex++;
        await db.search({
          text: query,
          k: 10,
          filter: { field: 'category', operator: 'eq', value: 'AI' },
        });
      },
      { iterations: Math.min(50, this.config.searchQueries), warmup: 5 }
    );

    await db.dispose();
    if (this.config.cleanup) {
      await this.cleanupDatabase(`bench-search-${datasetSize}`);
    }
  }

  /**
   * Benchmark 4: Batch Operations
   */
  private async benchmarkBatchOperations(): Promise<void> {
    console.log('Running Batch Operations Benchmark...');

    const db = await this.createTestDB('bench-batch-ops');

    // Benchmark different batch sizes
    const batchSizes = [10, 50, 100, 500];

    for (const batchSize of batchSizes) {
      await this.benchmark.run(
        `Batch Insert (${batchSize} docs)`,
        `Time to insert ${batchSize} documents in a single batch`,
        async () => {
          const batch = Array.from({ length: batchSize }, (_, i) => ({
            text: `Batch document ${i}`,
            metadata: { index: i },
          }));
          await db.insertBatch(batch);
        },
        { iterations: 10, warmup: 2 }
      );
    }

    await db.dispose();
    if (this.config.cleanup) {
      await this.cleanupDatabase('bench-batch-ops');
    }
  }

  /**
   * Benchmark 5: Memory Usage
   */
  private async benchmarkMemoryUsage(): Promise<void> {
    console.log('Running Memory Usage Benchmark...');

    const db = await this.createTestDB('bench-memory');

    // Profile memory during large dataset insertion
    await this.benchmark.profileMemory(
      'Memory Usage During Insertion',
      'Memory consumption while inserting 5000 documents',
      async () => {
        const batchSize = 100;
        const totalDocs = 5000;
        
        for (let i = 0; i < totalDocs; i += batchSize) {
          const batch = Array.from({ length: batchSize }, (_, j) => ({
            text: this.generateTestDocument(i + j),
            metadata: { index: i + j },
          }));
          await db.insertBatch(batch);
        }
      },
      { sampleInterval: 100 }
    );

    // Profile memory during search operations
    await this.benchmark.profileMemory(
      'Memory Usage During Search',
      'Memory consumption during 100 search operations',
      async () => {
        for (let i = 0; i < 100; i++) {
          await db.search({ text: 'test query', k: 10 });
        }
      },
      { sampleInterval: 50 }
    );

    await db.dispose();
    if (this.config.cleanup) {
      await this.cleanupDatabase('bench-memory');
    }
  }

  /**
   * Benchmark 6: Cache Performance
   */
  private async benchmarkCachePerformance(): Promise<void> {
    console.log('Running Cache Performance Benchmark...');

    const db = await this.createTestDB('bench-cache');

    // Insert test data
    await db.insertBatch(
      Array.from({ length: 1000 }, (_, i) => ({
        text: this.generateTestDocument(i),
        metadata: { index: i },
      }))
    );

    const query = 'machine learning';

    // First search (cold cache)
    await this.benchmark.run(
      'Search (Cold Cache)',
      'Search time with empty embedding cache',
      async () => {
        db.clearCaches();
        await db.search({ text: query, k: 10 });
      },
      { iterations: 10, warmup: 0 }
    );

    // Subsequent searches (warm cache)
    await this.benchmark.run(
      'Search (Warm Cache)',
      'Search time with cached embeddings',
      async () => {
        await db.search({ text: query, k: 10 });
      },
      { iterations: 100, warmup: 5 }
    );

    // Cache hit rate test
    const queries = [
      'machine learning',
      'deep learning',
      'neural networks',
      'artificial intelligence',
      'data science',
    ];

    let hits = 0;
    let misses = 0;

    for (let i = 0; i < 100; i++) {
      const q = queries[i % queries.length];
      const statsBefore = db.getPerformanceStats();
      await db.search({ text: q, k: 10 });
      const statsAfter = db.getPerformanceStats();
      
      // Check if cache was hit (simplified check)
      if (statsAfter.caches.embeddings.count > statsBefore.caches.embeddings.count) {
        misses++;
      } else {
        hits++;
      }
    }

    console.log(`  Cache hit rate: ${((hits / (hits + misses)) * 100).toFixed(2)}%`);

    await db.dispose();
    if (this.config.cleanup) {
      await this.cleanupDatabase('bench-cache');
    }
  }

  /**
   * Create a test VectorDB instance
   */
  private async createTestDB(dbName: string): Promise<VectorDB> {
    const config: VectorDBConfig = {
      storage: { dbName, version: 1 },
      index: { dimensions: 384, metric: 'cosine', indexType: 'hnsw' },
      embedding: {
        model: this.config.embeddingModel,
        device: 'wasm',
        cache: true,
      },
      performance: {
        maxMemoryMB: 500,
        vectorCacheSize: 100 * 1024 * 1024,
        embeddingCacheSize: 50 * 1024 * 1024,
        enableWorkers: false,
        lazyLoadIndex: false,
        lazyLoadModels: false,
      },
    };

    const db = new VectorDB(config);
    await db.initialize();
    return db;
  }

  /**
   * Generate a test document with varied content
   */
  private generateTestDocument(index: number): string {
    const topics = [
      'machine learning algorithms and optimization techniques',
      'deep neural networks for image classification',
      'natural language processing and text analysis',
      'computer vision and object detection systems',
      'reinforcement learning for autonomous agents',
      'data science and statistical modeling approaches',
      'artificial intelligence and cognitive computing',
      'predictive analytics and forecasting methods',
      'big data processing and distributed systems',
      'cloud computing and scalable architectures',
    ];

    return `${topics[index % topics.length]} - Document ${index}`;
  }

  /**
   * Clean up test database
   */
  private async cleanupDatabase(dbName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(dbName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        console.warn(`Database ${dbName} deletion blocked`);
        resolve();
      };
    });
  }

  /**
   * Get benchmark results
   */
  getResults(): BenchmarkSuite {
    return this.benchmark.getSummary();
  }

  /**
   * Print formatted report
   */
  printReport(): void {
    console.log('\n' + this.benchmark.formatReport());
  }

  /**
   * Export results as JSON
   */
  exportJSON(): string {
    return this.benchmark.exportJSON();
  }
}
