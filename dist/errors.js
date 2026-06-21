/**
 * Error types for VectorDB
 */
export class VectorDBError extends Error {
    constructor(message, code, details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = 'VectorDBError';
        Object.setPrototypeOf(this, VectorDBError.prototype);
    }
}
export class StorageQuotaError extends VectorDBError {
    constructor(details) {
        super('Storage quota exceeded', 'STORAGE_QUOTA_EXCEEDED', details);
        this.name = 'StorageQuotaError';
        Object.setPrototypeOf(this, StorageQuotaError.prototype);
    }
}
export class DimensionMismatchError extends VectorDBError {
    constructor(expected, actual) {
        super(`Dimension mismatch: expected ${expected}, got ${actual}`, 'DIMENSION_MISMATCH', { expected, actual });
        this.name = 'DimensionMismatchError';
        Object.setPrototypeOf(this, DimensionMismatchError.prototype);
    }
}
export class ModelLoadError extends VectorDBError {
    constructor(model, cause) {
        super(`Failed to load model: ${model}`, 'MODEL_LOAD_ERROR', { model, cause });
        this.name = 'ModelLoadError';
        Object.setPrototypeOf(this, ModelLoadError.prototype);
    }
}
export class IndexCorruptedError extends VectorDBError {
    constructor(details) {
        super('Index data is corrupted', 'INDEX_CORRUPTED', details);
        this.name = 'IndexCorruptedError';
        Object.setPrototypeOf(this, IndexCorruptedError.prototype);
    }
}
/**
 * Input validation utilities
 */
