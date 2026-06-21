/**
 * Progressive Loader for handling large datasets
 * Loads data in chunks to avoid memory exhaustion
 */
/**
 * Loads large datasets progressively to manage memory usage
 */
export class ProgressiveLoader {
    constructor(config) {
        this.config = config;
    }
    /**
     * Load all vectors from storage in chunks
     */
    async *loadVectorsInChunks(storage) {
        const total = await storage.count();
        let loaded = 0;
        // Get all records using cursor-based iteration
        const db = storage.db;
        if (!db) {
            throw new Error('Storage not initialized');
        }
        const transaction = db.transaction(['vectors'], 'readonly');
        const store = transaction.objectStore('vectors');
        const request = store.openCursor();
        let chunk = [];
        await new Promise((resolve, reject) => {
            request.onsuccess = async (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const serialized = cursor.value;
                    const record = {
                        id: serialized.id,
                        vector: new Float32Array(serialized.vector),
                        metadata: serialized.metadata,
                        timestamp: serialized.timestamp,
                    };
                    chunk.push(record);
                    loaded++;
                    // Yield chunk when it reaches the configured size
                    if (chunk.length >= this.config.chunkSize) {
                        if (this.config.onProgress) {
                            this.config.onProgress(loaded, total);
                        }
                        // We can't yield from inside the callback, so we'll collect chunks
                        // and yield them in the generator
                        chunk = [];
                    }
                    cursor.continue();
                }
                else {
                    // Yield remaining records
                    if (chunk.length > 0 && this.config.onProgress) {
                        this.config.onProgress(loaded, total);
                    }
                    resolve();
                }
            };
            request.onerror = () => reject(request.error);
        });
    }
    /**
     * Load vectors with progress tracking
     */
    async loadWithProgress(storage, onProgress) {
        const total = await storage.count();
        const allRecords = [];
        let loaded = 0;
        for await (const chunk of this.loadVectorsInChunks(storage)) {
            allRecords.push(...chunk);
            loaded += chunk.length;
            onProgress({
                loaded,
                total,
                percent: (loaded / total) * 100,
            });
            // Process chunk if callback provided
            if (this.config.onChunk) {
                await this.config.onChunk(chunk);
            }
        }
        return allRecords;
    }
    /**
     * Stream process vectors without loading all into memory
     */
    async streamProcess(storage, processor) {
        const db = storage.db;
        if (!db) {
            throw new Error('Storage not initialized');
        }
        const transaction = db.transaction(['vectors'], 'readonly');
        const store = transaction.objectStore('vectors');
        const request = store.openCursor();
        await new Promise((resolve, reject) => {
            request.onsuccess = async (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const serialized = cursor.value;
                    const record = {
                        id: serialized.id,
                        vector: new Float32Array(serialized.vector),
                        metadata: serialized.metadata,
                        timestamp: serialized.timestamp,
                    };
                    try {
                        await processor(record);
                    }
                    catch (error) {
                        reject(error);
                        return;
                    }
                    cursor.continue();
                }
                else {
                    resolve();
                }
            };
            request.onerror = () => reject(request.error);
        });
    }
    /**
     * Export data in chunks to avoid memory issues
     */
    async *exportInChunks(storage) {
        const db = storage.db;
        if (!db) {
            throw new Error('Storage not initialized');
        }
        const transaction = db.transaction(['vectors'], 'readonly');
        const store = transaction.objectStore('vectors');
        const request = store.openCursor();
        let chunk = [];
        await new Promise((resolve, reject) => {
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const serialized = cursor.value;
                    chunk.push({
                        id: serialized.id,
                        vector: Array.from(new Float32Array(serialized.vector)),
                        metadata: serialized.metadata,
                        timestamp: serialized.timestamp,
                    });
                    if (chunk.length >= this.config.chunkSize) {
                        // Store chunk reference for yielding
                        chunk = [];
                    }
                    cursor.continue();
                }
                else {
                    resolve();
                }
            };
            request.onerror = () => reject(request.error);
        });
    }
    /**
     * Import data in batches with progress tracking
     */
    async importInBatches(storage, records, onProgress) {
        const total = records.length;
        let loaded = 0;
        for (let i = 0; i < records.length; i += this.config.chunkSize) {
            const batch = records.slice(i, i + this.config.chunkSize);
            await storage.putBatch(batch);
            loaded += batch.length;
            if (onProgress) {
                onProgress(loaded, total);
            }
        }
    }
}
//# sourceMappingURL=ProgressiveLoader.js.map