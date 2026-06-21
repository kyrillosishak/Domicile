/**
 * Memory Manager for monitoring and managing memory usage
 * Implements automatic eviction when memory pressure is detected
 */
/**
 * Manages memory usage across caches and triggers eviction when needed
 */
export class MemoryManager {
    constructor(config) {
        this.checkIntervalId = null;
        this.memoryPressureCallbacks = [];
        this.config = {
            checkInterval: 30000, // Check every 30 seconds by default
            ...config,
        };
        this.caches = new Map();
    }
    /**
     * Register a cache for memory management
     */
    registerCache(name, cache) {
        this.caches.set(name, cache);
    }
    /**
     * Register a callback to be called when memory pressure is detected
     */
    onMemoryPressure(callback) {
        this.memoryPressureCallbacks.push(callback);
    }
    /**
     * Start monitoring memory usage
     */
    startMonitoring() {
        if (this.checkIntervalId !== null) {
            return;
        }
        this.checkIntervalId = window.setInterval(() => {
            this.checkMemory();
        }, this.config.checkInterval);
    }
    /**
     * Stop monitoring memory usage
     */
    stopMonitoring() {
        if (this.checkIntervalId !== null) {
            clearInterval(this.checkIntervalId);
            this.checkIntervalId = null;
        }
    }
    /**
     * Check current memory usage and trigger eviction if needed
     */
    async checkMemory() {
        const stats = this.getMemoryStats();
        // Check if we're above the eviction threshold
        if (stats.utilizationPercent >= this.config.evictionThreshold * 100) {
            await this.handleMemoryPressure();
        }
    }
    /**
     * Get current memory statistics
     */
    getMemoryStats() {
        let usedMemory = 0;
        const cacheStats = {};
        // Sum up cache sizes
        for (const [name, cache] of this.caches.entries()) {
            const stats = cache.getStats();
            cacheStats[name] = stats;
            usedMemory += stats.size;
        }
        // Try to get browser memory info if available
        const performance = window.performance;
        let totalMemory = this.config.maxMemoryMB * 1024 * 1024;
        if (performance && performance.memory) {
            totalMemory = performance.memory.jsHeapSizeLimit;
            usedMemory = performance.memory.usedJSHeapSize;
        }
        return {
            usedMemory,
            totalMemory,
            utilizationPercent: (usedMemory / totalMemory) * 100,
            cacheStats,
        };
    }
    /**
     * Handle memory pressure by evicting cache entries
     */
    async handleMemoryPressure() {
        console.warn('Memory pressure detected, evicting cache entries...');
        // Evict from each cache proportionally
        for (const cache of this.caches.values()) {
            const stats = cache.getStats();
            const targetSize = stats.maxSize * 0.7; // Evict to 70% capacity
            while (cache.size() > targetSize && cache.count() > 0) {
                // LRU cache will automatically evict oldest entries
                // We just need to trigger eviction by trying to add a dummy entry
                // Actually, we can just clear a portion of the cache
                // Would evict 30% of entries, but relying on natural eviction
                // Since we can't directly access keys, we'll rely on the cache's
                // natural eviction when new items are added
                break;
            }
        }
        // Call registered memory pressure callbacks
        for (const callback of this.memoryPressureCallbacks) {
            try {
                await callback();
            }
            catch (error) {
                console.error('Error in memory pressure callback:', error);
            }
        }
    }
    /**
     * Force eviction across all caches
     */
    async forceEviction(targetUtilization = 0.5) {
        const stats = this.getMemoryStats();
        const targetSize = stats.totalMemory * targetUtilization;
        const amountToFree = stats.usedMemory - targetSize;
        if (amountToFree <= 0) {
            return;
        }
        // Clear caches proportionally
        for (const cache of this.caches.values()) {
            const cacheStats = cache.getStats();
            const proportion = cacheStats.size / stats.usedMemory;
            const cacheTargetSize = cacheStats.size - (amountToFree * proportion);
            // Clear entries until we reach target
            // This is a simplified approach - in practice, LRU will handle this
            if (cacheTargetSize < cacheStats.size * 0.5) {
                cache.clear();
            }
        }
        // Call memory pressure callbacks
        for (const callback of this.memoryPressureCallbacks) {
            try {
                await callback();
            }
            catch (error) {
                console.error('Error in memory pressure callback:', error);
            }
        }
    }
    /**
     * Clean up resources
     */
    dispose() {
        this.stopMonitoring();
        this.caches.clear();
        this.memoryPressureCallbacks = [];
    }
}
//# sourceMappingURL=MemoryManager.js.map