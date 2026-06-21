/**
 * Batch Optimizer for optimizing IndexedDB transactions
 * Batches multiple operations together for better performance
 */
/**
 * Optimizes IndexedDB operations by batching them together
 */
export class BatchOptimizer {
    constructor(storage, config) {
        this.pendingOps = [];
        this.flushTimer = null;
        this.storage = storage;
        this.config = {
            autoFlush: true,
            ...config,
        };
    }
    /**
     * Queue a put operation
     */
    async put(record) {
        return new Promise((resolve, reject) => {
            this.pendingOps.push({
                type: 'put',
                data: record,
                resolve,
                reject,
            });
            this.scheduleFlush();
        });
    }
    /**
     * Queue a delete operation
     */
    async delete(id) {
        return new Promise((resolve, reject) => {
            this.pendingOps.push({
                type: 'delete',
                data: id,
                resolve,
                reject,
            });
            this.scheduleFlush();
        });
    }
    /**
     * Manually flush all pending operations
     */
    async flush() {
        if (this.flushTimer !== null) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        if (this.pendingOps.length === 0) {
            return;
        }
        const ops = [...this.pendingOps];
        this.pendingOps = [];
        try {
            // Separate put and delete operations
            const putOps = ops.filter(op => op.type === 'put');
            const deleteOps = ops.filter(op => op.type === 'delete');
            // Execute put operations in batch
            if (putOps.length > 0) {
                const records = putOps.map(op => op.data);
                try {
                    await this.storage.putBatch(records);
                    putOps.forEach(op => op.resolve(undefined));
                }
                catch (error) {
                    putOps.forEach(op => op.reject(error));
                }
            }
            // Execute delete operations individually (IndexedDB doesn't have batch delete)
            for (const op of deleteOps) {
                try {
                    const result = await this.storage.delete(op.data);
                    op.resolve(result);
                }
                catch (error) {
                    op.reject(error);
                }
            }
        }
        catch (error) {
            // Reject all pending operations
            ops.forEach(op => op.reject(error));
        }
    }
    /**
     * Get the number of pending operations
     */
    getPendingCount() {
        return this.pendingOps.length;
    }
    /**
     * Clear all pending operations without executing them
     */
    clear() {
        if (this.flushTimer !== null) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        // Reject all pending operations
        const error = new Error('Batch operations cleared');
        this.pendingOps.forEach(op => op.reject(error));
        this.pendingOps = [];
    }
    /**
     * Clean up resources
     */
    dispose() {
        this.clear();
    }
    /**
     * Schedule a flush operation
     */
    scheduleFlush() {
        // Flush immediately if batch is full
        if (this.pendingOps.length >= this.config.maxBatchSize) {
            this.flush();
            return;
        }
        // Schedule flush if auto-flush is enabled
        if (this.config.autoFlush && this.flushTimer === null) {
            this.flushTimer = window.setTimeout(() => {
                this.flush();
            }, this.config.maxWaitTime);
        }
    }
}
//# sourceMappingURL=BatchOptimizer.js.map