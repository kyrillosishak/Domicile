/**
 * Performance Benchmarking Suite
 *
 * Comprehensive benchmarking for:
 * - Search latency across dataset sizes
 * - Insertion throughput
 * - Memory usage profiling
 * - Model load times
 */
/**
 * Utility class for running performance benchmarks
 */
export class Benchmark {
    constructor() {
        this.results = [];
        this.environment = this.detectEnvironment();
    }
    /**
     * Detect browser and system environment
     */
    detectEnvironment() {
        const ua = navigator.userAgent;
        let browser = 'Unknown';
        let browserVersion = 'Unknown';
        // Detect browser
        if (ua.includes('Chrome') && !ua.includes('Edg')) {
            browser = 'Chrome';
            const match = ua.match(/Chrome\/(\d+)/);
            browserVersion = match ? match[1] : 'Unknown';
        }
        else if (ua.includes('Firefox')) {
            browser = 'Firefox';
            const match = ua.match(/Firefox\/(\d+)/);
            browserVersion = match ? match[1] : 'Unknown';
        }
        else if (ua.includes('Safari') && !ua.includes('Chrome')) {
            browser = 'Safari';
            const match = ua.match(/Version\/(\d+)/);
            browserVersion = match ? match[1] : 'Unknown';
        }
        else if (ua.includes('Edg')) {
            browser = 'Edge';
            const match = ua.match(/Edg\/(\d+)/);
            browserVersion = match ? match[1] : 'Unknown';
        }
        return {
            browser,
            browserVersion,
            platform: navigator.platform,
            hardwareConcurrency: navigator.hardwareConcurrency || 1,
            deviceMemory: navigator.deviceMemory,
            connection: navigator.connection?.effectiveType,
        };
    }
    /**
     * Run a benchmark function and measure performance
     */
    async run(name, description, fn, options = {}) {
        const { warmup = 0, iterations = 1, collectMemory = true } = options;
        // Warmup runs
        for (let i = 0; i < warmup; i++) {
            await fn();
        }
        // Force garbage collection if available
        if (globalThis.gc) {
            globalThis.gc();
        }
        // Collect initial memory
        const memoryBefore = collectMemory ? this.getMemoryUsage() : null;
        // Benchmark runs
        const durations = [];
        for (let i = 0; i < iterations; i++) {
            const start = performance.now();
            await fn();
            const end = performance.now();
            durations.push(end - start);
        }
        // Collect final memory
        const memoryAfter = collectMemory ? this.getMemoryUsage() : null;
        // Calculate statistics
        const metrics = {
            iterations,
            min: Math.min(...durations),
            max: Math.max(...durations),
            mean: durations.reduce((a, b) => a + b, 0) / durations.length,
            median: this.calculateMedian(durations),
            p95: this.calculatePercentile(durations, 0.95),
            p99: this.calculatePercentile(durations, 0.99),
        };
        if (memoryBefore && memoryAfter) {
            metrics.memoryBefore = memoryBefore;
            metrics.memoryAfter = memoryAfter;
            metrics.memoryDelta = memoryAfter - memoryBefore;
        }
        const benchmarkResult = {
            name,
            description,
            metrics,
            timestamp: Date.now(),
            environment: this.environment,
        };
        this.results.push(benchmarkResult);
        return benchmarkResult;
    }
    /**
     * Run a throughput benchmark (operations per second)
     */
    async runThroughput(name, description, fn, options = {}) {
        const { duration = 5000, warmup = 0 } = options;
        // Warmup
        for (let i = 0; i < warmup; i++) {
            await fn();
        }
        // Force garbage collection
        if (globalThis.gc) {
            globalThis.gc();
        }
        // Run for specified duration
        const startTime = performance.now();
        let operations = 0;
        let totalDuration = 0;
        while (performance.now() - startTime < duration) {
            const opStart = performance.now();
            await fn();
            const opEnd = performance.now();
            operations++;
            totalDuration += opEnd - opStart;
        }
        const actualDuration = performance.now() - startTime;
        const opsPerSecond = (operations / actualDuration) * 1000;
        const avgLatency = totalDuration / operations;
        const benchmarkResult = {
            name,
            description,
            metrics: {
                operations,
                duration: actualDuration,
                opsPerSecond,
                avgLatency,
                throughput: opsPerSecond,
            },
            timestamp: Date.now(),
            environment: this.environment,
        };
        this.results.push(benchmarkResult);
        return benchmarkResult;
    }
    /**
     * Measure memory usage over time during an operation
     */
    async profileMemory(name, description, fn, options = {}) {
        const { sampleInterval = 100 } = options;
        const samples = [];
        // Start sampling
        const samplingInterval = setInterval(() => {
            const memory = this.getMemoryUsage();
            if (memory !== null) {
                samples.push(memory);
            }
        }, sampleInterval);
        // Run the function
        const start = performance.now();
        await fn();
        const duration = performance.now() - start;
        // Stop sampling
        clearInterval(samplingInterval);
        // Calculate memory statistics
        const metrics = {
            duration,
            samples: samples.length,
            minMemory: Math.min(...samples),
            maxMemory: Math.max(...samples),
            avgMemory: samples.reduce((a, b) => a + b, 0) / samples.length,
            peakMemory: Math.max(...samples),
            memoryGrowth: samples[samples.length - 1] - samples[0],
        };
        const benchmarkResult = {
            name,
            description,
            metrics,
            timestamp: Date.now(),
            environment: this.environment,
        };
        this.results.push(benchmarkResult);
        return benchmarkResult;
    }
    /**
     * Get current memory usage in MB
     */
    getMemoryUsage() {
        if (performance.memory) {
            return performance.memory.usedJSHeapSize / 1024 / 1024;
        }
        return null;
    }
    /**
     * Calculate median of an array
     */
    calculateMedian(values) {
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid];
    }
    /**
     * Calculate percentile of an array
     */
    calculatePercentile(values, percentile) {
        const sorted = [...values].sort((a, b) => a - b);
        const index = Math.ceil(sorted.length * percentile) - 1;
        return sorted[Math.max(0, index)];
    }
    /**
     * Get all benchmark results
     */
    getResults() {
        return this.results;
    }
    /**
     * Get a summary of all benchmarks
     */
    getSummary() {
        const totalDuration = this.results.reduce((sum, r) => sum + (r.metrics.duration || 0), 0);
        return {
            name: 'VectorDB Performance Benchmark',
            results: this.results,
            summary: {
                totalTests: this.results.length,
                totalDuration,
                environment: this.environment,
            },
        };
    }
    /**
     * Format results as a readable report
     */
    formatReport() {
        const lines = [];
        lines.push('='.repeat(80));
        lines.push('VectorDB Performance Benchmark Report');
        lines.push('='.repeat(80));
        lines.push('');
        lines.push(`Environment:`);
        lines.push(`  Browser: ${this.environment.browser} ${this.environment.browserVersion}`);
        lines.push(`  Platform: ${this.environment.platform}`);
        lines.push(`  CPU Cores: ${this.environment.hardwareConcurrency}`);
        if (this.environment.deviceMemory) {
            lines.push(`  Device Memory: ${this.environment.deviceMemory} GB`);
        }
        lines.push('');
        for (const result of this.results) {
            lines.push('-'.repeat(80));
            lines.push(`${result.name}`);
            lines.push(`  ${result.description}`);
            lines.push('');
            lines.push('  Metrics:');
            for (const [key, value] of Object.entries(result.metrics)) {
                const formattedValue = typeof value === 'number'
                    ? value.toFixed(2)
                    : value;
                lines.push(`    ${key}: ${formattedValue}`);
            }
            lines.push('');
        }
        lines.push('='.repeat(80));
        return lines.join('\n');
    }
    /**
     * Export results as JSON
     */
    exportJSON() {
        return JSON.stringify(this.getSummary(), null, 2);
    }
    /**
     * Clear all results
     */
    clear() {
        this.results = [];
    }
}
//# sourceMappingURL=Benchmark.js.map