export class InputValidator {
    /**
     * Validate a vector for correct dimensions and valid values
     */
    static validateVector(vector, expectedDim) {
        if (vector.length !== expectedDim) {
            throw new DimensionMismatchError(expectedDim, vector.length);
        }
        if (!this.isFiniteVector(vector)) {
            throw new VectorDBError('Vector contains invalid values (NaN or Infinity)', 'INVALID_VECTOR', { vectorLength: vector.length });
        }
    }
    /**
     * Check if all vector values are finite
     */
    static isFiniteVector(vector) {
        for (let i = 0; i < vector.length; i++) {
            if (!Number.isFinite(vector[i])) {
                return false;
            }
        }
        return true;
    }
    /**
     * Validate and sanitize metadata to prevent XSS and ensure valid structure
     */
    static validateAndSanitizeMetadata(metadata) {
        if (metadata === null || metadata === undefined) {
            return {};
        }
        if (typeof metadata !== 'object' || Array.isArray(metadata)) {
            throw new VectorDBError('Metadata must be a plain object', 'INVALID_METADATA', { type: typeof metadata });
        }
        const sanitized = {};
        for (const [key, value] of Object.entries(metadata)) {
            // Validate key
            if (typeof key !== 'string' || key.length === 0) {
                throw new VectorDBError('Metadata keys must be non-empty strings', 'INVALID_METADATA_KEY', { key });
            }
            // Sanitize value
            sanitized[key] = this.sanitizeValue(value);
        }
        return sanitized;
    }
    /**
     * Sanitize a single metadata value
     */
    static sanitizeValue(value) {
        if (value === null || value === undefined) {
            return value;
        }
        // Sanitize strings to prevent XSS
        if (typeof value === 'string') {
            return this.sanitizeString(value);
        }
        // Allow numbers, booleans
        if (typeof value === 'number' || typeof value === 'boolean') {
            return value;
        }
        // Recursively sanitize arrays
        if (Array.isArray(value)) {
            return value.map(item => this.sanitizeValue(item));
        }
        // Recursively sanitize nested objects
        if (typeof value === 'object') {
            const sanitized = {};
            for (const [k, v] of Object.entries(value)) {
                sanitized[k] = this.sanitizeValue(v);
            }
            return sanitized;
        }
        // Reject functions, symbols, etc.
        throw new VectorDBError('Metadata values must be strings, numbers, booleans, arrays, or plain objects', 'INVALID_METADATA_VALUE', { type: typeof value });
    }
    /**
     * Sanitize string to prevent XSS attacks
     */
    static sanitizeString(str) {
        if (typeof str !== 'string') {
            return str;
        }
        // Replace potentially dangerous characters
        return str
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;')
            .replace(/\//g, '&#x2F;');
    }
    /**
     * Validate search query parameters
     */
    static validateSearchQuery(k, _dimensions) {
        if (!Number.isInteger(k) || k <= 0) {
            throw new VectorDBError('Search parameter k must be a positive integer', 'INVALID_SEARCH_PARAM', { k });
        }
        if (k > 10000) {
            throw new VectorDBError('Search parameter k is too large (max 10000)', 'INVALID_SEARCH_PARAM', { k, max: 10000 });
        }
    }
}
/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG = {
    maxAttempts: 3,
    initialDelayMs: 100,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
};
/**
 * Error handler with graceful degradation and retry logic
 */
export class ErrorHandler {
    constructor(logger) {
        this.logger = logger || ((msg, err) => console.error(msg, err));
    }
    /**
     * Handle an error with appropriate recovery strategy
     */
    async handleError(error, context) {
        if (error instanceof StorageQuotaError) {
            this.logger('Storage quota exceeded. Consider exporting and clearing old data, or reducing the dataset size.', error, { context });
        }
        else if (error instanceof IndexCorruptedError) {
            this.logger('Index corrupted. The index will need to be rebuilt from stored vectors.', error, { context });
        }
        else if (error instanceof ModelLoadError) {
            this.logger('Failed to load model. Check network connection or try a different model.', error, { context });
        }
        else if (error instanceof DimensionMismatchError) {
            this.logger('Dimension mismatch detected. Ensure all vectors have the same dimensions.', error, { context });
        }
        else if (error instanceof VectorDBError) {
            this.logger(`VectorDB error: ${error.message}`, error, { context, code: error.code });
        }
        else {
            this.logger(`Unexpected error: ${error.message}`, error, { context });
        }
    }
    /**
     * Execute an operation with retry logic for transient failures
     */
    async withRetry(operation, config = {}, isRetriable = this.isTransientError) {
        const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
        let lastError;
        let delay = retryConfig.initialDelayMs;
        for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
            try {
                return await operation();
            }
            catch (error) {
                lastError = error;
                // Don't retry if it's not a retriable error
                if (!isRetriable(lastError)) {
                    throw lastError;
                }
                // Don't retry if this was the last attempt
                if (attempt === retryConfig.maxAttempts) {
                    this.logger(`Operation failed after ${attempt} attempts`, lastError, { attempts: attempt });
                    throw lastError;
                }
                // Log retry attempt
                this.logger(`Operation failed, retrying (attempt ${attempt}/${retryConfig.maxAttempts})`, lastError, { attempt, delay });
                // Wait before retrying with exponential backoff
                await this.sleep(delay);
                delay = Math.min(delay * retryConfig.backoffMultiplier, retryConfig.maxDelayMs);
            }
        }
        throw lastError;
    }
    /**
     * Determine if an error is transient and should be retried
     */
    isTransientError(error) {
        // Network errors
        if (error.message.includes('network') || error.message.includes('fetch')) {
            return true;
        }
        // Timeout errors
        if (error.message.includes('timeout')) {
            return true;
        }
        // Model loading errors (might be transient network issues)
        if (error instanceof ModelLoadError) {
            return true;
        }
        // Don't retry these errors
        if (error instanceof DimensionMismatchError ||
            error instanceof StorageQuotaError ||
            error instanceof IndexCorruptedError) {
            return false;
        }
        // Default: don't retry
        return false;
    }
    /**
     * Sleep for a specified duration
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    /**
     * Rebuild index from stored vectors (recovery strategy for corrupted index)
     */
    async rebuildIndex(storage, indexManager) {
        try {
            this.logger('Starting index rebuild from stored vectors...');
            // This is a simplified approach - in production, you'd want to paginate
            const count = await storage.count();
            this.logger(`Found ${count} vectors to rebuild`);
            // Clear the corrupted index
            await indexManager.clear();
            // Rebuild index from vectors
            // Note: This assumes the storage has a method to iterate all records
            // In a real implementation, you'd want to batch this operation
            const allIds = await storage.getAllIds();
            for (const id of allIds) {
                const record = await storage.get(id);
                if (record && record.vector) {
                    await indexManager.add(id, record.vector);
                }
            }
            this.logger('Index rebuild completed successfully');
        }
        catch (error) {
            this.logger('Failed to rebuild index', error);
            throw new VectorDBError('Index rebuild failed', 'INDEX_REBUILD_ERROR', { error });
        }
    }
}
//# sourceMappingURL=errors.js.map