/**
 * IndexedDB-based storage implementation for VectorDB
 */

import { StorageConfig } from '../core/types';
import { VectorRecord, MetadataFilter, CompoundFilter, Filter, StorageManager } from './types';
import { StorageQuotaError, VectorDBError, IndexCorruptedError } from '../errors';

const VECTORS_STORE = 'vectors';
const INDEX_STORE = 'index';
const METADATA_STORE = 'metadata';

export class IndexedDBStorage implements StorageManager {
  private db: IDBDatabase | null = null;
  private config: StorageConfig;
  private dbName: string;

  constructor(config: StorageConfig) {
    this.config = config;
    this.dbName = `vectordb_${config.dbName}`;
  }

  /**
   * Initialize the IndexedDB database with proper schema
   */
  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      const version = this.config.version || 1;
      const request = indexedDB.open(this.dbName, version);

      request.onerror = () => {
        reject(new VectorDBError(
          'Failed to open IndexedDB',
          'DB_OPEN_ERROR',
          { error: request.error }
        ));
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create vectors store
        if (!db.objectStoreNames.contains(VECTORS_STORE)) {
          const vectorStore = db.createObjectStore(VECTORS_STORE, { keyPath: 'id' });
          vectorStore.createIndex('timestamp', 'timestamp', { unique: false });
          // Create indexes for common metadata fields
          vectorStore.createIndex('metadata.tags', 'metadata.tags', { 
            unique: false, 
            multiEntry: true 
          });
        }

        // Create index store
        if (!db.objectStoreNames.contains(INDEX_STORE)) {
          db.createObjectStore(INDEX_STORE, { keyPath: 'version' });
        }

        // Create metadata store
        if (!db.objectStoreNames.contains(METADATA_STORE)) {
          db.createObjectStore(METADATA_STORE, { keyPath: 'key' });
        }
      };
    });
  }

  /**
   * Store a single vector record
   */
  async put(record: VectorRecord): Promise<void> {
    this.ensureInitialized();

    try {
      const serializedRecord = this.serializeRecord(record);
      
      return new Promise((resolve, reject) => {
        const transaction = this.db!.transaction([VECTORS_STORE], 'readwrite');
        const store = transaction.objectStore(VECTORS_STORE);
        const request = store.put(serializedRecord);

        request.onsuccess = () => resolve();
        request.onerror = () => {
          if (request.error?.name === 'QuotaExceededError') {
            reject(new StorageQuotaError({ 
              operation: 'put',
              recordId: record.id 
            }));
          } else {
            reject(new VectorDBError(
              'Failed to store vector',
              'STORAGE_PUT_ERROR',
              { error: request.error, recordId: record.id }
            ));
          }
        };
      });
    } catch (error) {
      throw new VectorDBError(
        'Failed to serialize vector record',
        'SERIALIZATION_ERROR',
        { error, recordId: record.id }
      );
    }
  }

  /**
   * Store multiple vector records in a batch
   */
  async putBatch(records: VectorRecord[]): Promise<void> {
    this.ensureInitialized();

    if (records.length === 0) return;

    try {
      const serializedRecords = records.map(r => this.serializeRecord(r));

      return new Promise((resolve, reject) => {
        const transaction = this.db!.transaction([VECTORS_STORE], 'readwrite');
        const store = transaction.objectStore(VECTORS_STORE);

        let completed = 0;
        let hasError = false;

        for (const record of serializedRecords) {
          if (hasError) break;

          const request = store.put(record);
          
          request.onsuccess = () => {
            completed++;
            if (completed === serializedRecords.length) {
              resolve();
            }
          };

          request.onerror = () => {
            hasError = true;
            if (request.error?.name === 'QuotaExceededError') {
              reject(new StorageQuotaError({ 
                operation: 'putBatch',
                recordCount: records.length 
              }));
            } else {
              reject(new VectorDBError(
                'Failed to store vector batch',
                'STORAGE_PUT_BATCH_ERROR',
                { error: request.error, recordCount: records.length }
              ));
            }
          };
        }

        transaction.onerror = () => {
          if (!hasError) {
            reject(new VectorDBError(
              'Transaction failed during batch insert',
              'TRANSACTION_ERROR',
              { error: transaction.error }
            ));
          }
        };
      });
    } catch (error) {
      throw new VectorDBError(
        'Failed to serialize vector records',
        'SERIALIZATION_ERROR',
        { error, recordCount: records.length }
      );
    }
  }

  /**
   * Retrieve a single vector record by ID
   */
  async get(id: string): Promise<VectorRecord | null> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([VECTORS_STORE], 'readonly');
      const store = transaction.objectStore(VECTORS_STORE);
      const request = store.get(id);

      request.onsuccess = () => {
        if (request.result) {
          try {
            resolve(this.deserializeRecord(request.result));
          } catch (error) {
            reject(new VectorDBError(
              'Failed to deserialize vector record',
              'DESERIALIZATION_ERROR',
              { error, recordId: id }
            ));
          }
        } else {
          resolve(null);
        }
      };

      request.onerror = () => {
        reject(new VectorDBError(
          'Failed to retrieve vector',
          'STORAGE_GET_ERROR',
          { error: request.error, recordId: id }
        ));
      };
    });
  }

  /**
   * Retrieve multiple vector records by IDs
   */
  async getBatch(ids: string[]): Promise<VectorRecord[]> {
    this.ensureInitialized();

    if (ids.length === 0) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([VECTORS_STORE], 'readonly');
      const store = transaction.objectStore(VECTORS_STORE);
      const results: VectorRecord[] = [];
      let completed = 0;

      for (const id of ids) {
        const request = store.get(id);

        request.onsuccess = () => {
          if (request.result) {
            try {
              results.push(this.deserializeRecord(request.result));
            } catch (error) {
              reject(new VectorDBError(
                'Failed to deserialize vector record',
                'DESERIALIZATION_ERROR',
                { error, recordId: id }
              ));
              return;
            }
          }
          completed++;
          if (completed === ids.length) {
            resolve(results);
          }
        };

        request.onerror = () => {
          reject(new VectorDBError(
            'Failed to retrieve vector batch',
            'STORAGE_GET_BATCH_ERROR',
            { error: request.error, recordId: id }
          ));
        };
      }
    });
  }

  /**
   * Get all vector records
   */
  async getAll(): Promise<VectorRecord[]> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([VECTORS_STORE], 'readonly');
      const store = transaction.objectStore(VECTORS_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        try {
          const records = request.result.map(record => this.deserializeRecord(record));
          resolve(records);
        } catch (error) {
          reject(new VectorDBError(
            'Failed to deserialize vector records',
            'DESERIALIZATION_ERROR',
            { error }
          ));
        }
      };

      request.onerror = () => {
        reject(new VectorDBError(
          'Failed to retrieve all vectors',
          'STORAGE_GET_ALL_ERROR',
          { error: request.error }
        ));
      };
    });
  }

  /**
   * Stream all vector records one at a time via a cursor.
   *
   * Unlike `getAll()`, this never materializes the full result set in
   * memory — the cursor advances one record at a time and each is
   * yielded before the next is fetched. This is what makes
   * `VectorDB.exportStream()` a true stream rather than a buffered one.
   */
  async *stream(): AsyncGenerator<VectorRecord, void, unknown> {
    this.ensureInitialized();

    // The transaction stays alive for the lifetime of the generator: each
    // `cursor.continue()` is a request against it, which keeps it from
    // auto-committing between yields.
    const transaction = this.db!.transaction([VECTORS_STORE], 'readonly');
    const store = transaction.objectStore(VECTORS_STORE);
    const request = store.openCursor();

    // Promise-per-continue: each cursor advance resolves `nextCursor()`.
    let resolveCursor: ((c: IDBCursorWithValue | null) => void) | null = null;
    let pendingCursor: IDBCursorWithValue | null = null;
    let streamError: Error | null = null;

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null;
      if (resolveCursor) {
        const r = resolveCursor;
        resolveCursor = null;
        r(cursor);
      } else {
        pendingCursor = cursor;
      }
    };

    request.onerror = () => {
      streamError = new VectorDBError(
        'Failed to stream vectors',
        'STORAGE_STREAM_ERROR',
        { error: request.error }
      );
      if (resolveCursor) {
        const r = resolveCursor;
        resolveCursor = null;
        r(null);
      }
    };

    const nextCursor = (): Promise<IDBCursorWithValue | null> =>
      new Promise((resolve) => {
        if (streamError) {
          resolve(null);
          return;
        }
        if (pendingCursor !== null) {
          const c = pendingCursor;
          pendingCursor = null;
          resolve(c);
        } else {
          resolveCursor = resolve;
        }
      });

    try {
      let cursor = await nextCursor();
      while (cursor) {
        const record = this.deserializeRecord(cursor.value);
        yield record;
        cursor.continue();
        cursor = await nextCursor();
      }
      if (streamError) throw streamError;
    } finally {
      // Release the transaction if the consumer breaks early (break/return
      // in a for-await). Aborting an already-completed transaction throws.
      try {
        transaction.abort();
      } catch {
        // Transaction already finished — nothing to release.
      }
    }
  }

  /**
   * Delete a vector record by ID
   */
  async delete(id: string): Promise<boolean> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([VECTORS_STORE], 'readwrite');
      const store = transaction.objectStore(VECTORS_STORE);
      
      // First check if the record exists
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        if (!getRequest.result) {
          resolve(false);
          return;
        }

        const deleteRequest = store.delete(id);

        deleteRequest.onsuccess = () => resolve(true);
        deleteRequest.onerror = () => {
          reject(new VectorDBError(
            'Failed to delete vector',
            'STORAGE_DELETE_ERROR',
            { error: deleteRequest.error, recordId: id }
          ));
        };
      };

      getRequest.onerror = () => {
        reject(new VectorDBError(
          'Failed to check vector existence',
          'STORAGE_GET_ERROR',
          { error: getRequest.error, recordId: id }
        ));
      };
    });
  }

  /**
   * Clear all vector records
   */
  async clear(): Promise<void> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([VECTORS_STORE], 'readwrite');
      const store = transaction.objectStore(VECTORS_STORE);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => {
        reject(new VectorDBError(
          'Failed to clear vectors',
          'STORAGE_CLEAR_ERROR',
          { error: request.error }
        ));
      };
    });
  }

  /**
   * Filter vector records by metadata
   */
  async filter(predicate: Filter): Promise<VectorRecord[]> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([VECTORS_STORE], 'readonly');
      const store = transaction.objectStore(VECTORS_STORE);
      const request = store.openCursor();
      const results: VectorRecord[] = [];

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as IDBCursorWithValue;

        if (cursor) {
          try {
            const record = this.deserializeRecord(cursor.value);
            if (this.evaluateFilter(record, predicate)) {
              results.push(record);
            }
            cursor.continue();
          } catch (error) {
            reject(new VectorDBError(
              'Failed to deserialize vector record during filter',
              'DESERIALIZATION_ERROR',
              { error }
            ));
          }
        } else {
          resolve(results);
        }
      };

      request.onerror = () => {
        reject(new VectorDBError(
          'Failed to filter vectors',
          'STORAGE_FILTER_ERROR',
          { error: request.error, filter: predicate }
        ));
      };
    });
  }

  /**
   * Count total number of vector records
   */
  async count(): Promise<number> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([VECTORS_STORE], 'readonly');
      const store = transaction.objectStore(VECTORS_STORE);
      const request = store.count();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        reject(new VectorDBError(
          'Failed to count vectors',
          'STORAGE_COUNT_ERROR',
          { error: request.error }
        ));
      };
    });
  }

  /**
   * Save serialized index to storage
   */
  async saveIndex(serializedIndex: string): Promise<void> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([INDEX_STORE], 'readwrite');
      const store = transaction.objectStore(INDEX_STORE);
      const request = store.put({
        version: 'current',
        data: serializedIndex,
        timestamp: Date.now()
      });

      request.onsuccess = () => resolve();
      request.onerror = () => {
        if (request.error?.name === 'QuotaExceededError') {
          reject(new StorageQuotaError({ 
            operation: 'saveIndex',
            indexSize: serializedIndex.length 
          }));
        } else {
          reject(new VectorDBError(
            'Failed to save index',
            'INDEX_SAVE_ERROR',
            { error: request.error }
          ));
        }
      };
    });
  }

  /**
   * Load serialized index from storage
   */
  async loadIndex(): Promise<string | null> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([INDEX_STORE], 'readonly');
      const store = transaction.objectStore(INDEX_STORE);
      const request = store.get('current');

      request.onsuccess = () => {
        if (request.result && request.result.data) {
          try {
            // Validate that the index data is a string
            if (typeof request.result.data !== 'string') {
              throw new IndexCorruptedError({ 
                reason: 'Index data is not a string',
                type: typeof request.result.data 
              });
            }
            resolve(request.result.data);
          } catch (error) {
            if (error instanceof IndexCorruptedError) {
              reject(error);
            } else {
              reject(new IndexCorruptedError({ 
                error,
                reason: 'Failed to validate index data' 
              }));
            }
          }
        } else {
          resolve(null);
        }
      };

      request.onerror = () => {
        reject(new VectorDBError(
          'Failed to load index',
          'INDEX_LOAD_ERROR',
          { error: request.error }
        ));
      };
    });
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Delete the entire database
   */
  async destroy(): Promise<void> {
    await this.close();

    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(this.dbName);

      request.onsuccess = () => resolve();
      request.onerror = () => {
        reject(new VectorDBError(
          'Failed to delete database',
          'DB_DELETE_ERROR',
          { error: request.error, dbName: this.dbName }
        ));
      };
      request.onblocked = () => {
        reject(new VectorDBError(
          'Database deletion blocked',
          'DB_DELETE_BLOCKED',
          { dbName: this.dbName }
        ));
      };
    });
  }

  /**
   * Serialize a vector record for storage.
   * The Float32Array is stored by reference — IndexedDB's structured clone
   * handles typed arrays natively, which avoids the ~8x memory spike of
   * `Array.from` (a 384-dim Float32Array became a 384-element JS array of
   * boxed numbers per record, per batch write).
   */
  private serializeRecord(record: VectorRecord): any {
    return {
      id: record.id,
      vector: record.vector,
      metadata: record.metadata,
      timestamp: record.timestamp
    };
  }

  /**
   * Deserialize a stored record back to VectorRecord.
   * Handles both the native typed-array form (new) and the legacy plain-array
   * form written by older versions, for back-compat during migration.
   */
  private deserializeRecord(data: any): VectorRecord {
    if (!data.id || !data.vector || !data.metadata || !data.timestamp) {
      throw new VectorDBError(
        'Invalid record format',
        'INVALID_RECORD_FORMAT',
        { data }
      );
    }

    const vector: Float32Array = data.vector instanceof Float32Array
      ? data.vector
      : new Float32Array(data.vector);

    return {
      id: data.id,
      vector,
      metadata: data.metadata,
      timestamp: data.timestamp
    };
  }

  /**
   * Evaluate a filter (simple or compound) against a record
   */
  private evaluateFilter(record: VectorRecord, filter: Filter): boolean {
    if (this.isCompoundFilter(filter)) {
      return this.evaluateCompoundFilter(record, filter);
    } else {
      return this.matchesFilter(record, filter);
    }
  }

  /**
   * Type guard to check if a filter is a compound filter
   */
  private isCompoundFilter(filter: Filter): filter is CompoundFilter {
    return 'operator' in filter && ('and' === filter.operator || 'or' === filter.operator);
  }

  /**
   * Evaluate a compound filter (AND/OR logic)
   */
  private evaluateCompoundFilter(record: VectorRecord, filter: CompoundFilter): boolean {
    if (!filter.filters || filter.filters.length === 0) {
      return true;
    }

    if (filter.operator === 'and') {
      // All filters must match
      return filter.filters.every(f => this.evaluateFilter(record, f));
    } else if (filter.operator === 'or') {
      // At least one filter must match
      return filter.filters.some(f => this.evaluateFilter(record, f));
    }

    return false;
  }

  /**
   * Check if a record matches a metadata filter
   */
  private matchesFilter(record: VectorRecord, filter: MetadataFilter): boolean {
    const value = this.getNestedValue(record.metadata, filter.field);

    if (value === undefined) {
      return false;
    }

    switch (filter.operator) {
      case 'eq':
        return value === filter.value;
      case 'ne':
        return value !== filter.value;
      case 'gt':
        return value > filter.value;
      case 'gte':
        return value >= filter.value;
      case 'lt':
        return value < filter.value;
      case 'lte':
        return value <= filter.value;
      case 'in':
        return Array.isArray(filter.value) && filter.value.includes(value);
      case 'contains':
        if (Array.isArray(value)) {
          return value.includes(filter.value);
        }
        if (typeof value === 'string') {
          return value.includes(filter.value);
        }
        return false;
      default:
        return false;
    }
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: any, path: string): any {
    const parts = path.split('.');
    let current = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[part];
    }

    return current;
  }

  /**
   * Ensure the database is initialized
   */
  private ensureInitialized(): void {
    if (!this.db) {
      throw new VectorDBError(
        'Storage not initialized. Call initialize() first.',
        'NOT_INITIALIZED'
      );
    }
  }
}
