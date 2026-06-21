import { env as se, pipeline as be } from "@huggingface/transformers";
import { useState as x, useRef as de, useEffect as he, useCallback as $ } from "react";
class m extends Error {
  constructor(e, t, i) {
    super(e), this.code = t, this.details = i, this.name = "VectorDBError", Object.setPrototypeOf(this, m.prototype);
  }
}
class L extends m {
  constructor(e) {
    super("Storage quota exceeded", "STORAGE_QUOTA_EXCEEDED", e), this.name = "StorageQuotaError", Object.setPrototypeOf(this, L.prototype);
  }
}
class E extends m {
  constructor(e, t) {
    super(
      `Dimension mismatch: expected ${e}, got ${t}`,
      "DIMENSION_MISMATCH",
      { expected: e, actual: t }
    ), this.name = "DimensionMismatchError", Object.setPrototypeOf(this, E.prototype);
  }
}
class X extends m {
  constructor(e, t) {
    super(`Failed to load model: ${e}`, "MODEL_LOAD_ERROR", { model: e, cause: t }), this.name = "ModelLoadError", Object.setPrototypeOf(this, X.prototype);
  }
}
class P extends m {
  constructor(e) {
    super("Index data is corrupted", "INDEX_CORRUPTED", e), this.name = "IndexCorruptedError", Object.setPrototypeOf(this, P.prototype);
  }
}
class T {
  /**
   * Validate a vector for correct dimensions and valid values
   */
  static validateVector(e, t) {
    if (e.length !== t)
      throw new E(t, e.length);
    if (!this.isFiniteVector(e))
      throw new m(
        "Vector contains invalid values (NaN or Infinity)",
        "INVALID_VECTOR",
        { vectorLength: e.length }
      );
  }
  /**
   * Check if all vector values are finite
   */
  static isFiniteVector(e) {
    for (let t = 0; t < e.length; t++)
      if (!Number.isFinite(e[t]))
        return !1;
    return !0;
  }
  /**
   * Validate and sanitize metadata to prevent XSS and ensure valid structure
   */
  static validateAndSanitizeMetadata(e) {
    if (e == null)
      return {};
    if (typeof e != "object" || Array.isArray(e))
      throw new m(
        "Metadata must be a plain object",
        "INVALID_METADATA",
        { type: typeof e }
      );
    const t = {};
    for (const [i, r] of Object.entries(e)) {
      if (typeof i != "string" || i.length === 0)
        throw new m(
          "Metadata keys must be non-empty strings",
          "INVALID_METADATA_KEY",
          { key: i }
        );
      t[i] = this.sanitizeValue(r);
    }
    return t;
  }
  /**
   * Sanitize a single metadata value
   */
  static sanitizeValue(e) {
    if (e == null)
      return e;
    if (typeof e == "string")
      return this.sanitizeString(e);
    if (typeof e == "number" || typeof e == "boolean")
      return e;
    if (Array.isArray(e))
      return e.map((t) => this.sanitizeValue(t));
    if (typeof e == "object") {
      const t = {};
      for (const [i, r] of Object.entries(e))
        t[i] = this.sanitizeValue(r);
      return t;
    }
    throw new m(
      "Metadata values must be strings, numbers, booleans, arrays, or plain objects",
      "INVALID_METADATA_VALUE",
      { type: typeof e }
    );
  }
  /**
   * Sanitize string to prevent XSS attacks
   */
  static sanitizeString(e) {
    return typeof e != "string" ? e : e.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;").replace(/\//g, "&#x2F;");
  }
  /**
   * Validate search query parameters
   */
  static validateSearchQuery(e, t) {
    if (!Number.isInteger(e) || e <= 0)
      throw new m(
        "Search parameter k must be a positive integer",
        "INVALID_SEARCH_PARAM",
        { k: e }
      );
    if (e > 1e4)
      throw new m(
        "Search parameter k is too large (max 10000)",
        "INVALID_SEARCH_PARAM",
        { k: e, max: 1e4 }
      );
  }
}
const xe = {
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 5e3,
  backoffMultiplier: 2
};
class et {
  constructor(e) {
    this.logger = e || ((t, i) => console.error(t, i));
  }
  /**
   * Handle an error with appropriate recovery strategy
   */
  async handleError(e, t) {
    e instanceof L ? this.logger(
      "Storage quota exceeded. Consider exporting and clearing old data, or reducing the dataset size.",
      e,
      { context: t }
    ) : e instanceof P ? this.logger(
      "Index corrupted. The index will need to be rebuilt from stored vectors.",
      e,
      { context: t }
    ) : e instanceof X ? this.logger(
      "Failed to load model. Check network connection or try a different model.",
      e,
      { context: t }
    ) : e instanceof E ? this.logger(
      "Dimension mismatch detected. Ensure all vectors have the same dimensions.",
      e,
      { context: t }
    ) : e instanceof m ? this.logger(
      `VectorDB error: ${e.message}`,
      e,
      { context: t, code: e.code }
    ) : this.logger(
      `Unexpected error: ${e.message}`,
      e,
      { context: t }
    );
  }
  /**
   * Execute an operation with retry logic for transient failures
   */
  async withRetry(e, t = {}, i = this.isTransientError) {
    const r = { ...xe, ...t };
    let n, s = r.initialDelayMs;
    for (let a = 1; a <= r.maxAttempts; a++)
      try {
        return await e();
      } catch (o) {
        if (n = o, !i(n))
          throw n;
        if (a === r.maxAttempts)
          throw this.logger(
            `Operation failed after ${a} attempts`,
            n,
            { attempts: a }
          ), n;
        this.logger(
          `Operation failed, retrying (attempt ${a}/${r.maxAttempts})`,
          n,
          { attempt: a, delay: s }
        ), await this.sleep(s), s = Math.min(s * r.backoffMultiplier, r.maxDelayMs);
      }
    throw n;
  }
  /**
   * Determine if an error is transient and should be retried
   */
  isTransientError(e) {
    return e.message.includes("network") || e.message.includes("fetch") || e.message.includes("timeout") || e instanceof X ? !0 : (e instanceof E || e instanceof L || e instanceof P, !1);
  }
  /**
   * Sleep for a specified duration
   */
  sleep(e) {
    return new Promise((t) => setTimeout(t, e));
  }
  /**
   * Rebuild index from stored vectors (recovery strategy for corrupted index)
   */
  async rebuildIndex(e, t) {
    try {
      this.logger("Starting index rebuild from stored vectors...");
      const i = await e.count();
      this.logger(`Found ${i} vectors to rebuild`), await t.clear();
      const r = await e.getAllIds();
      for (const n of r) {
        const s = await e.get(n);
        s && s.vector && await t.add(n, s.vector);
      }
      this.logger("Index rebuild completed successfully");
    } catch (i) {
      throw this.logger("Failed to rebuild index", i), new m(
        "Index rebuild failed",
        "INDEX_REBUILD_ERROR",
        { error: i }
      );
    }
  }
}
const v = "vectors", _ = "index", ae = "metadata";
class ue {
  constructor(e) {
    this.db = null, this.config = e, this.dbName = `vectordb_${e.dbName}`;
  }
  /**
   * Initialize the IndexedDB database with proper schema
   */
  async initialize() {
    return new Promise((e, t) => {
      const i = this.config.version || 1, r = indexedDB.open(this.dbName, i);
      r.onerror = () => {
        t(new m(
          "Failed to open IndexedDB",
          "DB_OPEN_ERROR",
          { error: r.error }
        ));
      }, r.onsuccess = () => {
        this.db = r.result, e();
      }, r.onupgradeneeded = (n) => {
        const s = n.target.result;
        if (!s.objectStoreNames.contains(v)) {
          const a = s.createObjectStore(v, { keyPath: "id" });
          a.createIndex("timestamp", "timestamp", { unique: !1 }), a.createIndex("metadata.tags", "metadata.tags", {
            unique: !1,
            multiEntry: !0
          });
        }
        s.objectStoreNames.contains(_) || s.createObjectStore(_, { keyPath: "version" }), s.objectStoreNames.contains(ae) || s.createObjectStore(ae, { keyPath: "key" });
      };
    });
  }
  /**
   * Store a single vector record
   */
  async put(e) {
    this.ensureInitialized();
    try {
      const t = this.serializeRecord(e);
      return new Promise((i, r) => {
        const a = this.db.transaction([v], "readwrite").objectStore(v).put(t);
        a.onsuccess = () => i(), a.onerror = () => {
          a.error?.name === "QuotaExceededError" ? r(new L({
            operation: "put",
            recordId: e.id
          })) : r(new m(
            "Failed to store vector",
            "STORAGE_PUT_ERROR",
            { error: a.error, recordId: e.id }
          ));
        };
      });
    } catch (t) {
      throw new m(
        "Failed to serialize vector record",
        "SERIALIZATION_ERROR",
        { error: t, recordId: e.id }
      );
    }
  }
  /**
   * Store multiple vector records in a batch
   */
  async putBatch(e) {
    if (this.ensureInitialized(), e.length !== 0)
      try {
        const t = e.map((i) => this.serializeRecord(i));
        return new Promise((i, r) => {
          const n = this.db.transaction([v], "readwrite"), s = n.objectStore(v);
          let a = 0, o = !1;
          for (const c of t) {
            if (o) break;
            const d = s.put(c);
            d.onsuccess = () => {
              a++, a === t.length && i();
            }, d.onerror = () => {
              o = !0, d.error?.name === "QuotaExceededError" ? r(new L({
                operation: "putBatch",
                recordCount: e.length
              })) : r(new m(
                "Failed to store vector batch",
                "STORAGE_PUT_BATCH_ERROR",
                { error: d.error, recordCount: e.length }
              ));
            };
          }
          n.onerror = () => {
            o || r(new m(
              "Transaction failed during batch insert",
              "TRANSACTION_ERROR",
              { error: n.error }
            ));
          };
        });
      } catch (t) {
        throw new m(
          "Failed to serialize vector records",
          "SERIALIZATION_ERROR",
          { error: t, recordCount: e.length }
        );
      }
  }
  /**
   * Retrieve a single vector record by ID
   */
  async get(e) {
    return this.ensureInitialized(), new Promise((t, i) => {
      const s = this.db.transaction([v], "readonly").objectStore(v).get(e);
      s.onsuccess = () => {
        if (s.result)
          try {
            t(this.deserializeRecord(s.result));
          } catch (a) {
            i(new m(
              "Failed to deserialize vector record",
              "DESERIALIZATION_ERROR",
              { error: a, recordId: e }
            ));
          }
        else
          t(null);
      }, s.onerror = () => {
        i(new m(
          "Failed to retrieve vector",
          "STORAGE_GET_ERROR",
          { error: s.error, recordId: e }
        ));
      };
    });
  }
  /**
   * Retrieve multiple vector records by IDs
   */
  async getBatch(e) {
    return this.ensureInitialized(), e.length === 0 ? [] : new Promise((t, i) => {
      const n = this.db.transaction([v], "readonly").objectStore(v), s = [];
      let a = 0;
      for (const o of e) {
        const c = n.get(o);
        c.onsuccess = () => {
          if (c.result)
            try {
              s.push(this.deserializeRecord(c.result));
            } catch (d) {
              i(new m(
                "Failed to deserialize vector record",
                "DESERIALIZATION_ERROR",
                { error: d, recordId: o }
              ));
              return;
            }
          a++, a === e.length && t(s);
        }, c.onerror = () => {
          i(new m(
            "Failed to retrieve vector batch",
            "STORAGE_GET_BATCH_ERROR",
            { error: c.error, recordId: o }
          ));
        };
      }
    });
  }
  /**
   * Get all vector records
   */
  async getAll() {
    return this.ensureInitialized(), new Promise((e, t) => {
      const n = this.db.transaction([v], "readonly").objectStore(v).getAll();
      n.onsuccess = () => {
        try {
          const s = n.result.map((a) => this.deserializeRecord(a));
          e(s);
        } catch (s) {
          t(new m(
            "Failed to deserialize vector records",
            "DESERIALIZATION_ERROR",
            { error: s }
          ));
        }
      }, n.onerror = () => {
        t(new m(
          "Failed to retrieve all vectors",
          "STORAGE_GET_ALL_ERROR",
          { error: n.error }
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
  async *stream() {
    this.ensureInitialized();
    const e = this.db.transaction([v], "readonly"), i = e.objectStore(v).openCursor();
    let r = null, n = null, s = null;
    i.onsuccess = (o) => {
      const c = o.target.result;
      if (r) {
        const d = r;
        r = null, d(c);
      } else
        n = c;
    }, i.onerror = () => {
      if (s = new m(
        "Failed to stream vectors",
        "STORAGE_STREAM_ERROR",
        { error: i.error }
      ), r) {
        const o = r;
        r = null, o(null);
      }
    };
    const a = () => new Promise((o) => {
      if (s) {
        o(null);
        return;
      }
      if (n !== null) {
        const c = n;
        n = null, o(c);
      } else
        r = o;
    });
    try {
      let o = await a();
      for (; o; )
        yield this.deserializeRecord(o.value), o.continue(), o = await a();
      if (s) throw s;
    } finally {
      try {
        e.abort();
      } catch {
      }
    }
  }
  /**
   * Delete a vector record by ID
   */
  async delete(e) {
    return this.ensureInitialized(), new Promise((t, i) => {
      const n = this.db.transaction([v], "readwrite").objectStore(v), s = n.get(e);
      s.onsuccess = () => {
        if (!s.result) {
          t(!1);
          return;
        }
        const a = n.delete(e);
        a.onsuccess = () => t(!0), a.onerror = () => {
          i(new m(
            "Failed to delete vector",
            "STORAGE_DELETE_ERROR",
            { error: a.error, recordId: e }
          ));
        };
      }, s.onerror = () => {
        i(new m(
          "Failed to check vector existence",
          "STORAGE_GET_ERROR",
          { error: s.error, recordId: e }
        ));
      };
    });
  }
  /**
   * Clear all vector records
   */
  async clear() {
    return this.ensureInitialized(), new Promise((e, t) => {
      const n = this.db.transaction([v], "readwrite").objectStore(v).clear();
      n.onsuccess = () => e(), n.onerror = () => {
        t(new m(
          "Failed to clear vectors",
          "STORAGE_CLEAR_ERROR",
          { error: n.error }
        ));
      };
    });
  }
  /**
   * Filter vector records by metadata
   */
  async filter(e) {
    return this.ensureInitialized(), new Promise((t, i) => {
      const s = this.db.transaction([v], "readonly").objectStore(v).openCursor(), a = [];
      s.onsuccess = (o) => {
        const c = o.target.result;
        if (c)
          try {
            const d = this.deserializeRecord(c.value);
            this.evaluateFilter(d, e) && a.push(d), c.continue();
          } catch (d) {
            i(new m(
              "Failed to deserialize vector record during filter",
              "DESERIALIZATION_ERROR",
              { error: d }
            ));
          }
        else
          t(a);
      }, s.onerror = () => {
        i(new m(
          "Failed to filter vectors",
          "STORAGE_FILTER_ERROR",
          { error: s.error, filter: e }
        ));
      };
    });
  }
  /**
   * Count total number of vector records
   */
  async count() {
    return this.ensureInitialized(), new Promise((e, t) => {
      const n = this.db.transaction([v], "readonly").objectStore(v).count();
      n.onsuccess = () => e(n.result), n.onerror = () => {
        t(new m(
          "Failed to count vectors",
          "STORAGE_COUNT_ERROR",
          { error: n.error }
        ));
      };
    });
  }
  /**
   * Save serialized index to storage
   */
  async saveIndex(e) {
    return this.ensureInitialized(), new Promise((t, i) => {
      const s = this.db.transaction([_], "readwrite").objectStore(_).put({
        version: "current",
        data: e,
        timestamp: Date.now()
      });
      s.onsuccess = () => t(), s.onerror = () => {
        s.error?.name === "QuotaExceededError" ? i(new L({
          operation: "saveIndex",
          indexSize: e.length
        })) : i(new m(
          "Failed to save index",
          "INDEX_SAVE_ERROR",
          { error: s.error }
        ));
      };
    });
  }
  /**
   * Load serialized index from storage
   */
  async loadIndex() {
    return this.ensureInitialized(), new Promise((e, t) => {
      const n = this.db.transaction([_], "readonly").objectStore(_).get("current");
      n.onsuccess = () => {
        if (n.result && n.result.data)
          try {
            if (typeof n.result.data != "string")
              throw new P({
                reason: "Index data is not a string",
                type: typeof n.result.data
              });
            e(n.result.data);
          } catch (s) {
            s instanceof P ? t(s) : t(new P({
              error: s,
              reason: "Failed to validate index data"
            }));
          }
        else
          e(null);
      }, n.onerror = () => {
        t(new m(
          "Failed to load index",
          "INDEX_LOAD_ERROR",
          { error: n.error }
        ));
      };
    });
  }
  /**
   * Close the database connection
   */
  async close() {
    this.db && (this.db.close(), this.db = null);
  }
  /**
   * Delete the entire database
   */
  async destroy() {
    return await this.close(), new Promise((e, t) => {
      const i = indexedDB.deleteDatabase(this.dbName);
      i.onsuccess = () => e(), i.onerror = () => {
        t(new m(
          "Failed to delete database",
          "DB_DELETE_ERROR",
          { error: i.error, dbName: this.dbName }
        ));
      }, i.onblocked = () => {
        t(new m(
          "Database deletion blocked",
          "DB_DELETE_BLOCKED",
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
  serializeRecord(e) {
    return {
      id: e.id,
      vector: e.vector,
      metadata: e.metadata,
      timestamp: e.timestamp
    };
  }
  /**
   * Deserialize a stored record back to VectorRecord.
   * Handles both the native typed-array form (new) and the legacy plain-array
   * form written by older versions, for back-compat during migration.
   */
  deserializeRecord(e) {
    if (!e.id || !e.vector || !e.metadata || !e.timestamp)
      throw new m(
        "Invalid record format",
        "INVALID_RECORD_FORMAT",
        { data: e }
      );
    const t = e.vector instanceof Float32Array ? e.vector : new Float32Array(e.vector);
    return {
      id: e.id,
      vector: t,
      metadata: e.metadata,
      timestamp: e.timestamp
    };
  }
  /**
   * Evaluate a filter (simple or compound) against a record
   */
  evaluateFilter(e, t) {
    return this.isCompoundFilter(t) ? this.evaluateCompoundFilter(e, t) : this.matchesFilter(e, t);
  }
  /**
   * Type guard to check if a filter is a compound filter
   */
  isCompoundFilter(e) {
    return "operator" in e && (e.operator === "and" || e.operator === "or");
  }
  /**
   * Evaluate a compound filter (AND/OR logic)
   */
  evaluateCompoundFilter(e, t) {
    return !t.filters || t.filters.length === 0 ? !0 : t.operator === "and" ? t.filters.every((i) => this.evaluateFilter(e, i)) : t.operator === "or" ? t.filters.some((i) => this.evaluateFilter(e, i)) : !1;
  }
  /**
   * Check if a record matches a metadata filter
   */
  matchesFilter(e, t) {
    const i = this.getNestedValue(e.metadata, t.field);
    if (i === void 0)
      return !1;
    switch (t.operator) {
      case "eq":
        return i === t.value;
      case "ne":
        return i !== t.value;
      case "gt":
        return i > t.value;
      case "gte":
        return i >= t.value;
      case "lt":
        return i < t.value;
      case "lte":
        return i <= t.value;
      case "in":
        return Array.isArray(t.value) && t.value.includes(i);
      case "contains":
        return Array.isArray(i) || typeof i == "string" ? i.includes(t.value) : !1;
      default:
        return !1;
    }
  }
  /**
   * Get nested value from object using dot notation
   */
  getNestedValue(e, t) {
    const i = t.split(".");
    let r = e;
    for (const n of i) {
      if (r == null)
        return;
      r = r[n];
    }
    return r;
  }
  /**
   * Ensure the database is initialized
   */
  ensureInitialized() {
    if (!this.db)
      throw new m(
        "Storage not initialized. Call initialize() first.",
        "NOT_INITIALIZED"
      );
  }
}
class Q {
  constructor(e) {
    this.nodes = /* @__PURE__ */ new Map(), this.entryPointId = null, this.maxLevel = -1, this.vectorCount = 0, this.lastUpdated = 0, this.isInitialized = !1, this.config = {
      dimensions: e.dimensions,
      metric: e.metric ?? "cosine",
      m: e.m ?? 16,
      efConstruction: e.efConstruction ?? 200,
      efSearch: e.efSearch ?? 50,
      seed: e.seed ?? 0
    };
    let t = this.config.seed || 1;
    this.rng = this.config.seed ? () => (t = t * 1664525 + 1013904223 >>> 0, t / 4294967296) : Math.random;
  }
  async initialize() {
    this.isInitialized = !0;
  }
  async add(e) {
    this.ensureInitialized(), T.validateVector(e.vector, this.config.dimensions), this.insertNode(e.id, e.vector);
  }
  async addBatch(e) {
    this.ensureInitialized();
    for (const t of e)
      T.validateVector(t.vector, this.config.dimensions);
    for (const t of e)
      this.insertNode(t.id, t.vector);
  }
  /**
   * Mark a node deleted. Does NOT rebuild the graph — deleted nodes are
   * skipped during search and pruned from neighbor lists lazily. This is
   * the key property Voy lacked (O(n) rebuild per delete).
   */
  async remove(e) {
    this.ensureInitialized();
    const t = this.nodes.get(e);
    if (t && (t.deleted = !0, this.vectorCount--, this.lastUpdated = Date.now(), this.entryPointId === e)) {
      this.entryPointId = null;
      for (const [i, r] of this.nodes)
        if (!r.deleted) {
          this.entryPointId = i, this.maxLevel = r.level;
          break;
        }
      this.entryPointId === null && (this.maxLevel = -1);
    }
  }
  async search(e, t, i) {
    if (this.ensureInitialized(), T.validateVector(e, this.config.dimensions), this.vectorCount === 0 || this.entryPointId === null)
      return [];
    let r = Math.max(this.config.efSearch, t);
    const n = Math.max(r * 8, t * 16);
    for (let s = 0; s < 4; s++) {
      const a = this.searchLayer(e, r), o = [];
      for (const { id: c, dist: d } of a) {
        const h = this.nodes.get(c);
        if (!(!h || h.deleted) && (o.push({ id: c, score: this.distanceToScore(d) }), o.length >= t))
          break;
      }
      if (i) {
        const c = [];
        for (const { id: d, dist: h } of a) {
          const u = this.nodes.get(d);
          if (!(!u || u.deleted) && (c.push({ id: d, score: this.distanceToScore(h) }), c.length >= r))
            break;
        }
        if (c.length >= t || r >= n)
          return c.slice(0, Math.max(t, r));
        r = Math.min(r * 2, n);
        continue;
      }
      if (o.length >= t || r >= n)
        return o;
      r = Math.min(r * 2, n);
    }
    return this.searchLayer(e, r).filter(({ id: s }) => {
      const a = this.nodes.get(s);
      return a && !a.deleted;
    }).slice(0, t).map(({ id: s, dist: a }) => ({ id: s, score: this.distanceToScore(a) }));
  }
  async serialize() {
    this.ensureInitialized();
    const e = JSON.stringify({
      m: this.config.m,
      efC: this.config.efConstruction,
      efS: this.config.efSearch,
      metric: this.config.metric,
      entry: this.entryPointId,
      maxLevel: this.maxLevel,
      count: this.vectorCount,
      nodes: Array.from(this.nodes.values()).filter((t) => !t.deleted).map((t) => ({
        id: t.id,
        level: t.level,
        v: Array.from(t.vector),
        links: Array.from(t.links.entries())
      }))
    });
    return {
      version: "1.0",
      dimensions: this.config.dimensions,
      metric: this.config.metric,
      vectorCount: this.vectorCount,
      data: e
    };
  }
  async deserialize(e) {
    if (e.dimensions !== this.config.dimensions)
      throw new E(this.config.dimensions, e.dimensions);
    try {
      const t = JSON.parse(e.data);
      this.nodes.clear(), this.vectorCount = 0;
      for (const i of t.nodes) {
        const r = {
          id: i.id,
          vector: new Float32Array(i.v),
          links: new Map(i.links),
          level: i.level,
          deleted: !1
        };
        this.nodes.set(i.id, r), this.vectorCount++;
      }
      this.entryPointId = t.entry ?? null, this.maxLevel = t.maxLevel ?? -1, this.isInitialized = !0, this.lastUpdated = Date.now();
    } catch (t) {
      throw new m("Failed to deserialize HNSW index", "INDEX_DESERIALIZE_ERROR", { error: t });
    }
  }
  async clear() {
    this.ensureInitialized(), this.nodes.clear(), this.entryPointId = null, this.maxLevel = -1, this.vectorCount = 0, this.lastUpdated = Date.now();
  }
  stats() {
    return {
      vectorCount: this.vectorCount,
      dimensions: this.config.dimensions,
      indexType: "hnsw",
      memoryUsage: this.estimateMemory(),
      lastUpdated: this.lastUpdated
    };
  }
  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------
  insertNode(e, t) {
    this.nodes.has(e) && !this.nodes.get(e).deleted && (this.nodes.get(e).deleted = !0);
    const i = this.randomLevel(), r = { id: e, vector: t, links: /* @__PURE__ */ new Map(), level: i, deleted: !1 };
    for (let a = 0; a <= i; a++) r.links.set(a, []);
    if (this.nodes.set(e, r), this.vectorCount++, this.lastUpdated = Date.now(), this.entryPointId === null) {
      this.entryPointId = e, this.maxLevel = i;
      return;
    }
    const n = this.nodes.get(this.entryPointId);
    let s = this.greedySearchLayer(t, n, this.maxLevel, i + 1);
    for (let a = Math.min(i, this.maxLevel); a >= 0; a--) {
      const o = this.searchLayerFrom(t, s, a, this.config.efConstruction), c = this.config.m, d = this.selectNeighbors(o, c);
      for (const { id: h } of d) {
        r.links.get(a).push(h);
        const u = this.nodes.get(h);
        u.links.get(a).push(e), u.links.get(a).length > c && this.pruneNeighbor(u, a, c);
      }
      s = o;
    }
    i > this.maxLevel && (this.maxLevel = i, this.entryPointId = e);
  }
  randomLevel() {
    const e = 1 / Math.log(this.config.m);
    return Math.floor(-Math.log(this.rng() + 1e-12) * e);
  }
  selectNeighbors(e, t) {
    return e.sort((i, r) => i.dist - r.dist).slice(0, t);
  }
  pruneNeighbor(e, t, i) {
    const r = e.links.get(t);
    if (r.length <= i) return;
    const n = r.map((s) => ({ id: s, dist: this.distance(e.vector, this.nodes.get(s).vector) })).sort((s, a) => s.dist - a.dist).slice(0, i).map((s) => s.id);
    e.links.set(t, n);
  }
  // -----------------------------------------------------------------------
  // Search
  // -----------------------------------------------------------------------
  searchLayer(e, t) {
    if (this.entryPointId === null) return [];
    const i = this.nodes.get(this.entryPointId), r = this.greedySearchLayer(e, i, this.maxLevel, 1);
    return this.searchLayerFrom(e, r, 0, t);
  }
  /**
   * Greedy descent from the entry node down to `stopLayer` (exclusive),
   * returning the nearest node at the stop layer.
   */
  greedySearchLayer(e, t, i, r) {
    let n = t, s = this.distance(e, t.vector);
    for (let a = i; a >= r; a--) {
      let o = !0;
      for (; o; ) {
        o = !1;
        const c = n.links.get(a) ?? [];
        for (const d of c) {
          const h = this.nodes.get(d);
          if (!h || h.deleted) continue;
          const u = this.distance(e, h.vector);
          u < s && (s = u, n = h, o = !0);
        }
      }
    }
    return [{ id: n.id, dist: s }];
  }
  /**
   * Best-first search within a single layer using a dynamic candidate list
   * of size ef. Returns up to ef nearest (unsorted-ish; caller sorts).
   */
  searchLayerFrom(e, t, i, r) {
    const n = /* @__PURE__ */ new Set(), s = [], a = [];
    for (const o of t)
      n.add(o.id), s.push(o), a.push(o);
    for (; s.length > 0; ) {
      s.sort((u, f) => u.dist - f.dist);
      const o = s.shift();
      a.sort((u, f) => u.dist - f.dist);
      const c = a[a.length - 1];
      if (a.length >= r && o.dist > c.dist)
        break;
      const d = this.nodes.get(o.id);
      if (!d || d.deleted) continue;
      const h = d.links.get(i) ?? [];
      for (const u of h) {
        if (n.has(u)) continue;
        n.add(u);
        const f = this.nodes.get(u);
        if (!f || f.deleted) continue;
        const p = this.distance(e, f.vector);
        a.push({ id: u, dist: p }), s.push({ id: u, dist: p }), a.length > r && (a.sort((w, z) => w.dist - z.dist), a.pop());
      }
    }
    return a;
  }
  // -----------------------------------------------------------------------
  // Distance
  // -----------------------------------------------------------------------
  distance(e, t) {
    switch (this.config.metric) {
      case "cosine": {
        let i = 0, r = 0, n = 0;
        const s = Math.min(e.length, t.length);
        for (let o = 0; o < s; o++)
          i += e[o] * t[o], r += e[o] * e[o], n += t[o] * t[o];
        const a = Math.sqrt(r) * Math.sqrt(n);
        return a === 0 ? 1 : 1 - i / a;
      }
      case "dot":
        return -this.dot(e, t);
      // higher dot = nearer → negate for "smaller is nearer"
      case "euclidean": {
        let i = 0;
        const r = Math.min(e.length, t.length);
        for (let n = 0; n < r; n++) {
          const s = e[n] - t[n];
          i += s * s;
        }
        return Math.sqrt(i);
      }
    }
  }
  dot(e, t) {
    let i = 0;
    const r = Math.min(e.length, t.length);
    for (let n = 0; n < r; n++) i += e[n] * t[n];
    return i;
  }
  /** Convert internal distance (smaller=nearer) to a similarity score. */
  distanceToScore(e) {
    switch (this.config.metric) {
      case "cosine":
        return 1 - e;
      // back to cosine similarity in [-1, 1]
      case "dot":
        return -e;
      case "euclidean":
        return 1 / (1 + e);
    }
  }
  estimateMemory() {
    let e = 0;
    for (const t of this.nodes.values())
      if (!t.deleted) {
        e += t.vector.byteLength;
        for (const i of t.links.values()) e += i.length * 16;
        e += 64;
      }
    return e;
  }
  ensureInitialized() {
    if (!this.isInitialized)
      throw new m("HnswIndex not initialized. Call initialize() first.", "INDEX_NOT_INITIALIZED");
  }
}
class Y {
  constructor(e) {
    this.pipeline = null, this.dimensions = 0, this.initialized = !1, this.config = {
      device: "wasm",
      cache: !0,
      quantized: !0,
      maxRetries: 3,
      retryDelay: 1e3,
      ...e
    };
  }
  /**
   * Initialize the embedding pipeline with model loading and caching
   */
  async initialize() {
    if (this.initialized)
      return;
    this.config.cache && (se.allowLocalModels = !1, se.useBrowserCache = !0);
    let e = null, t = 0;
    for (; t < this.config.maxRetries; )
      try {
        this.pipeline = await this.loadPipeline(this.config.device);
        const i = await this.generateEmbedding("test");
        this.dimensions = i.length, this.initialized = !0;
        return;
      } catch (i) {
        if (e = i, t++, this.config.device === "webgpu" && t === 1) {
          console.warn("WebGPU initialization failed, falling back to WASM", i), this.config.device = "wasm";
          continue;
        }
        if (t < this.config.maxRetries) {
          const r = this.config.retryDelay * Math.pow(2, t - 1);
          console.warn(`Model loading failed (attempt ${t}/${this.config.maxRetries}), retrying in ${r}ms...`, i), await this.sleep(r);
        }
      }
    throw new Error(
      `Failed to initialize embedding model after ${this.config.maxRetries} attempts: ${e?.message}`
    );
  }
  /**
   * Load the Transformers.js pipeline with device configuration
   */
  async loadPipeline(e) {
    const t = {
      quantized: this.config.quantized
    };
    return e === "webgpu" && (t.device = "webgpu"), await be("feature-extraction", this.config.model, t);
  }
  /**
   * Generate embedding for a single text with mean pooling and normalization
   */
  async embed(e) {
    return this.ensureInitialized(), await this.generateEmbedding(e);
  }
  /**
   * Generate embeddings for multiple texts in batch.
   *
   * Uses a single batched pipeline call rather than looping `embed` per
   * text, which leaves significant throughput on the table for bulk ingest
   * (Transformers.js supports batched inference natively). Falls back to
   * sequential generation only if the batched output shape is unexpected.
   */
  async embedBatch(e) {
    if (this.ensureInitialized(), e.length === 0)
      return [];
    if (!this.pipeline)
      throw new Error("Pipeline not initialized");
    try {
      const t = await this.pipeline(e, {
        pooling: "mean",
        normalize: !0
      });
      return this.extractEmbeddingsBatch(t, e.length);
    } catch {
      const i = [];
      for (const r of e)
        i.push(await this.generateEmbedding(r));
      return i;
    }
  }
  /**
   * Extract an array of Float32Array embeddings from a batched pipeline output.
   * Handles the 2D / nested shapes Transformers.js can return.
   */
  extractEmbeddingsBatch(e, t) {
    if (e?.tolist) {
      const i = e.tolist();
      if (Array.isArray(i) && Array.isArray(i[0]))
        return i.map((r) => new Float32Array(r));
      if (Array.isArray(i))
        return [new Float32Array(i)];
    }
    if (e?.data instanceof Float32Array) {
      const i = e.data, r = this.dimensions || i.length / t;
      if (r > 0 && i.length % r === 0) {
        const n = i.length / r, s = [];
        for (let a = 0; a < n; a++)
          s.push(i.subarray(a * r, (a + 1) * r));
        return s;
      }
      return [i];
    }
    if (Array.isArray(e?.data) && Array.isArray(e.data[0]))
      return e.data.map((i) => new Float32Array(i));
    try {
      return [this.extractEmbedding(e)];
    } catch {
      throw new Error("Unexpected batched output format from embedding pipeline");
    }
  }
  /**
   * Generate embedding for an image using CLIP models
   */
  async embedImage(e) {
    if (this.ensureInitialized(), !this.pipeline)
      throw new Error("Pipeline not initialized");
    try {
      let t = e;
      if (e instanceof ImageData) {
        const r = document.createElement("canvas");
        r.width = e.width, r.height = e.height;
        const n = r.getContext("2d");
        if (!n)
          throw new Error("Failed to get canvas context");
        n.putImageData(e, 0, 0), t = await new Promise((s, a) => {
          r.toBlob((o) => {
            o ? s(o) : a(new Error("Failed to convert ImageData to Blob"));
          });
        });
      }
      const i = await this.pipeline(t, {
        pooling: "mean",
        normalize: !0
      });
      return this.extractEmbedding(i);
    } catch (t) {
      throw new Error(`Failed to generate image embedding: ${t.message}`);
    }
  }
  /**
   * Get the dimensionality of the embeddings
   */
  getDimensions() {
    if (!this.initialized)
      throw new Error("Embedding generator not initialized. Call initialize() first.");
    return this.dimensions;
  }
  /**
   * Clean up resources
   */
  async dispose() {
    this.pipeline && (this.pipeline = null), this.initialized = !1, this.dimensions = 0;
  }
  /**
   * Generate embedding with mean pooling and normalization
   */
  async generateEmbedding(e) {
    if (!this.pipeline)
      throw new Error("Pipeline not initialized");
    try {
      const t = await this.pipeline(e, {
        pooling: "mean",
        normalize: !0
      });
      return this.extractEmbedding(t);
    } catch (t) {
      throw new Error(`Failed to generate embedding: ${t.message}`);
    }
  }
  /**
   * Extract Float32Array from pipeline output
   */
  extractEmbedding(e) {
    if (e instanceof Float32Array)
      return e;
    if (e.data && e.data instanceof Float32Array)
      return e.data;
    if (Array.isArray(e.data))
      return new Float32Array(e.data);
    if (e.tolist) {
      const t = e.tolist();
      return Array.isArray(t) && Array.isArray(t[0]) ? new Float32Array(t[0]) : new Float32Array(t);
    }
    throw new Error("Unexpected output format from embedding pipeline");
  }
  /**
   * Ensure the generator is initialized
   */
  ensureInitialized() {
    if (!this.initialized)
      throw new Error("Embedding generator not initialized. Call initialize() first.");
  }
  /**
   * Sleep utility for retry logic
   */
  sleep(e) {
    return new Promise((t) => setTimeout(t, e));
  }
}
class K {
  constructor(e) {
    this.currentSize = 0, this.cache = /* @__PURE__ */ new Map(), this.accessOrder = [], this.config = {
      maxEntries: 1 / 0,
      onEvict: () => {
      },
      ...e
    };
  }
  /**
   * Get a value from the cache
   */
  get(e) {
    const t = this.cache.get(e);
    if (t)
      return this.updateAccessOrder(e), t.timestamp = Date.now(), t.value;
  }
  /**
   * Set a value in the cache
   */
  set(e, t, i) {
    const r = this.cache.get(e);
    if (r) {
      this.currentSize -= r.size, this.currentSize += i, r.value = t, r.size = i, r.timestamp = Date.now(), this.updateAccessOrder(e);
      return;
    }
    for (; (this.currentSize + i > this.config.maxSize || this.cache.size >= this.config.maxEntries) && this.cache.size > 0; )
      this.evictLRU();
    this.cache.set(e, {
      value: t,
      size: i,
      timestamp: Date.now()
    }), this.accessOrder.push(e), this.currentSize += i;
  }
  /**
   * Check if a key exists in the cache
   */
  has(e) {
    return this.cache.has(e);
  }
  /**
   * Delete a specific entry
   */
  delete(e) {
    const t = this.cache.get(e);
    return t ? (this.cache.delete(e), this.currentSize -= t.size, this.accessOrder = this.accessOrder.filter((i) => i !== e), this.config.onEvict(e, t.value), !0) : !1;
  }
  /**
   * Clear all entries
   */
  clear() {
    for (const [e, t] of this.cache.entries())
      this.config.onEvict(e, t.value);
    this.cache.clear(), this.accessOrder = [], this.currentSize = 0;
  }
  /**
   * Get current cache size in bytes
   */
  size() {
    return this.currentSize;
  }
  /**
   * Get number of entries
   */
  count() {
    return this.cache.size;
  }
  /**
   * Get cache statistics
   */
  getStats() {
    return {
      size: this.currentSize,
      count: this.cache.size,
      maxSize: this.config.maxSize,
      maxEntries: this.config.maxEntries,
      utilizationPercent: this.currentSize / this.config.maxSize * 100
    };
  }
  /**
   * Evict the least recently used entry
   */
  evictLRU() {
    if (this.accessOrder.length === 0)
      return;
    const e = this.accessOrder.shift(), t = this.cache.get(e);
    t && (this.cache.delete(e), this.currentSize -= t.size, this.config.onEvict(e, t.value));
  }
  /**
   * Update access order for a key (move to end)
   */
  updateAccessOrder(e) {
    const t = this.accessOrder.indexOf(e);
    t > -1 && this.accessOrder.splice(t, 1), this.accessOrder.push(e);
  }
}
class ze {
  constructor(e) {
    this.checkIntervalId = null, this.memoryPressureCallbacks = [], this.config = {
      checkInterval: 3e4,
      // Check every 30 seconds by default
      ...e
    }, this.caches = /* @__PURE__ */ new Map();
  }
  /**
   * Register a cache for memory management
   */
  registerCache(e, t) {
    this.caches.set(e, t);
  }
  /**
   * Register a callback to be called when memory pressure is detected
   */
  onMemoryPressure(e) {
    this.memoryPressureCallbacks.push(e);
  }
  /**
   * Start monitoring memory usage
   */
  startMonitoring() {
    this.checkIntervalId === null && (this.checkIntervalId = window.setInterval(() => {
      this.checkMemory();
    }, this.config.checkInterval));
  }
  /**
   * Stop monitoring memory usage
   */
  stopMonitoring() {
    this.checkIntervalId !== null && (clearInterval(this.checkIntervalId), this.checkIntervalId = null);
  }
  /**
   * Check current memory usage and trigger eviction if needed
   */
  async checkMemory() {
    this.getMemoryStats().utilizationPercent >= this.config.evictionThreshold * 100 && await this.handleMemoryPressure();
  }
  /**
   * Get current memory statistics
   */
  getMemoryStats() {
    let e = 0;
    const t = {};
    for (const [n, s] of this.caches.entries()) {
      const a = s.getStats();
      t[n] = a, e += a.size;
    }
    const i = window.performance;
    let r = this.config.maxMemoryMB * 1024 * 1024;
    return i && i.memory && (r = i.memory.jsHeapSizeLimit, e = i.memory.usedJSHeapSize), {
      usedMemory: e,
      totalMemory: r,
      utilizationPercent: e / r * 100,
      cacheStats: t
    };
  }
  /**
   * Handle memory pressure by evicting cache entries
   */
  async handleMemoryPressure() {
    console.warn("Memory pressure detected, evicting cache entries...");
    for (const e of this.caches.values()) {
      const i = e.getStats().maxSize * 0.7;
      for (; e.size() > i && e.count() > 0; )
        break;
    }
    for (const e of this.memoryPressureCallbacks)
      try {
        await e();
      } catch (t) {
        console.error("Error in memory pressure callback:", t);
      }
  }
  /**
   * Force eviction across all caches
   */
  async forceEviction(e = 0.5) {
    const t = this.getMemoryStats(), i = t.totalMemory * e, r = t.usedMemory - i;
    if (!(r <= 0)) {
      for (const n of this.caches.values()) {
        const s = n.getStats(), a = s.size / t.usedMemory;
        s.size - r * a < s.size * 0.5 && n.clear();
      }
      for (const n of this.memoryPressureCallbacks)
        try {
          await n();
        } catch (s) {
          console.error("Error in memory pressure callback:", s);
        }
    }
  }
  /**
   * Clean up resources
   */
  dispose() {
    this.stopMonitoring(), this.caches.clear(), this.memoryPressureCallbacks = [];
  }
}
class Ie {
  constructor(e = {}) {
    this.workers = [], this.availableWorkers = [], this.taskQueue = [], this.workerTasks = /* @__PURE__ */ new Map(), this.config = {
      maxWorkers: navigator.hardwareConcurrency || 4,
      workerScript: "",
      ...e
    };
  }
  /**
   * Initialize the worker pool
   */
  async initialize(e) {
    this.config.workerScript = e;
    for (let t = 0; t < this.config.maxWorkers; t++)
      try {
        const i = new Worker(e, { type: "module" });
        this.workers.push(i), this.availableWorkers.push(i), i.onmessage = (r) => this.handleWorkerMessage(i, r), i.onerror = (r) => this.handleWorkerError(i, r);
      } catch (i) {
        console.warn(`Failed to create worker ${t}:`, i);
      }
    if (this.workers.length === 0)
      throw new Error("Failed to create any workers");
  }
  /**
   * Execute a task in the worker pool
   */
  async execute(e) {
    return new Promise((t, i) => {
      this.taskQueue.push({ task: e, resolve: t, reject: i }), this.processQueue();
    });
  }
  /**
   * Execute multiple tasks in parallel
   */
  async executeBatch(e) {
    return Promise.all(e.map((t) => this.execute(t)));
  }
  /**
   * Get the number of available workers
   */
  getAvailableWorkerCount() {
    return this.availableWorkers.length;
  }
  /**
   * Get the number of pending tasks
   */
  getPendingTaskCount() {
    return this.taskQueue.length;
  }
  /**
   * Terminate all workers and clean up
   */
  dispose() {
    for (const e of this.workers)
      e.terminate();
    this.workers = [], this.availableWorkers = [], this.taskQueue = [], this.workerTasks.clear();
  }
  /**
   * Process the task queue
   */
  processQueue() {
    for (; this.taskQueue.length > 0 && this.availableWorkers.length > 0; ) {
      const { task: e, resolve: t, reject: i } = this.taskQueue.shift(), r = this.availableWorkers.shift();
      this.workerTasks.set(r, { resolve: t, reject: i }), e.transferables ? r.postMessage(e, e.transferables) : r.postMessage(e);
    }
  }
  /**
   * Handle message from worker
   */
  handleWorkerMessage(e, t) {
    const i = this.workerTasks.get(e);
    if (!i) {
      console.warn("Received message from worker with no associated task");
      return;
    }
    const r = t.data;
    this.workerTasks.delete(e), this.availableWorkers.push(e), r.success ? i.resolve(r.result) : i.reject(new Error(r.error || "Worker task failed")), this.processQueue();
  }
  /**
   * Handle worker error
   */
  handleWorkerError(e, t) {
    const i = this.workerTasks.get(e);
    i && (this.workerTasks.delete(e), i.reject(new Error(`Worker error: ${t.message}`))), this.availableWorkers.includes(e) || this.availableWorkers.push(e), this.processQueue();
  }
}
class Ee {
  constructor(e) {
    this.config = e;
  }
  /**
   * Load all vectors from storage in chunks
   */
  async *loadVectorsInChunks(e) {
    const t = await e.count();
    let i = 0;
    const r = e.db;
    if (!r)
      throw new Error("Storage not initialized");
    const a = r.transaction(["vectors"], "readonly").objectStore("vectors").openCursor();
    let o = [];
    await new Promise((c, d) => {
      a.onsuccess = async (h) => {
        const u = h.target.result;
        if (u) {
          const f = u.value, p = {
            id: f.id,
            vector: new Float32Array(f.vector),
            metadata: f.metadata,
            timestamp: f.timestamp
          };
          o.push(p), i++, o.length >= this.config.chunkSize && (this.config.onProgress && this.config.onProgress(i, t), o = []), u.continue();
        } else
          o.length > 0 && this.config.onProgress && this.config.onProgress(i, t), c();
      }, a.onerror = () => d(a.error);
    });
  }
  /**
   * Load vectors with progress tracking
   */
  async loadWithProgress(e, t) {
    const i = await e.count(), r = [];
    let n = 0;
    for await (const s of this.loadVectorsInChunks(e))
      r.push(...s), n += s.length, t({
        loaded: n,
        total: i,
        percent: n / i * 100
      }), this.config.onChunk && await this.config.onChunk(s);
    return r;
  }
  /**
   * Stream process vectors without loading all into memory
   */
  async streamProcess(e, t) {
    const i = e.db;
    if (!i)
      throw new Error("Storage not initialized");
    const s = i.transaction(["vectors"], "readonly").objectStore("vectors").openCursor();
    await new Promise((a, o) => {
      s.onsuccess = async (c) => {
        const d = c.target.result;
        if (d) {
          const h = d.value, u = {
            id: h.id,
            vector: new Float32Array(h.vector),
            metadata: h.metadata,
            timestamp: h.timestamp
          };
          try {
            await t(u);
          } catch (f) {
            o(f);
            return;
          }
          d.continue();
        } else
          a();
      }, s.onerror = () => o(s.error);
    });
  }
  /**
   * Export data in chunks to avoid memory issues
   */
  async *exportInChunks(e) {
    const t = e.db;
    if (!t)
      throw new Error("Storage not initialized");
    const n = t.transaction(["vectors"], "readonly").objectStore("vectors").openCursor();
    let s = [];
    await new Promise((a, o) => {
      n.onsuccess = (c) => {
        const d = c.target.result;
        if (d) {
          const h = d.value;
          s.push({
            id: h.id,
            vector: Array.from(new Float32Array(h.vector)),
            metadata: h.metadata,
            timestamp: h.timestamp
          }), s.length >= this.config.chunkSize && (s = []), d.continue();
        } else
          a();
      }, n.onerror = () => o(n.error);
    });
  }
  /**
   * Import data in batches with progress tracking
   */
  async importInBatches(e, t, i) {
    const r = t.length;
    let n = 0;
    for (let s = 0; s < t.length; s += this.config.chunkSize) {
      const a = t.slice(s, s + this.config.chunkSize);
      await e.putBatch(a), n += a.length, i && i(n, r);
    }
  }
}
class ke {
  constructor(e, t) {
    this.pendingOps = [], this.flushTimer = null, this.storage = e, this.config = {
      autoFlush: !0,
      ...t
    };
  }
  /**
   * Queue a put operation
   */
  async put(e) {
    return new Promise((t, i) => {
      this.pendingOps.push({
        type: "put",
        data: e,
        resolve: t,
        reject: i
      }), this.scheduleFlush();
    });
  }
  /**
   * Queue a delete operation
   */
  async delete(e) {
    return new Promise((t, i) => {
      this.pendingOps.push({
        type: "delete",
        data: e,
        resolve: t,
        reject: i
      }), this.scheduleFlush();
    });
  }
  /**
   * Manually flush all pending operations
   */
  async flush() {
    if (this.flushTimer !== null && (clearTimeout(this.flushTimer), this.flushTimer = null), this.pendingOps.length === 0)
      return;
    const e = [...this.pendingOps];
    this.pendingOps = [];
    try {
      const t = e.filter((r) => r.type === "put"), i = e.filter((r) => r.type === "delete");
      if (t.length > 0) {
        const r = t.map((n) => n.data);
        try {
          await this.storage.putBatch(r), t.forEach((n) => n.resolve(void 0));
        } catch (n) {
          t.forEach((s) => s.reject(n));
        }
      }
      for (const r of i)
        try {
          const n = await this.storage.delete(r.data);
          r.resolve(n);
        } catch (n) {
          r.reject(n);
        }
    } catch (t) {
      e.forEach((i) => i.reject(t));
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
    this.flushTimer !== null && (clearTimeout(this.flushTimer), this.flushTimer = null);
    const e = new Error("Batch operations cleared");
    this.pendingOps.forEach((t) => t.reject(e)), this.pendingOps = [];
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
    if (this.pendingOps.length >= this.config.maxBatchSize) {
      this.flush();
      return;
    }
    this.config.autoFlush && this.flushTimer === null && (this.flushTimer = window.setTimeout(() => {
      this.flush();
    }, this.config.maxWaitTime));
  }
}
class oe {
  constructor(e = {}) {
    this.workerPool = null, this.batchOptimizer = null, this.initialized = !1, this.indexLoaded = !1, this.modelsLoaded = !1, this.config = {
      maxMemoryMB: 500,
      evictionThreshold: 0.9,
      vectorCacheSize: 100 * 1024 * 1024,
      // 100MB
      embeddingCacheSize: 50 * 1024 * 1024,
      // 50MB
      indexCacheSize: 100 * 1024 * 1024,
      // 100MB
      enableWorkers: !0,
      maxWorkers: navigator.hardwareConcurrency || 4,
      batchSize: 100,
      batchWaitTime: 100,
      chunkSize: 1e3,
      lazyLoadIndex: !0,
      lazyLoadModels: !0,
      ...e
    }, this.vectorCache = new K({
      maxSize: this.config.vectorCacheSize,
      maxEntries: 1e4,
      onEvict: (t) => {
        console.debug(`Evicted vector from cache: ${t}`);
      }
    }), this.embeddingCache = new K({
      maxSize: this.config.embeddingCacheSize,
      maxEntries: 5e3,
      onEvict: (t) => {
        console.debug(`Evicted embedding from cache: ${t}`);
      }
    }), this.indexCache = new K({
      maxSize: this.config.indexCacheSize,
      maxEntries: 100,
      onEvict: (t) => {
        console.debug(`Evicted index data from cache: ${t}`);
      }
    }), this.memoryManager = new ze({
      maxMemoryMB: this.config.maxMemoryMB,
      evictionThreshold: this.config.evictionThreshold,
      checkInterval: 3e4
    }), this.memoryManager.registerCache("vectors", this.vectorCache), this.memoryManager.registerCache("embeddings", this.embeddingCache), this.memoryManager.registerCache("index", this.indexCache), this.progressiveLoader = new Ee({
      chunkSize: this.config.chunkSize
    }), this.config.enableWorkers && (this.workerPool = new Ie({
      maxWorkers: this.config.maxWorkers
    }));
  }
  /**
   * Initialize the performance optimizer
   */
  async initialize(e) {
    this.initialized || (e && (this.batchOptimizer = new ke(e, {
      maxBatchSize: this.config.batchSize,
      maxWaitTime: this.config.batchWaitTime,
      autoFlush: !0
    })), this.memoryManager.startMonitoring(), this.initialized = !0);
  }
  /**
   * Get a vector from cache or storage
   */
  async getVector(e, t) {
    const i = this.vectorCache.get(e);
    if (i)
      return i;
    const r = await t.get(e);
    if (r) {
      const n = this.estimateVectorSize(r);
      this.vectorCache.set(e, r, n);
    }
    return r;
  }
  /**
   * Get multiple vectors with caching
   */
  async getVectorBatch(e, t) {
    const i = [], r = [];
    for (const n of e) {
      const s = this.vectorCache.get(n);
      s ? i.push(s) : r.push(n);
    }
    if (r.length > 0) {
      const n = await t.getBatch(r);
      for (const s of n) {
        i.push(s);
        const a = this.estimateVectorSize(s);
        this.vectorCache.set(s.id, s, a);
      }
    }
    return i;
  }
  /**
   * Cache an embedding
   */
  cacheEmbedding(e, t) {
    const i = t.byteLength;
    this.embeddingCache.set(e, t, i);
  }
  /**
   * Get a cached embedding
   */
  getCachedEmbedding(e) {
    return this.embeddingCache.get(e);
  }
  /**
   * Cache index data
   */
  cacheIndex(e, t) {
    const i = this.estimateObjectSize(t);
    this.indexCache.set(e, t, i);
  }
  /**
   * Get cached index data
   */
  getCachedIndex(e) {
    return this.indexCache.get(e);
  }
  /**
   * Mark index as loaded (for lazy loading)
   */
  markIndexLoaded() {
    this.indexLoaded = !0;
  }
  /**
   * Check if index is loaded
   */
  isIndexLoaded() {
    return this.indexLoaded || !this.config.lazyLoadIndex;
  }
  /**
   * Mark models as loaded (for lazy loading)
   */
  markModelsLoaded() {
    this.modelsLoaded = !0;
  }
  /**
   * Check if models are loaded
   */
  areModelsLoaded() {
    return this.modelsLoaded || !this.config.lazyLoadModels;
  }
  /**
   * Get performance statistics
   */
  getStats() {
    const e = {
      memory: this.memoryManager.getMemoryStats(),
      caches: {
        vectors: this.vectorCache.getStats(),
        embeddings: this.embeddingCache.getStats(),
        index: this.indexCache.getStats()
      }
    };
    return this.workerPool && (e.workers = {
      available: this.workerPool.getAvailableWorkerCount(),
      pending: this.workerPool.getPendingTaskCount()
    }), this.batchOptimizer && (e.batch = {
      pending: this.batchOptimizer.getPendingCount()
    }), e;
  }
  /**
   * Clear all caches
   */
  clearCaches() {
    this.vectorCache.clear(), this.embeddingCache.clear(), this.indexCache.clear();
  }
  /**
   * Dispose of all resources
   */
  async dispose() {
    this.memoryManager.stopMonitoring(), this.clearCaches(), this.workerPool && this.workerPool.dispose(), this.batchOptimizer && (await this.batchOptimizer.flush(), this.batchOptimizer.dispose()), this.initialized = !1, this.indexLoaded = !1, this.modelsLoaded = !1;
  }
  /**
   * Estimate the size of a vector record in bytes
   */
  estimateVectorSize(e) {
    const t = e.vector.byteLength, i = this.estimateObjectSize(e.metadata);
    return t + i + 100;
  }
  /**
   * Estimate the size of an object in bytes
   */
  estimateObjectSize(e) {
    return JSON.stringify(e).length * 2;
  }
}
class ee {
  constructor(e) {
    this.initialized = !1, this.storage = null, this.injectedIndex = null, this.embeddingGenerator = null, Se(e) ? (this.injected = e, this.config = null, this.dimensions = e.dimensions, this.performanceOptimizer = new oe(e.performance), this.embeddingGenerator = e.embedding ?? null, this.injectedIndex = e.index) : (this.validateConfig(e), this.config = e, this.injected = null, this.dimensions = e.index.dimensions, this.performanceOptimizer = new oe(e.performance));
  }
  /**
   * Initialize all components: storage, index, and embedding generator
   */
  async initialize() {
    if (!this.initialized)
      try {
        this.injected ? await this.initializeInjected() : await this.initializeDeclarative(), this.initialized = !0;
      } catch (e) {
        throw await this.cleanup(), new m(
          "Failed to initialize VectorDB",
          "INIT_ERROR",
          { error: e }
        );
      }
  }
  /**
   * Initialize from injected adapters (the seam path).
   */
  async initializeInjected() {
    const e = this.injected;
    if ("initialize" in e.storage && await e.storage.initialize?.(), this.storage = e.storage, await this.performanceOptimizer.initialize(this.storage), await e.index.initialize(), this.injectedIndex = e.index, this.performanceOptimizer.markIndexLoaded(), e.embedding && (this.embeddingGenerator = e.embedding, this.embeddingGenerator && this.performanceOptimizer), this.embeddingGenerator && this.performanceOptimizer.areModelsLoaded?.()) {
      const t = this.embeddingGenerator.getDimensions();
      if (t !== this.dimensions)
        throw new E(this.dimensions, t);
    }
  }
  /**
   * Initialize from declarative config (back-compat path; wires concrete adapters internally).
   */
  async initializeDeclarative() {
    const e = this.config, t = new ue(e.storage);
    if (await t.initialize(), this.storage = t, await this.performanceOptimizer.initialize(this.storage), this.injectedIndex = new Q({
      dimensions: e.index.dimensions,
      metric: e.index.metric
    }), await this.injectedIndex.initialize(), this.performanceOptimizer.markIndexLoaded(), e.performance?.lazyLoadModels ? (console.debug("Model lazy loading enabled"), this.embeddingGenerator = new Y({
      model: e.embedding.model,
      device: e.embedding.device,
      cache: e.embedding.cache ?? !0
    })) : (this.embeddingGenerator = new Y({
      model: e.embedding.model,
      device: e.embedding.device,
      cache: e.embedding.cache ?? !0
    }), await this.embeddingGenerator.initialize(), this.performanceOptimizer.markModelsLoaded()), this.performanceOptimizer.areModelsLoaded()) {
      const i = this.embeddingGenerator.getDimensions();
      if (i !== e.index.dimensions)
        throw new E(
          e.index.dimensions,
          i
        );
    }
  }
  /**
   * Insert a single document with automatic embedding generation
   * 
   * @param data - Document data with optional vector, text, or metadata
   * @returns Document ID
   */
  async insert(e) {
    this.ensureInitialized();
    try {
      const t = T.validateAndSanitizeMetadata(e.metadata), i = await this.prepareVector(e), r = this.generateId(), n = {
        id: r,
        vector: i,
        metadata: {
          ...t,
          content: e.text,
          timestamp: Date.now()
        },
        timestamp: Date.now()
      };
      this.performanceOptimizer.batchOptimizer ? await this.performanceOptimizer.batchOptimizer.put(n) : await this.storage.put(n);
      const s = n.vector.byteLength + JSON.stringify(n.metadata).length * 2 + 100;
      return this.performanceOptimizer.vectorCache.set(r, n, s), await this.idxAdd(n), r;
    } catch (t) {
      throw t instanceof m ? t : new m(
        "Failed to insert document",
        "INSERT_ERROR",
        { error: t, data: e }
      );
    }
  }
  /**
   * Insert multiple documents in batch for better performance
   * 
   * @param data - Array of document data
   * @returns Array of document IDs
   */
  async insertBatch(e) {
    if (this.ensureInitialized(), e.length === 0)
      return [];
    try {
      const t = [], i = [];
      for (const r of e) {
        const n = T.validateAndSanitizeMetadata(r.metadata), s = await this.prepareVector(r), a = this.generateId(), o = {
          id: a,
          vector: s,
          metadata: {
            ...n,
            content: r.text,
            timestamp: Date.now()
          },
          timestamp: Date.now()
        };
        t.push(o), i.push(a);
        const c = o.vector.byteLength + JSON.stringify(o.metadata).length * 2 + 100;
        this.performanceOptimizer.vectorCache.set(a, o, c);
      }
      return await this.storage.putBatch(t), await this.idxAddBatch(t), i;
    } catch (t) {
      throw t instanceof m ? t : new m(
        "Failed to insert document batch",
        "INSERT_BATCH_ERROR",
        { error: t, count: e.length }
      );
    }
  }
  /**
   * Search for similar vectors using text query or vector
   * 
   * @param query - Search query with text or vector
   * @returns Array of search results with scores and metadata
   */
  async search(e) {
    this.ensureInitialized();
    try {
      T.validateSearchQuery(e.k);
      let t;
      if (e.vector)
        t = e.vector;
      else if (e.text) {
        const r = this.performanceOptimizer.getCachedEmbedding(e.text);
        r ? t = r : (await this.ensureModelsLoaded(), t = await this.embeddingGenerator.embed(e.text), this.performanceOptimizer.cacheEmbedding(e.text, t));
      } else
        throw new m(
          "Search query must include either vector or text",
          "INVALID_QUERY",
          { query: e }
        );
      T.validateVector(t, this.dimensions);
      const i = await this.idxSearch(
        t,
        e.k,
        e.filter
      );
      if (e.includeVectors)
        for (const r of i) {
          const n = await this.performanceOptimizer.getVector(r.id, this.storage);
          n && (r.vector = n.vector);
        }
      return i;
    } catch (t) {
      throw t instanceof m ? t : new m(
        "Failed to search vectors",
        "SEARCH_ERROR",
        { error: t, query: e }
      );
    }
  }
  /**
   * Delete a document by ID
   * 
   * @param id - Document ID
   * @returns True if deleted, false if not found
   */
  async delete(e) {
    this.ensureInitialized();
    try {
      let t;
      return this.performanceOptimizer.batchOptimizer ? t = await this.performanceOptimizer.batchOptimizer.delete(e) : t = await this.storage.delete(e), t && (this.performanceOptimizer.vectorCache.delete(e), await this.idxRemove(e)), t;
    } catch (t) {
      throw new m(
        "Failed to delete document",
        "DELETE_ERROR",
        { error: t, id: e }
      );
    }
  }
  /**
   * Update a document's metadata or vector
   * 
   * @param id - Document ID
   * @param data - Partial document data to update
   * @returns True if updated, false if not found
   */
  async update(e, t) {
    this.ensureInitialized();
    try {
      const i = await this.storage.get(e);
      if (!i)
        return !1;
      const r = t.metadata ? T.validateAndSanitizeMetadata(t.metadata) : {};
      let n = i.vector;
      (t.vector || t.text) && (n = await this.prepareVector(t));
      const s = {
        id: e,
        vector: n,
        metadata: {
          ...i.metadata,
          ...r,
          content: t.text ?? i.metadata.content,
          timestamp: Date.now()
        },
        timestamp: Date.now()
      };
      return await this.storage.put(s), await this.idxRemove(e), await this.idxAdd(s), !0;
    } catch (i) {
      throw i instanceof m ? i : new m(
        "Failed to update document",
        "UPDATE_ERROR",
        { error: i, id: e }
      );
    }
  }
  /**
   * Clear all documents from the database
   */
  async clear() {
    this.ensureInitialized();
    try {
      this.performanceOptimizer.batchOptimizer && await this.performanceOptimizer.batchOptimizer.flush(), await this.storage.clear(), await this.idxClear(), this.performanceOptimizer.clearCaches();
    } catch (e) {
      throw new m(
        "Failed to clear database",
        "CLEAR_ERROR",
        { error: e }
      );
    }
  }
  /**
   * Get the total number of documents in the database
   * 
   * @returns Document count
   */
  async size() {
    this.ensureInitialized();
    try {
      return await this.storage.count();
    } catch (e) {
      throw new m(
        "Failed to get database size",
        "SIZE_ERROR",
        { error: e }
      );
    }
  }
  /**
   * Export the entire database to a portable format
   * Uses progressive loading to handle large datasets
   * 
   * @param options - Export options including progress callbacks
   * @returns Export data including vectors, index, and metadata
   */
  async export(e = {}) {
    this.ensureInitialized();
    const {
      includeIndex: t = !0,
      onProgress: i
    } = e;
    try {
      this.performanceOptimizer.batchOptimizer && await this.performanceOptimizer.batchOptimizer.flush();
      const r = await this.storage.count(), n = [];
      let s = 0;
      await this.performanceOptimizer.progressiveLoader.streamProcess(
        this.storage,
        async (d) => {
          n.push(d), s++, i && s % 100 === 0 && i(s, r);
        }
      ), i && i(r, r);
      let a = "";
      t && (a = await this.idxSerialize());
      const o = this.config;
      return {
        version: "1.0.0",
        config: {
          ...o,
          // Don't export sensitive or runtime-specific config
          storage: {
            dbName: o.storage.dbName,
            version: o.storage.version
          }
        },
        vectors: n.map((d) => ({
          id: d.id,
          vector: Array.from(d.vector),
          metadata: d.metadata,
          timestamp: d.timestamp
        })),
        index: a,
        metadata: {
          exportedAt: Date.now(),
          vectorCount: r,
          dimensions: this.dimensions
        }
      };
    } catch (r) {
      throw new m(
        "Failed to export database",
        "EXPORT_ERROR",
        { error: r }
      );
    }
  }
  /**
   * Fallback async iteration for storage backends that don't implement
   * `stream()`. Bridges the callback-based `ProgressiveLoader.streamProcess`
   * into an async iterator so `exportStream` can yield incrementally on any
   * storage: each record is handed to a pending `next()` via a promise.
   */
  async *iterateAllViaProgressiveLoader() {
    let e = null, t = null;
    const i = (r) => {
      if (e) {
        const n = e;
        e = null, n(r);
      }
    };
    for (this.performanceOptimizer.progressiveLoader.streamProcess(this.storage, async (r) => {
      i({ value: r, done: !1 });
    }).then(() => {
      i({ value: void 0, done: !0 });
    }).catch((r) => {
      t = r, i({ value: void 0, done: !0 });
    }); ; ) {
      const r = await new Promise((n) => {
        e = n;
      });
      if (r.done) {
        if (t) throw t;
        return;
      }
      yield r.value;
    }
  }
  /**
   * Export database as a streaming generator for very large datasets
   * This prevents loading all data into memory at once
   *
   * @param options - Export options
   * @returns Async generator yielding export chunks
   */
  async *exportStream(e = {}) {
    this.ensureInitialized();
    const {
      includeIndex: t = !0,
      onProgress: i
    } = e;
    try {
      this.performanceOptimizer.batchOptimizer && await this.performanceOptimizer.batchOptimizer.flush();
      const r = await this.storage.count();
      yield {
        type: "metadata",
        data: {
          version: "1.0.0",
          config: {
            ...this.config,
            storage: {
              dbName: this.config.storage.dbName,
              version: this.config.storage.version
            }
          },
          metadata: {
            exportedAt: Date.now(),
            vectorCount: r,
            dimensions: this.dimensions
          }
        }
      };
      const n = this.config.performance?.chunkSize || 100, a = typeof this.storage.stream == "function" ? this.storage.stream() : this.iterateAllViaProgressiveLoader();
      let o = 0, c = [];
      for await (const d of a)
        c.push({
          id: d.id,
          vector: Array.from(d.vector),
          metadata: d.metadata,
          timestamp: d.timestamp
        }), o++, c.length >= n && (yield { type: "vectors", data: c }, c = [], i && i(o, r));
      c.length > 0 && (yield {
        type: "vectors",
        data: c
      }), i && i(r, r), t && (yield {
        type: "index",
        data: await this.idxSerialize()
      });
    } catch (r) {
      throw new m(
        "Failed to export database stream",
        "EXPORT_STREAM_ERROR",
        { error: r }
      );
    }
  }
  /**
   * Import database from exported data
   * Uses progressive loading for large datasets
   * 
   * @param data - Export data to import
   * @param options - Import options including validation and progress callbacks
   */
  async import(e, t = {}) {
    this.ensureInitialized();
    const {
      validateSchema: i = !0,
      onProgress: r,
      clearExisting: n = !0
    } = t;
    try {
      if (i && this.validateExportData(e), this.validateVersionCompatibility(e.version), e.metadata.dimensions !== this.dimensions)
        throw new E(
          this.dimensions,
          e.metadata.dimensions
        );
      if (e.vectors.length !== e.metadata.vectorCount)
        throw new m(
          "Vector count mismatch in export data",
          "INVALID_EXPORT_DATA",
          {
            expected: e.metadata.vectorCount,
            actual: e.vectors.length
          }
        );
      n && await this.clear();
      const s = [];
      for (let a = 0; a < e.vectors.length; a++) {
        const o = e.vectors[a];
        if (!o.id || !o.vector || !o.metadata)
          throw new m(
            "Invalid vector record in export data",
            "INVALID_VECTOR_RECORD",
            { index: a, record: o }
          );
        if (o.vector.length !== this.dimensions)
          throw new E(
            this.dimensions,
            o.vector.length
          );
        s.push({
          id: o.id,
          vector: new Float32Array(o.vector),
          metadata: o.metadata,
          timestamp: o.timestamp || Date.now()
        });
      }
      if (await this.performanceOptimizer.progressiveLoader.importInBatches(
        this.storage,
        s,
        (a, o) => {
          r && r(a, o);
        }
      ), e.index)
        try {
          await this.idxDeserialize(e.index);
        } catch (a) {
          console.warn("Failed to deserialize index, rebuilding from vectors...", a), await this.rebuildIndex();
        }
      else
        await this.rebuildIndex();
      r && r(s.length, s.length);
    } catch (s) {
      throw s instanceof m ? s : new m(
        "Failed to import database",
        "IMPORT_ERROR",
        { error: s }
      );
    }
  }
  /**
   * Validate export data schema
   */
  validateExportData(e) {
    if (!e.version)
      throw new m(
        "Export data missing version",
        "INVALID_EXPORT_DATA",
        { data: e }
      );
    if (!e.vectors || !Array.isArray(e.vectors))
      throw new m(
        "Export data missing or invalid vectors array",
        "INVALID_EXPORT_DATA",
        { data: e }
      );
    if (!e.metadata)
      throw new m(
        "Export data missing metadata",
        "INVALID_EXPORT_DATA",
        { data: e }
      );
    if (typeof e.metadata.dimensions != "number" || e.metadata.dimensions <= 0)
      throw new m(
        "Export data has invalid dimensions",
        "INVALID_EXPORT_DATA",
        { dimensions: e.metadata.dimensions }
      );
    if (typeof e.metadata.vectorCount != "number" || e.metadata.vectorCount < 0)
      throw new m(
        "Export data has invalid vector count",
        "INVALID_EXPORT_DATA",
        { vectorCount: e.metadata.vectorCount }
      );
  }
  /**
   * Validate version compatibility
   */
  validateVersionCompatibility(e) {
    const t = e.split(".");
    if (t.length < 2)
      throw new m(
        "Invalid version format",
        "INVALID_VERSION",
        { version: e }
      );
    const i = parseInt(t[0], 10), r = parseInt(t[1], 10), n = 1, s = 0;
    if (i !== n)
      throw new m(
        "Incompatible export data version (major version mismatch)",
        "VERSION_INCOMPATIBLE",
        {
          exportVersion: e,
          currentVersion: "1.0.0",
          message: "Major version mismatch. Data may not be compatible."
        }
      );
    r > s && console.warn(
      `Export data is from a newer version (${e}). Some features may not be supported.`
    );
  }
  /**
   * Rebuild index from stored vectors
   */
  async rebuildIndex() {
    const e = await this.storage.getAll();
    await this.idxClear(), e.length > 0 && await this.idxAddBatch(e);
  }
  /**
   * Clean up resources and close connections
   */
  async dispose() {
    await this.cleanup(), await this.performanceOptimizer.dispose(), this.initialized = !1;
  }
  /**
   * Get performance statistics
   */
  getPerformanceStats() {
    return this.performanceOptimizer.getStats();
  }
  /**
   * Clear all performance caches
   */
  clearCaches() {
    this.performanceOptimizer.clearCaches();
  }
  /**
   * Prepare vector from insert data (generate from text or validate provided vector)
   */
  async prepareVector(e) {
    if (e.vector)
      return T.validateVector(e.vector, this.dimensions), e.vector;
    if (e.text) {
      const t = this.performanceOptimizer.getCachedEmbedding(e.text);
      if (t)
        return t;
      await this.ensureModelsLoaded();
      const i = await this.embeddingGenerator.embed(e.text);
      return T.validateVector(i, this.dimensions), this.performanceOptimizer.cacheEmbedding(e.text, i), i;
    } else
      throw new m(
        "Insert data must include either vector or text",
        "INVALID_INSERT_DATA",
        { data: e }
      );
  }
  /**
   * Ensure models are loaded (for lazy loading)
   */
  async ensureModelsLoaded() {
    if (!this.performanceOptimizer.areModelsLoaded()) {
      await this.embeddingGenerator.initialize(), this.performanceOptimizer.markModelsLoaded();
      const e = this.embeddingGenerator.getDimensions();
      if (e !== this.dimensions)
        throw new E(
          this.dimensions,
          e
        );
    }
  }
  /**
   * Generate a unique ID for a document
   */
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }
  // ---------------------------------------------------------------------
  // Index dispatch helpers.
  //
  // The facade talks to the index through these helpers. The index always
  // implements the Index contract (HnswIndex, whether injected by the
  // factory or wired by the declarative path). IndexHit[] carries id +
  // score only, so metadata is hydrated from storage.
  // ---------------------------------------------------------------------
  async idxAdd(e) {
    await this.injectedIndex.add(e);
  }
  async idxAddBatch(e) {
    await this.injectedIndex.addBatch(e);
  }
  async idxRemove(e) {
    await this.injectedIndex.remove(e);
  }
  async idxClear() {
    await this.injectedIndex.clear();
  }
  async idxSerialize() {
    const e = await this.injectedIndex.serialize();
    return JSON.stringify(e);
  }
  async idxDeserialize(e) {
    try {
      const t = JSON.parse(e);
      await this.injectedIndex.deserialize(t);
    } catch (t) {
      throw new m("Failed to deserialize index", "INDEX_DESERIALIZE_ERROR", { error: t });
    }
  }
  /**
   * Search the index and return results with metadata. IndexHit lacks
   * metadata, so each hit is hydrated from storage.
   */
  async idxSearch(e, t, i) {
    const r = await this.injectedIndex.search(e, t, i), n = [];
    for (const s of r) {
      const a = await this.storage.get(s.id);
      if (a && !(i && !this.recordMatchesFilter(a, i)) && (n.push({ id: s.id, score: s.score, metadata: a.metadata }), n.length >= t))
        break;
    }
    return n;
  }
  /** Metadata filter evaluation for the injected-index hydration path. */
  recordMatchesFilter(e, t) {
    const i = t;
    if (i.operator === "and" || i.operator === "or") {
      const n = i.filters;
      return !n || n.length === 0 ? !0 : i.operator === "and" ? n.every((s) => this.recordMatchesFilter(e, s)) : n.some((s) => this.recordMatchesFilter(e, s));
    }
    const r = this.getNested(e.metadata, i.field);
    if (r === void 0) return !1;
    switch (i.operator) {
      case "eq":
        return r === i.value;
      case "ne":
        return r !== i.value;
      case "gt":
        return r > i.value;
      case "gte":
        return r >= i.value;
      case "lt":
        return r < i.value;
      case "lte":
        return r <= i.value;
      case "in":
        return Array.isArray(i.value) && i.value.includes(r);
      case "contains":
        return Array.isArray(r) || typeof r == "string" ? r.includes(i.value) : !1;
      default:
        return !1;
    }
  }
  getNested(e, t) {
    const i = t.split(".");
    let r = e;
    for (const n of i) {
      if (r == null) return;
      r = r[n];
    }
    return r;
  }
  /**
   * Ensure the database is initialized
   */
  ensureInitialized() {
    if (!this.initialized)
      throw new m(
        "VectorDB not initialized. Call initialize() first.",
        "NOT_INITIALIZED"
      );
  }
  /**
   * Validate configuration
   */
  validateConfig(e) {
    if (!e.storage?.dbName)
      throw new m(
        "Storage configuration must include dbName",
        "INVALID_CONFIG",
        { config: e }
      );
    if (!e.index?.dimensions || e.index.dimensions <= 0)
      throw new m(
        "Index configuration must include valid dimensions",
        "INVALID_CONFIG",
        { config: e }
      );
    if (!e.embedding?.model)
      throw new m(
        "Embedding configuration must include model",
        "INVALID_CONFIG",
        { config: e }
      );
  }
  /**
   * Clean up all resources
   */
  async cleanup() {
    try {
      this.embeddingGenerator && (await this.embeddingGenerator.dispose(), this.embeddingGenerator = null), this.storage && "close" in this.storage && (await this.storage.close(), this.storage = null), this.injectedIndex = null;
    } catch (e) {
      console.error("Error during cleanup:", e);
    }
  }
}
function Se(l) {
  return !!l && typeof l.dimensions == "number" && typeof l.index == "object" && typeof l.index?.initialize == "function" && typeof l.storage?.put == "function";
}
let W = null;
async function ie(l = !1) {
  if (W && !l) return W;
  const e = typeof WebAssembly == "object";
  let t = !1;
  try {
    e && (new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 0, 11])), t = !0);
  } catch {
    t = !1;
  }
  const i = typeof SharedArrayBuffer < "u", r = typeof indexedDB < "u";
  let n = !1, s;
  try {
    const c = navigator.gpu;
    if (c) {
      const d = await c.requestAdapter();
      if (d) {
        n = !0;
        try {
          s = (await d.requestAdapterInfo?.())?.maxTextureSize;
        } catch {
        }
      }
    }
  } catch {
    n = !1;
  }
  const a = navigator.deviceMemory, o = Re(n, a);
  return W = { webgpu: n, wasm: e, simd: t, sharedArrayBuffer: i, indexedDB: r, deviceMemoryGB: a, maxTextureSize: s, deviceTier: o }, W;
}
function Re(l, e) {
  return l ? e === void 0 ? "mid" : e <= 4 ? "low" : e <= 8 ? "mid" : "high" : "low";
}
const Me = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  detectCapabilities: ie
}, Symbol.toStringTag, { value: "Module" })), Te = [
  { id: "Xenova/all-MiniLM-L6-v2", dimensions: 384, sizeMB: 25, minTier: "low", devices: ["wasm", "webgpu"] },
  { id: "Xenova/ms-marco-MiniLM-L-6-v2", dimensions: 384, sizeMB: 90, minTier: "low", devices: ["wasm", "webgpu"] },
  { id: "Xenova/bge-small-en-v1.5", dimensions: 384, sizeMB: 130, minTier: "low", devices: ["wasm", "webgpu"] },
  { id: "Xenova/bge-base-en-v1.5", dimensions: 768, sizeMB: 220, minTier: "mid", devices: ["wasm", "webgpu"] },
  { id: "Xenova/bge-large-en-v1.5", dimensions: 1024, sizeMB: 420, minTier: "high", devices: ["wasm", "webgpu"] },
  { id: "Xenova/e5-base-v2", dimensions: 768, sizeMB: 280, minTier: "mid", devices: ["wasm", "webgpu"] }
], Ae = [
  { id: "Llama-3.2-1B-Instruct-q4f32_1-MLC", provider: "webllm", sizeGB: 1, minTier: "low", needsWebGPU: !0 },
  { id: "Llama-3.2-3B-Instruct-q4f32_1-MLC", provider: "webllm", sizeGB: 2.4, minTier: "mid", needsWebGPU: !0 },
  { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", provider: "webllm", sizeGB: 1.3, minTier: "low", needsWebGPU: !0 },
  { id: "Qwen2.5-7B-Instruct-q4f16_1-MLC", provider: "webllm", sizeGB: 4.8, minTier: "high", needsWebGPU: !0 },
  { id: "Hermes-2-Theta-Llama-3-8B-q4f16_1-MLC", provider: "webllm", sizeGB: 5, minTier: "high", needsWebGPU: !0 },
  // wllama (WASM) models — no WebGPU required, but RAM-bound; keep them small.
  { id: "Llama-3.2-3B-Instruct", provider: "wllama", sizeGB: 2, minTier: "low", needsWebGPU: !1 },
  { id: "Llama-3.2-1B-Instruct", provider: "wllama", sizeGB: 0.8, minTier: "low", needsWebGPU: !1 },
  { id: "Qwen2.5-3B-Instruct", provider: "wllama", sizeGB: 1.9, minTier: "low", needsWebGPU: !1 }
], j = { low: 0, mid: 1, high: 2 };
class me {
  constructor() {
    this.embedding = /* @__PURE__ */ new Map(), this.llm = /* @__PURE__ */ new Map();
    for (const e of Te) this.embedding.set(e.id, e);
    for (const e of Ae) this.llm.set(e.id, e);
  }
  /** All known embedding models. */
  listEmbeddingModels() {
    return [...this.embedding.values()];
  }
  /** All known LLM models. */
  listLLMModels() {
    return [...this.llm.values()];
  }
  getEmbeddingModel(e) {
    return this.embedding.get(e);
  }
  getLLMModel(e) {
    return this.llm.get(e);
  }
  /**
   * Authoritative dimensions for a known embedding model. Returns undefined
   * for unknown ids — callers that need a guarantee should use
   * `validateDimensions` instead.
   */
  getEmbeddingDimensions(e) {
    return this.embedding.get(e)?.dimensions;
  }
  /**
   * Init-time gate: the embedding model's dimensions must match the index's.
   * Throws `DimensionMismatchError` on mismatch. For unknown models the check
   * is skipped (we can't vouch for dimensions we don't know) — but a known
   * model with a wrong index size is rejected hard, before any data is
   * inserted into an index that can never hold it.
   */
  validateDimensions(e, t) {
    const i = this.embedding.get(e);
    if (i && i.dimensions !== t)
      throw new E(t, i.dimensions);
  }
  /**
   * Pre-flight feasibility check for an embedding model, before any download.
   * Considers device tier and (for WebGPU-only devices) device memory.
   */
  canRunEmbeddingModel(e, t) {
    const i = this.embedding.get(e);
    if (!i)
      return { canRun: !0, reason: "" };
    if (!i.devices.includes(t.webgpu ? "webgpu" : "wasm"))
      return {
        canRun: !1,
        reason: `Model ${e} does not support the ${t.webgpu ? "webgpu" : "wasm"} device available here`,
        entry: i
      };
    const r = this.checkTier(e, i.minTier, t);
    return r ? { ...r, entry: i } : { canRun: !0, reason: "", entry: i };
  }
  /**
   * Pre-flight feasibility check for an LLM model, before a multi-GB
   * download. Rejects WebLLM models when WebGPU is absent, and rejects any
   * model whose min tier exceeds the device's — so a low-RAM phone fails
   * fast with a clear message instead of OOM-ing mid-download.
   */
  canRunLLMModel(e, t) {
    const i = this.llm.get(e);
    if (!i)
      return { canRun: !0, reason: "" };
    if (i.needsWebGPU && !t.webgpu)
      return {
        canRun: !1,
        reason: `Model ${e} requires WebGPU, which is unavailable on this device`,
        entry: i
      };
    const r = this.checkTier(e, i.minTier, t);
    if (r) return { ...r, entry: i };
    const n = this.checkMemory(e, i.sizeGB, t);
    return n ? { ...n, entry: i } : { canRun: !0, reason: "", entry: i };
  }
  /** Alias matching the TECHNICAL_VALIDATION naming. LLM-focused by default. */
  canRunModel(e, t) {
    return this.llm.has(e) ? this.canRunLLMModel(e, t) : this.canRunEmbeddingModel(e, t);
  }
  /**
   * Recommend an LLM for the current device class — the smallest model that
   * meets the device tier, preferring WebLLM (WebGPU) then wllama (WASM).
   */
  recommendLLM(e) {
    const t = e.deviceTier, i = this.listLLMModels().filter((r) => j[r.minTier] <= j[t]).filter((r) => !r.needsWebGPU || e.webgpu).sort((r, n) => r.sizeGB - n.sizeGB);
    return i.find((r) => r.provider === "webllm") ?? i[0];
  }
  checkTier(e, t, i) {
    return j[t] > j[i.deviceTier] ? {
      canRun: !1,
      reason: `Model ${e} requires a ${t}-tier device (this device is ${i.deviceTier})`
    } : null;
  }
  checkMemory(e, t, i) {
    return i.deviceMemoryGB === void 0 ? null : t > i.deviceMemoryGB ? {
      canRun: !1,
      reason: `Model ${e} is ~${t}GB but device reports only ${i.deviceMemoryGB}GB of memory`
    } : null;
  }
}
let J = null;
function fe() {
  return J || (J = new me()), J;
}
const Oe = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  ModelRegistry: me,
  getModelRegistry: fe
}, Symbol.toStringTag, { value: "Module" }));
async function tt(l) {
  const e = await ie(), t = l.forceEmbeddingDevice ?? (e.webgpu ? "webgpu" : "wasm"), i = fe();
  i.validateDimensions(l.embedding.model, l.dimensions);
  const r = i.canRunEmbeddingModel(l.embedding.model, e);
  if (!r.canRun)
    throw new Error(`Embedding model ${l.embedding.model} is not runnable here: ${r.reason}`);
  const n = new ue(l.storage);
  await n.initialize();
  const s = new Q({
    dimensions: l.dimensions,
    metric: l.metric ?? "cosine",
    m: l.hnsw?.m,
    efConstruction: l.hnsw?.efConstruction,
    efSearch: l.hnsw?.efSearch
  });
  await s.initialize();
  const a = new Y({
    model: l.embedding.model,
    device: t,
    cache: l.embedding.cache ?? !0
  }), o = {
    storage: n,
    index: s,
    embedding: a,
    performance: l.performance,
    dimensions: l.dimensions,
    metric: l.metric ?? "cosine"
  }, c = new ee(o);
  return await c.initialize(), c;
}
const Ce = [
  "huggingface.co",
  "cdn-lfs.huggingface.co",
  "cdn-lfs-us-1.huggingface.co",
  "cdn.jsdelivr.net",
  "esm.sh",
  "raw.githubusercontent.com"
];
class re extends Error {
  constructor(e) {
    super(`Residency violation: network egress to disallowed host '${e}'. Only model-weight hosts are permitted.`), this.host = e, this.name = "ResidencyViolationError", Object.setPrototypeOf(this, re.prototype);
  }
}
class it {
  constructor(e = {}) {
    this.installed = !1, this.allowed = new Set(e.allowedHosts ?? Ce), this.enabled = e.enabled ?? !Le();
  }
  isAllowed(e) {
    try {
      const { hostname: t } = new URL(e);
      return this.allowed.has(t);
    } catch {
      return !0;
    }
  }
  assert(e) {
    if (this.enabled && !this.isAllowed(e))
      throw new re(this.hostOf(e));
  }
  /**
   * Install fetch/XHR instrumentation. Call once in dev/test entrypoints.
   * No-op if disabled or already installed.
   */
  install() {
    if (!this.enabled || this.installed) return;
    this.installed = !0, this.originalFetch = globalThis.fetch;
    const e = this;
    globalThis.fetch = ((t, i) => {
      const r = typeof t == "string" ? t : t instanceof URL ? t.href : t.url;
      return e.assert(r), e.originalFetch(t, i);
    }), this.originalXHROpen = XMLHttpRequest.prototype.open, XMLHttpRequest.prototype.open = function(t, i, ...r) {
      return e.assert(i), e.originalXHROpen.call(this, t, i, ...r);
    };
  }
  /** Restore original fetch/XHR. */
  restore() {
    this.installed && (this.originalFetch && (globalThis.fetch = this.originalFetch), this.originalXHROpen && (XMLHttpRequest.prototype.open = this.originalXHROpen), this.installed = !1);
  }
  hostOf(e) {
    try {
      return new URL(e).hostname;
    } catch {
      return e;
    }
  }
}
function Le() {
  try {
    return import.meta?.env?.PROD === !0 || process?.env?.NODE_ENV === "production";
  } catch {
    return !1;
  }
}
function pe(l) {
  let e = l >>> 0;
  return () => {
    e |= 0, e = e + 1831565813 | 0;
    let t = Math.imul(e ^ e >>> 15, 1 | e);
    return t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t, ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function Pe(l) {
  let e = 0, t = 0;
  for (; e === 0; ) e = l();
  for (; t === 0; ) t = l();
  return Math.sqrt(-2 * Math.log(e)) * Math.cos(2 * Math.PI * t);
}
function De(l, e, t) {
  const i = pe(t), r = [];
  for (let n = 0; n < l; n++) {
    const s = new Float32Array(e);
    let a = 0;
    for (let o = 0; o < e; o++) {
      const c = Pe(i);
      s[o] = c, a += c * c;
    }
    a = Math.sqrt(a) || 1;
    for (let o = 0; o < e; o++) s[o] /= a;
    r.push(s);
  }
  return r;
}
function _e(l, e) {
  let t = 0;
  const i = Math.min(l.length, e.length);
  for (let r = 0; r < i; r++) t += l[r] * e[r];
  return t;
}
function Fe(l, e, t, i) {
  const r = [];
  for (let n = 0; n < l.length; n++)
    i.has(n) && r.push({ idx: n, s: _e(e, l[n]) });
  return r.sort((n, s) => s.s - n.s), r.slice(0, t).map((n) => n.idx);
}
function H(l, e) {
  if (l.length === 0) return 0;
  const t = Math.min(l.length - 1, Math.floor(e / 100 * l.length));
  return l[t];
}
function ce(l) {
  if (l.length === 0) return 0;
  const e = Math.floor(l.length / 2);
  return l.length % 2 ? l[e] : (l[e - 1] + l[e]) / 2;
}
async function Be(l, e, t, i, r) {
  const { queries: n, k: s, deleteFraction: a } = t, o = e.map((y, b) => `v${b}`), c = e.map((y, b) => ({
    id: o[b],
    vector: y,
    metadata: { idx: b },
    timestamp: b
  })), d = performance.now();
  await l.addBatch(c);
  const h = performance.now() - d, u = e.length / h * 1e3, f = pe(i.size + 7), p = [];
  for (let y = 0; y < n; y++) p.push(e[Math.floor(f() * e.length)].slice());
  const w = [], z = new Set(e.map((y, b) => b));
  let g = 0, I = 0, k = 0, R = 0, C = [];
  for (let y = 0; y < n; y++) {
    const b = new Set(Fe(e, p[y], s, z)), A = performance.now(), U = await l.search(p[y], s);
    w.push(performance.now() - A);
    for (const O of U)
      b.has(Number(O.id.slice(1))) && g++, k += O.score, I += O.score * O.score, R++;
    y === 0 && (C = U.map((O) => O.score));
  }
  k /= R || 1;
  const G = I / (R || 1) - k * k, B = C.length > 1 && C.some((y) => y !== C[0]) && G > 1e-9;
  w.sort((y, b) => y - b);
  const N = g / (n * s), V = Math.max(1, Math.floor(e.length * a)), M = [];
  for (let y = 0; y < V; y++)
    M.push(o[y]), z.delete(y);
  const D = [];
  for (const y of M) {
    const b = performance.now();
    await l.remove(y), D.push(performance.now() - b);
  }
  return D.sort((y, b) => y - b), r(`  recall@${s}=${N.toFixed(3)} p50=${H(w, 50).toFixed(2)}ms p99=${H(w, 99).toFixed(2)}ms delMedian=${ce(D).toFixed(3)}ms realScores=${B}`), {
    recallAtK: N,
    searchP50Ms: H(w, 50),
    searchP99Ms: H(w, 99),
    deleteMedianMs: ce(D),
    insertThroughputPerSec: u,
    hasRealScores: B,
    liveCount: z.size
  };
}
async function Ne(l, e = {}) {
  const t = {
    queries: e.queries ?? 200,
    k: e.k ?? 10,
    deleteFraction: e.deleteFraction ?? 0.05,
    minRecall: e.minRecall ?? 0.9,
    onProgress: e.onProgress ?? (() => {
    })
  }, i = (o) => t.onProgress(o);
  i(`Building synthetic corpus: ${l.size} × ${l.dimensions} (seeded)`);
  const r = De(l.size, l.dimensions, 42);
  i("HnswIndex:");
  const n = new Q({ dimensions: l.dimensions, metric: "cosine", m: 16, efConstruction: 200, efSearch: 64, seed: 42 });
  await n.initialize();
  const s = await Be(n, r, t, l, i);
  await n.clear();
  const a = s.hasRealScores && s.recallAtK >= t.minRecall;
  return { scale: l, hnsw: s, pass: a };
}
async function rt(l = [
  { size: 1e3, dimensions: 128 },
  { size: 1e4, dimensions: 128 }
], e = {}) {
  const t = [];
  let i = !0;
  for (const r of l) {
    const n = await Ne(r, e);
    t.push(n), n.pass || (i = !1);
  }
  return { results: t, overallPass: i };
}
const qe = /* @__PURE__ */ new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "of",
  "to",
  "in",
  "on",
  "at",
  "by",
  "for",
  "with",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "as",
  "from",
  "which",
  "who",
  "whom",
  "shall",
  "may",
  "must",
  "not",
  "no",
  "do",
  "does",
  "did",
  "has",
  "have"
]);
function F(l) {
  return l.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((e) => e.length > 1 && !qe.has(e));
}
class ge {
  constructor() {
    this.docs = /* @__PURE__ */ new Map(), this.docFreq = /* @__PURE__ */ new Map(), this.avgDocLen = 0, this.k1 = 1.5, this.b = 0.75;
  }
  add(e, t) {
    const i = F(t);
    this.docs.set(e, i);
    const r = /* @__PURE__ */ new Set();
    for (const n of i)
      r.has(n) || (this.docFreq.set(n, (this.docFreq.get(n) ?? 0) + 1), r.add(n));
    this.recomputeAvg();
  }
  remove(e) {
    const t = this.docs.get(e);
    if (!t) return;
    const i = /* @__PURE__ */ new Set();
    for (const r of t)
      if (!i.has(r)) {
        const n = this.docFreq.get(r);
        n !== void 0 && (n <= 1 ? this.docFreq.delete(r) : this.docFreq.set(r, n - 1)), i.add(r);
      }
    this.docs.delete(e), this.recomputeAvg();
  }
  clear() {
    this.docs.clear(), this.docFreq.clear(), this.avgDocLen = 0;
  }
  size() {
    return this.docs.size;
  }
  /** Score every doc against the query; return ranked list (best first). */
  search(e) {
    const t = F(e);
    if (t.length === 0 || this.docs.size === 0) return [];
    const i = this.docs.size, r = /* @__PURE__ */ new Map();
    for (const [n, s] of this.docs) {
      const a = s.length, o = /* @__PURE__ */ new Map();
      for (const d of s) o.set(d, (o.get(d) ?? 0) + 1);
      let c = 0;
      for (const d of t) {
        const h = o.get(d);
        if (!h) continue;
        const u = this.docFreq.get(d) ?? 0;
        if (u === 0) continue;
        const f = Math.log(1 + (i - u + 0.5) / (u + 0.5)), p = h + this.k1 * (1 - this.b + this.b * (a / (this.avgDocLen || 1)));
        c += f * (h * (this.k1 + 1)) / p;
      }
      c > 0 && r.set(n, c);
    }
    return Array.from(r.entries()).map(([n, s]) => ({ id: n, score: s })).sort((n, s) => s.score - n.score);
  }
  recomputeAvg() {
    if (this.docs.size === 0) {
      this.avgDocLen = 0;
      return;
    }
    let e = 0;
    for (const t of this.docs.values()) e += t.length;
    this.avgDocLen = e / this.docs.size;
  }
}
function we(l, e, t = {}) {
  const { rrfK: i = 60, denseWeight: r = 0.5, sparseWeight: n = 0.5 } = t, s = /* @__PURE__ */ new Map();
  l.forEach((d, h) => s.set(d.id, h + 1));
  const a = /* @__PURE__ */ new Map();
  e.forEach((d, h) => a.set(d.id, h + 1));
  const o = /* @__PURE__ */ new Set([...s.keys(), ...a.keys()]), c = [];
  for (const d of o) {
    const h = s.get(d), u = a.get(d);
    let f = 0;
    h && (f += r / (i + h)), u && (f += n / (i + u)), c.push({ id: d, score: f, denseRank: h, sparseRank: u });
  }
  return c.sort((d, h) => h.score - d.score), c;
}
const $e = [
  { id: "force-majeure", text: "Force Majeure. Neither party shall be liable for any failure or delay in performance under this Agreement caused by acts of God, war, terrorism, pandemic, or governmental action. The affected party shall give prompt written notice and use commercially reasonable efforts to resume performance." },
  { id: "indemnification", text: "Indemnification. The Service Provider agrees to indemnify, defend, and hold harmless the Client and its officers from any third-party claims, damages, liabilities, and expenses, including reasonable attorneys fees, arising out of any breach of this Agreement or negligent acts of the Service Provider." },
  { id: "arbitration", text: "Binding Arbitration. Any dispute, controversy, or claim arising out of or relating to this contract, or the breach thereof, shall be settled by binding arbitration administered in the State of Delaware under the commercial arbitration rules then prevailing. Judgment on the award may be entered in any court of competent jurisdiction." },
  { id: "limitation-of-liability", text: "Limitation of Liability. In no event shall either party be liable for indirect, incidental, special, consequential, or punitive damages, including lost profits or lost data, arising out of this Agreement, regardless of the theory of liability. The aggregate liability of each party shall not exceed the fees paid in the twelve months preceding the claim." },
  { id: "confidentiality", text: "Confidential Information. Each party agrees to hold the other partys confidential information in strict confidence and not to disclose it to any third party without prior written consent. Confidential information includes trade secrets, business plans, customer lists, and technical specifications, but excludes information that is publicly known or independently developed." },
  { id: "termination", text: "Termination for Convenience. Either party may terminate this Agreement for convenience upon thirty days prior written notice to the other party. Upon termination, all licenses granted hereunder shall cease, and the receiving party shall return or destroy all confidential materials within ten business days." },
  { id: "governing-law", text: "Governing Law. This Agreement shall be governed by and construed in accordance with the laws of the State of New York, without regard to its conflict of laws principles. The parties consent to the exclusive jurisdiction and venue of the state and federal courts located in New York County." },
  { id: "warranty", text: "Limited Warranty. The Service Provider warrants that the services will conform in all material respects to the applicable specification for a period of thirty days from delivery. The foregoing warranty is exclusive, and the providers sole obligation is to re-perform or correct the deficient services. All other warranties, express or implied, are hereby disclaimed." },
  { id: "assignment", text: "Assignment. Neither party may assign or transfer this Agreement, in whole or in part, by operation of law or otherwise, without the prior written consent of the other party, which shall not be unreasonably withheld. Any attempted assignment in violation of this section shall be null and void." },
  { id: "payment", text: "Payment Terms. The Client shall pay all undisputed invoices within net thirty days of the invoice date. Late payments shall accrue interest at one and a half percent per month or the maximum rate permitted by law, whichever is less. The Client may withhold payment only for items disputed in good faith and notified in writing." },
  { id: "data-protection", text: "Data Protection. The Service Provider shall process personal data only on the Clients documented instructions and in compliance with applicable data protection laws, including the GDPR. The provider shall implement appropriate technical and organizational measures to ensure a level of security appropriate to the risk, and shall notify the Client of any personal data breach without undue delay." },
  { id: "ip-ownership", text: "Intellectual Property Ownership. All intellectual property rights in any work product, deliverables, and inventions created under this Agreement shall vest in the Client upon creation. The Service Provider retains ownership of its pre-existing methodologies, tools, and background intellectual property used in performing the services." }
], Ge = [
  { query: "What happens if a pandemic prevents performance?", expectedId: "force-majeure" },
  { query: "Who pays attorneys fees if a third party sues over a breach?", expectedId: "indemnification" },
  { query: "Where are disputes settled — court or arbitration?", expectedId: "arbitration" },
  { query: "Can I recover lost profits for a breach?", expectedId: "limitation-of-liability" },
  { query: "What must be kept secret — trade secrets and customer lists?", expectedId: "confidentiality" },
  { query: "How much notice to end the agreement for convenience?", expectedId: "termination" },
  { query: "Which states laws govern this contract?", expectedId: "governing-law" },
  { query: "How long is the services warranty period?", expectedId: "warranty" },
  { query: "Can I assign the contract to another company without consent?", expectedId: "assignment" },
  { query: "When are invoices due and what is the late fee?", expectedId: "payment" },
  { query: "What are the providers obligations under the GDPR?", expectedId: "data-protection" },
  { query: "Who owns the deliverables and work product created?", expectedId: "ip-ownership" }
];
class Ve {
  constructor(e) {
    const t = /* @__PURE__ */ new Map();
    for (const i of e)
      for (const r of F(i.text))
        t.has(r) || t.set(r, t.size);
    this.vocab = t, this.dims = Math.max(t.size, 1);
  }
  embed(e) {
    const t = new Float32Array(this.dims);
    for (const r of F(e)) {
      const n = this.vocab.get(r);
      n !== void 0 && (t[n] += 1);
    }
    let i = 0;
    for (let r = 0; r < this.dims; r++) i += t[r] * t[r];
    i = Math.sqrt(i) || 1;
    for (let r = 0; r < this.dims; r++) t[r] /= i;
    return t;
  }
}
class Ue {
  isReady() {
    return !0;
  }
  async dispose() {
  }
  async rerank(e, t) {
    const i = new Set(F(e)), r = t.map((n) => {
      const s = n.metadata?.content ?? "";
      let a = 0;
      for (const o of F(s)) i.has(o) && a++;
      return { c: n, boost: a };
    });
    return r.sort((n, s) => s.boost - n.boost || s.c.score - n.c.score), r.map((n) => n.c);
  }
}
function le(l, e) {
  const t = l.findIndex((i) => i.id === e);
  return t === -1 ? l.length + 1 : t + 1;
}
async function nt(l = {}) {
  const e = l.k ?? 3, t = l.corpus ?? $e, i = l.questions ?? Ge, r = l.reranker ?? new Ue(), n = (g) => l.onProgress?.(g), s = new Ve(t), a = new Map(t.map((g) => [g.id, g.text])), o = new Q({ dimensions: s.dims, metric: "cosine", m: 16, efConstruction: 200, efSearch: 128 });
  await o.initialize();
  const c = t.map((g) => ({ id: g.id, vector: s.embed(g.text), metadata: { content: g.text, idx: g.id }, timestamp: 0 }));
  await o.addBatch(c);
  const d = new ge();
  for (const g of t) d.add(g.id, g.text);
  const h = ["dense", "dense+hybrid", "dense+rerank", "dense+hybrid+rerank"], u = [];
  for (const g of h) {
    const I = g.includes("hybrid"), k = g.includes("rerank"), R = I || k ? Math.max(e * 4, 8) : e, C = [];
    let G = 0, B = 0;
    for (const M of i) {
      const D = s.embed(M.query), b = (await o.search(D, R)).map((q) => ({
        id: q.id,
        score: q.score,
        metadata: { content: a.get(q.id) ?? "" }
      }));
      let A;
      if (I && d.size() > 0) {
        const q = d.search(M.query).slice(0, R), ye = we(
          b.map((S) => ({ id: S.id })),
          q.map((S) => ({ id: S.id }))
        ), ve = new Map(b.map((S) => [S.id, S]));
        A = ye.slice(0, R).map((S) => ve.get(S.id) ?? { id: S.id, score: S.score, metadata: { content: a.get(S.id) ?? "" } });
      } else
        A = b;
      k && A.length > 1 && (A = await r.rerank(M.query, A));
      const U = A.slice(0, e), O = le(U, M.expectedId), ne = O <= e;
      ne && G++, B += le(A, M.expectedId), C.push({ query: M.query, expectedId: M.expectedId, rank: O, hit: ne });
    }
    const N = G / i.length, V = B / i.length;
    n(`  ${g.padEnd(22)} recall@${e}=${N.toFixed(3)} meanRank=${V.toFixed(2)}`), u.push({ variant: g, citationRecallAtK: N, meanExpectedRank: V, perQuestion: C });
  }
  await o.clear();
  const f = u.find((g) => g.variant === "dense"), p = u.filter((g) => g.variant !== "dense" && g.citationRecallAtK > f.citationRecallAtK).map((g) => g.variant), w = u.find((g) => g.variant === "dense+hybrid+rerank"), z = w.citationRecallAtK > f.citationRecallAtK || w.citationRecallAtK === f.citationRecallAtK && w.meanExpectedRank < f.meanExpectedRank;
  return { variants: u, improvements: p, pipelineBeatsDense: z };
}
class st {
  constructor(e) {
    this.wllama = null, this.initialized = !1, this.modelLoaded = !1, this.config = e;
  }
  async initialize() {
    if (!this.initialized)
      try {
        const { Wllama: e } = await import("@wllama/wllama");
        this.wllama = new e(this.config.wasmPaths || {}), this.initialized = !0, await this.loadModel();
      } catch (e) {
        throw new Error(
          `Failed to initialize WllamaProvider: ${e instanceof Error ? e.message : String(e)}`
        );
      }
  }
  async loadModel() {
    if (!this.wllama)
      throw new Error("Wllama not initialized");
    if (!this.modelLoaded)
      try {
        await this.wllama.loadModelFromUrl(this.config.modelUrl, {
          n_ctx: this.config.modelConfig?.n_ctx || 2048,
          n_batch: this.config.modelConfig?.n_batch || 512,
          n_threads: this.config.modelConfig?.n_threads || 1,
          embeddings: this.config.modelConfig?.embeddings || !1,
          progressCallback: this.config.progressCallback ? ({ loaded: e, total: t }) => {
            this.config.progressCallback?.({ loaded: e, total: t });
          } : void 0
        }), this.modelLoaded = !0;
      } catch (e) {
        throw new Error(
          `Failed to load model from ${this.config.modelUrl}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
  }
  /**
   * Non-throwing capability probe. wllama runs on WASM, so it is available
   * wherever WebAssembly exists — the universal fallback. Model-load
   * availability (network/reachability of the model URL) is not checked
   * here; only runtime capability.
   */
  async isAvailable() {
    return typeof WebAssembly == "object";
  }
  async generate(e, t) {
    if (!this.initialized || !this.wllama)
      throw new Error("WllamaProvider not initialized. Call initialize() first.");
    if (!this.modelLoaded)
      throw new Error("Model not loaded");
    try {
      return await this.wllama.createCompletion(e, {
        nPredict: t?.maxTokens || 512,
        sampling: {
          temp: t?.temperature ?? 0.7,
          top_p: t?.topP ?? 0.9,
          top_k: t?.topK ?? 40
        },
        stopTokens: t?.stopSequences
      });
    } catch (i) {
      throw new Error(
        `Failed to generate text: ${i instanceof Error ? i.message : String(i)}`
      );
    }
  }
  async *generateStream(e, t) {
    if (!this.initialized || !this.wllama)
      throw new Error("WllamaProvider not initialized. Call initialize() first.");
    if (!this.modelLoaded)
      throw new Error("Model not loaded");
    const i = [];
    let r = null, n = !1, s = null;
    const a = () => {
      if (r) {
        const o = r;
        r = null, o();
      }
    };
    try {
      this.wllama.createCompletion(e, {
        nPredict: t?.maxTokens || 512,
        sampling: {
          temp: t?.temperature ?? 0.7,
          top_p: t?.topP ?? 0.9,
          top_k: t?.topK ?? 40
        },
        stopTokens: t?.stopSequences,
        onToken: (d) => {
          i.push(d), a();
        }
      }).then(() => {
        n = !0, a();
      }).catch((d) => {
        s = d instanceof Error ? d : new Error(String(d)), n = !0, a();
      });
      const c = new TextDecoder();
      for (; ; ) {
        for (; i.length > 0; ) {
          const d = i.shift();
          yield c.decode(d, { stream: !0 });
        }
        if (n) break;
        await new Promise((d) => {
          r = d;
        });
      }
      if (yield c.decode(), s)
        throw s;
    } catch (o) {
      throw new Error(
        `Failed to generate streaming text: ${o instanceof Error ? o.message : String(o)}`
      );
    }
  }
  async dispose() {
    if (this.wllama) {
      try {
        await this.wllama.exit();
      } catch (e) {
        console.warn("Error during wllama cleanup:", e);
      }
      this.wllama = null, this.initialized = !1, this.modelLoaded = !1;
    }
  }
  /**
   * Check if the provider is initialized
   */
  isInitialized() {
    return this.initialized && this.modelLoaded;
  }
  /**
   * Get model information
   */
  getModelInfo() {
    return {
      url: this.config.modelUrl,
      loaded: this.modelLoaded
    };
  }
}
class at {
  constructor(e) {
    this.engine = null, this.initialized = !1, this.webGPUAvailable = !1, this.config = e;
  }
  async initialize() {
    if (!this.initialized)
      try {
        if (this.webGPUAvailable = await this.checkWebGPUAvailability(), !this.webGPUAvailable)
          throw new Error(
            "WebGPU is not available in this browser. WebLLM requires WebGPU support. Please use a browser with WebGPU enabled (Chrome 113+, Edge 113+) or use WllamaProvider as a fallback."
          );
        const { getModelRegistry: e } = await Promise.resolve().then(() => Oe), { detectCapabilities: t } = await Promise.resolve().then(() => Me), i = await t(), r = e().canRunLLMModel(this.config.model, i);
        if (!r.canRun)
          throw new Error(
            `WebLLM model ${this.config.model} is not runnable on this device: ${r.reason}`
          );
        const { CreateMLCEngine: n } = await import("@mlc-ai/web-llm");
        this.engine = await n(this.config.model, {
          initProgressCallback: this.config.engineConfig?.initProgressCallback,
          logLevel: (this.config.engineConfig?.logLevel === "WARNING" ? "WARN" : this.config.engineConfig?.logLevel) || "ERROR"
        }), this.initialized = !0;
      } catch (e) {
        const t = e instanceof Error ? e.message : String(e);
        throw t.includes("WebGPU") || t.includes("gpu") ? new Error(
          `WebGPU initialization failed: ${t}. Consider using WllamaProvider as a WASM-based fallback.`
        ) : new Error(`Failed to initialize WebLLMProvider: ${t}`);
      }
  }
  /**
   * Non-throwing capability probe. WebLLM is available iff a functional
   * WebGPU adapter is present. Used by FallbackLLMProvider to decide
   * whether to even attempt initialization.
   */
  async isAvailable() {
    return this.checkWebGPUAvailability();
  }
  async checkWebGPUAvailability() {
    try {
      return navigator.gpu ? await navigator.gpu.requestAdapter() !== null : !1;
    } catch {
      return !1;
    }
  }
  async generate(e, t) {
    if (!this.initialized || !this.engine)
      throw new Error("WebLLMProvider not initialized. Call initialize() first.");
    try {
      const i = [
        { role: "user", content: e }
      ];
      return (await this.engine.chat.completions.create({
        messages: i,
        temperature: t?.temperature ?? this.config.chatConfig?.temperature ?? 0.7,
        top_p: t?.topP ?? this.config.chatConfig?.top_p ?? 0.9,
        max_tokens: t?.maxTokens ?? this.config.chatConfig?.max_tokens ?? 512,
        frequency_penalty: this.config.chatConfig?.frequency_penalty ?? 0,
        presence_penalty: this.config.chatConfig?.presence_penalty ?? 0,
        stop: t?.stopSequences
      })).choices[0]?.message?.content || "";
    } catch (i) {
      throw new Error(
        `Failed to generate text: ${i instanceof Error ? i.message : String(i)}`
      );
    }
  }
  async *generateStream(e, t) {
    if (!this.initialized || !this.engine)
      throw new Error("WebLLMProvider not initialized. Call initialize() first.");
    try {
      const i = [
        { role: "user", content: e }
      ], r = await this.engine.chat.completions.create({
        messages: i,
        temperature: t?.temperature ?? this.config.chatConfig?.temperature ?? 0.7,
        top_p: t?.topP ?? this.config.chatConfig?.top_p ?? 0.9,
        max_tokens: t?.maxTokens ?? this.config.chatConfig?.max_tokens ?? 512,
        frequency_penalty: this.config.chatConfig?.frequency_penalty ?? 0,
        presence_penalty: this.config.chatConfig?.presence_penalty ?? 0,
        stop: t?.stopSequences,
        stream: !0
      });
      for await (const n of r) {
        const s = n.choices[0]?.delta?.content;
        s && (yield s);
      }
    } catch (i) {
      throw new Error(
        `Failed to generate streaming text: ${i instanceof Error ? i.message : String(i)}`
      );
    }
  }
  async dispose() {
    if (this.engine) {
      try {
        await this.engine.unload();
      } catch (e) {
        console.warn("Error during WebLLM cleanup:", e);
      }
      this.engine = null, this.initialized = !1;
    }
  }
  /**
   * Check if the provider is initialized
   */
  isInitialized() {
    return this.initialized;
  }
  /**
   * Check if WebGPU is available in the current environment
   */
  static async isWebGPUAvailable() {
    try {
      return navigator.gpu ? await navigator.gpu.requestAdapter() !== null : !1;
    } catch {
      return !1;
    }
  }
  /**
   * Get model information
   */
  getModelInfo() {
    return {
      model: this.config.model,
      initialized: this.initialized,
      webGPUAvailable: this.webGPUAvailable
    };
  }
  /**
   * Get runtime statistics from the engine
   */
  async getRuntimeStats() {
    if (!this.engine)
      return null;
    try {
      return await this.engine.runtimeStatsText();
    } catch (e) {
      return console.warn("Failed to get runtime stats:", e), null;
    }
  }
  /**
   * Reset the chat history (useful for multi-turn conversations)
   */
  async resetChat() {
    if (!this.engine)
      throw new Error("WebLLMProvider not initialized");
    try {
      await this.engine.resetChat();
    } catch (e) {
      throw new Error(
        `Failed to reset chat: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
}
class ot {
  constructor(e) {
    if (this.activeIndex = -1, !e || e.length === 0)
      throw new Error("FallbackLLMProvider requires at least one provider");
    this.providers = e;
  }
  async initialize() {
    for (let e = 0; e < this.providers.length; e++) {
      const t = this.providers[e];
      try {
        if (await t.isAvailable()) {
          await t.initialize(), this.activeIndex = e;
          return;
        }
      } catch {
        continue;
      }
    }
    throw new Error(
      `FallbackLLMProvider: no provider is available in this environment (${this.providers.length} tried)`
    );
  }
  async generate(e, t) {
    const i = this.requireActive();
    try {
      return await i.generate(e, t);
    } catch (r) {
      const n = await this.nextAvailable(this.activeIndex);
      if (n === null || n === i)
        throw r;
      return n.generate(e, t);
    }
  }
  async *generateStream(e, t) {
    const i = this.requireActive();
    let r = !1;
    try {
      for await (const n of i.generateStream(e, t))
        r = !0, yield n;
    } catch (n) {
      if (r) throw n;
      const s = await this.nextAvailable(this.activeIndex);
      if (s === null || s === i) throw n;
      yield* s.generateStream(e, t);
    }
  }
  async isAvailable() {
    for (const e of this.providers)
      try {
        if (await e.isAvailable()) return !0;
      } catch {
        continue;
      }
    return !1;
  }
  async dispose() {
    await Promise.all(
      this.providers.map(
        (e) => e.dispose().catch(() => {
        })
      )
    ), this.activeIndex = -1;
  }
  /** The currently active provider, or null if none initialized. */
  getActiveProvider() {
    return this.activeIndex >= 0 ? this.providers[this.activeIndex] : null;
  }
  requireActive() {
    if (this.activeIndex < 0)
      throw new Error("FallbackLLMProvider not initialized. Call initialize() first.");
    return this.providers[this.activeIndex];
  }
  /**
   * Find the next available provider after `afterIndex`, initializing it.
   * Returns null if none found. Does not mutate activeIndex on failure.
   */
  async nextAvailable(e) {
    for (let t = e + 1; t < this.providers.length; t++) {
      const i = this.providers[t];
      try {
        if (await i.isAvailable())
          return await i.initialize(), this.activeIndex = t, i;
      } catch {
        continue;
      }
    }
    return null;
  }
}
class te {
  async count(e) {
    return Math.ceil(e.length / 4);
  }
  async truncate(e, t) {
    const i = t * 4;
    if (e.length <= i) return e;
    const r = e.substring(0, i), n = Math.max(r.lastIndexOf("."), r.lastIndexOf(`
`));
    return n > i * 0.8 ? r.substring(0, n + 1) + `

[Context truncated due to length...]` : r + `...

[Context truncated due to length...]`;
  }
  async dispose() {
  }
}
class ct {
  constructor(e) {
    this.tokenizer = null, this.initError = null, this.initializing = null, this.model = e;
  }
  async ensureLoaded() {
    if (!(this.tokenizer || this.initError))
      return this.initializing ? this.initializing : (this.initializing = (async () => {
        try {
          const { AutoTokenizer: e, env: t } = await import("@huggingface/transformers");
          t.allowLocalModels = !1, t.useBrowserCache = !0, this.tokenizer = await e.from_pretrained(this.model);
        } catch (e) {
          this.initError = e instanceof Error ? e : new Error(String(e));
        } finally {
          this.initializing = null;
        }
      })(), this.initializing);
  }
  async count(e) {
    if (await this.ensureLoaded(), !this.tokenizer) return Math.ceil(e.length / 4);
    try {
      const t = await this.tokenizer(e), i = t?.input_ids ?? t?.data;
      if (i && typeof i.length == "number") return i.length;
      if (i && typeof i.size == "number") return i.size;
    } catch {
    }
    return Math.ceil(e.length / 4);
  }
  async truncate(e, t) {
    if (await this.ensureLoaded(), !this.tokenizer)
      return new te().truncate(e, t);
    try {
      const i = await this.tokenizer(e), r = i?.input_ids ?? i?.data;
      let n = [];
      if (Array.isArray(r) ? n = r : r && typeof r.tolist == "function" ? n = r.tolist() : r && r.length !== void 0 && (n = Array.from(r)), n.length <= t) return e;
      const s = n.slice(0, t);
      return this.tokenizer.decode(s, { skip_special_tokens: !0 }) + `

[Context truncated due to length...]`;
    } catch {
      return new te().truncate(e, t);
    }
  }
  async dispose() {
    this.tokenizer = null, this.initError = null;
  }
}
class lt {
  constructor(e = {}) {
    this.pipeline = null, this.initError = null, this.initializing = null, this.options = {
      model: e.model ?? "Xenova/ms-marco-MiniLM-L-6-v2",
      device: e.device ?? "wasm",
      topN: e.topN ?? 0
      // 0 = rerank all
    };
  }
  isReady() {
    return this.pipeline !== null;
  }
  async ensureLoaded() {
    if (!(this.pipeline || this.initError))
      return this.initializing ? this.initializing : (this.initializing = (async () => {
        try {
          const { pipeline: e, env: t } = await import("@huggingface/transformers");
          t.allowLocalModels = !1, t.useBrowserCache = !0, this.pipeline = await e("text-classification", this.options.model, {
            quantized: !0,
            device: this.options.device === "webgpu" ? "webgpu" : void 0
          });
        } catch (e) {
          this.initError = e instanceof Error ? e : new Error(String(e));
        } finally {
          this.initializing = null;
        }
      })(), this.initializing);
  }
  async rerank(e, t) {
    if (t.length <= 1 || (await this.ensureLoaded(), !this.pipeline))
      return t;
    const i = this.options.topN > 0 ? t.slice(0, this.options.topN) : t, r = this.options.topN > 0 ? t.slice(this.options.topN) : [];
    try {
      const n = i.map((o) => ({ text: e, text_pair: this.snippet(o) })), s = await this.pipeline(n), a = this.normalizeOutputs(s, i);
      return a.sort((o, c) => c.score - o.score), [...a, ...r];
    } catch {
      return t;
    }
  }
  /** Extract a scoring snippet from a search result. */
  snippet(e) {
    const t = e.metadata?.content;
    return typeof t == "string" ? t.slice(0, 512) : typeof e.metadata?.title == "string" ? e.metadata.title : "";
  }
  /**
   * Transformers.js text-classification returns either a single object,
   * an array of objects, or a tensor depending on version/input shape.
   * Normalize to an array of { score } aligned with the candidate order.
   */
  normalizeOutputs(e, t) {
    const i = [];
    if (Array.isArray(e))
      for (const r of e)
        i.push(this.extractScore(r));
    else
      i.push(this.extractScore(e));
    return t.map((r, n) => ({ ...r, score: i[n] ?? r.score }));
  }
  extractScore(e) {
    if (typeof e == "number") return e;
    if (Array.isArray(e) && e.length > 0) return this.extractScore(e[0]);
    if (e && typeof e == "object") {
      if (typeof e.score == "number") return e.score;
      if (Array.isArray(e)) return this.extractScore(e[0]);
      const t = Object.values(e);
      for (const i of t)
        if (i && typeof i == "object" && typeof i.score == "number")
          return i.score;
    }
    return 0;
  }
  async dispose() {
    this.pipeline = null, this.initError = null;
  }
}
class We {
  isReady() {
    return !0;
  }
  async rerank(e, t) {
    return t;
  }
  async dispose() {
  }
}
const je = "You are a helpful assistant. Use the following context to answer the user's question. If the context doesn't contain relevant information, say so. Cite sources by their [n] number when grounding a claim.", He = `{system}

Context:
{context}

Question: {question}

Answer:`;
class dt {
  constructor(e) {
    this.vectorDB = e.vectorDB, this.llmProvider = e.llmProvider, this.embeddingGenerator = e.embeddingGenerator, this.defaultContextTemplate = e.defaultContextTemplate || this.getDefaultTemplate(), this.defaultPromptTemplate = e.defaultPromptTemplate ?? {}, this.defaultMaxContextTokens = e.defaultMaxContextTokens || 2e3, this.tokenizer = e.tokenizer ?? new te(), this.reranker = e.reranker ?? new We(), this.bm25 = new ge(), this.hybridByDefault = e.hybridByDefault ?? !1, this.rerankByDefault = e.rerankByDefault ?? !1, this.retrieveMultiplier = e.retrieveMultiplier ?? 4;
  }
  /**
   * Index a document's text into the BM25 sparse index for hybrid search.
   * Call this when documents are added to the vector DB so the sparse index
   * stays in sync. (The dense index is maintained by VectorDB itself.)
   */
  indexDocument(e, t) {
    this.bm25.add(e, t);
  }
  /** Remove a document from the BM25 sparse index. */
  removeDocument(e) {
    this.bm25.remove(e);
  }
  /**
   * Swap the LLM provider at runtime. Used by UIs that boot with a
   * retrieval-only (noop) provider and upgrade to a real local LLM once its
   * model finishes loading in the background.
   */
  setLLMProvider(e) {
    this.llmProvider = e;
  }
  /** The active LLM provider (for UI status display). */
  getLLMProvider() {
    return this.llmProvider;
  }
  /**
   * Execute a RAG query: retrieve relevant documents and generate a response
   * 
   * @param query - User query text
   * @param options - RAG options including topK, filters, and generation settings
   * @returns RAG result with answer, sources, and metadata
   */
  async query(e, t) {
    try {
      const i = t?.hybrid ?? this.hybridByDefault, r = t?.rerank ?? this.rerankByDefault, n = Date.now();
      let s = await this.retrieve(e, t, i), a = !1;
      r && s.length > 1 && (s = await this.reranker.rerank(e, s), a = this.reranker.isReady());
      const o = Date.now() - n, c = this.formatContext(s, t), d = t?.maxContextTokens || this.defaultMaxContextTokens, h = await this.tokenizer.truncate(c, d), u = this.buildPrompt(e, h, t?.promptTemplate), f = Date.now(), p = await this.llmProvider.generate(u, t?.generateOptions), w = Date.now() - f, z = await this.tokenizer.count(p), g = await this.tokenizer.count(h), I = this.buildCitations(s);
      return {
        answer: p,
        sources: t?.includeSourcesInResponse !== !1 ? s : [],
        citations: I,
        metadata: {
          retrievalTime: o,
          generationTime: w,
          tokensGenerated: z,
          contextLength: g,
          reranked: a,
          hybrid: i
        }
      };
    } catch (i) {
      throw new m(
        "Failed to execute RAG query",
        "RAG_QUERY_ERROR",
        { error: i, query: e }
      );
    }
  }
  /**
   * Execute a streaming RAG query: retrieve documents and stream the generated response
   * 
   * @param query - User query text
   * @param options - RAG options including topK, filters, and generation settings
   * @yields RAG stream chunks with retrieval results and generated text
   */
  async *queryStream(e, t) {
    try {
      const i = t?.hybrid ?? this.hybridByDefault, r = t?.rerank ?? this.rerankByDefault, n = Date.now();
      let s = await this.retrieve(e, t, i);
      r && s.length > 1 && (s = await this.reranker.rerank(e, s));
      const a = Date.now() - n;
      yield {
        type: "retrieval",
        content: "",
        sources: t?.includeSourcesInResponse !== !1 ? s : [],
        metadata: { retrievalTime: a }
      };
      const o = this.formatContext(s, t), c = t?.maxContextTokens || this.defaultMaxContextTokens, d = await this.tokenizer.truncate(o, c), h = this.buildPrompt(e, d, t?.promptTemplate), u = Date.now();
      for await (const p of this.llmProvider.generateStream(h, t?.generateOptions))
        yield {
          type: "generation",
          content: p
        };
      const f = Date.now() - u;
      yield {
        type: "complete",
        content: "",
        metadata: {
          retrievalTime: a,
          generationTime: f
        }
      };
    } catch (i) {
      throw new m(
        "Failed to execute streaming RAG query",
        "RAG_STREAM_ERROR",
        { error: i, query: e }
      );
    }
  }
  /**
   * Retrieve relevant documents for a query
   * 
   * @param query - User query text
   * @param options - RAG options with topK and filter
   * @returns Array of search results
   */
  async retrieve(e, t, i = !1) {
    const r = await this.embeddingGenerator.embed(e), n = t?.topK || 5, s = (t?.rerank ?? this.rerankByDefault) || i ? n * this.retrieveMultiplier : n, a = await this.vectorDB.search({
      vector: r,
      k: s,
      filter: t?.filter,
      includeVectors: !1
    });
    if (!i || this.bm25.size() === 0)
      return a.slice(0, n);
    const o = this.bm25.search(e).slice(0, s), c = new Map(a.map((h) => [h.id, h]));
    return we(
      a.map((h) => ({ id: h.id })),
      o
    ).slice(0, n).map((h) => {
      const u = c.get(h.id);
      return u ? { ...u, score: h.score } : { id: h.id, score: h.score, metadata: {} };
    });
  }
  /**
   * Format context from retrieved documents using a template
   * 
   * @param results - Search results to format
   * @param options - RAG options with optional context template
   * @returns Formatted context string
   */
  formatContext(e, t) {
    if (e.length === 0)
      return "No relevant information found.";
    const i = t?.promptTemplate?.contextItemTemplate ?? t?.contextTemplate ?? this.defaultPromptTemplate?.contextItemTemplate ?? this.defaultContextTemplate, r = t?.promptTemplate?.contextJoin ?? this.defaultPromptTemplate?.contextJoin ?? `

`;
    return e.map((s, a) => this.applyTemplate(i, s, a)).join(r);
  }
  /**
   * Apply a template to a search result
   * 
   * @param template - Template string with placeholders
   * @param result - Search result to format
   * @param index - Result index (0-based)
   * @returns Formatted string
   */
  applyTemplate(e, t, i) {
    let r = e;
    return r = r.replace(/\{index\}/g, String(i + 1)), r = r.replace(/\{score\}/g, t.score.toFixed(4)), r = r.replace(/\{content\}/g, t.metadata.content || ""), r = r.replace(/\{title\}/g, t.metadata.title || ""), r = r.replace(/\{url\}/g, t.metadata.url || ""), r = r.replace(/\{id\}/g, t.id), r = r.replace(/\{metadata\.(\w+)\}/g, (n, s) => t.metadata[s] !== void 0 ? String(t.metadata[s]) : ""), r;
  }
  /**
   * Build a prompt with context injection, using a configurable template.
   *
   * Replaces the previously hardcoded English instruction. Callers pass a
   * PromptTemplate (system, contextItemTemplate, template) for
   * jurisdiction-aware or domain-specific instructions.
   */
  buildPrompt(e, t, i) {
    const r = i ?? this.defaultPromptTemplate, n = r.system ?? je;
    return (r.template ?? He).replace("{system}", n).replace("{context}", t).replace("{question}", e);
  }
  /**
   * Build citation objects binding the answer back to its source passages.
   * Each citation carries the source id, score, a snippet, metadata, and a
   * 1-based rank — the audit trail that makes privilege-grounded answers
   * reviewable (PRODUCT_DESIGN.md B6, stage 7).
   */
  buildCitations(e) {
    return e.map((t, i) => ({
      id: t.id,
      score: t.score,
      snippet: this.snippetOf(t),
      metadata: t.metadata ?? {},
      rank: i + 1
    }));
  }
  snippetOf(e) {
    const t = e.metadata?.content;
    return typeof t == "string" ? t.slice(0, 280) : typeof e.metadata?.title == "string" ? e.metadata.title : "";
  }
  /**
   * Get the default context template
   * 
   * @returns Default template string
   */
  getDefaultTemplate() {
    return `Document {index}:
{content}`;
  }
  /**
   * Set a custom context template
   * 
   * @param template - Template string with placeholders
   */
  setContextTemplate(e) {
    this.defaultContextTemplate = e;
  }
  /**
   * Set the default maximum context tokens
   * 
   * @param maxTokens - Maximum number of tokens for context
   */
  setMaxContextTokens(e) {
    this.defaultMaxContextTokens = e;
  }
  /**
   * Get current configuration
   * 
   * @returns Current RAG pipeline configuration
   */
  getConfig() {
    return {
      defaultContextTemplate: this.defaultContextTemplate,
      defaultMaxContextTokens: this.defaultMaxContextTokens
    };
  }
}
const Xe = {
  chunkSize: 256,
  overlap: 32,
  minChunkSize: 64
};
function Z(l) {
  const e = l.trim().split(/\s+/).filter(Boolean).length, t = Math.ceil(l.length / 4);
  return Math.max(e, t);
}
function Qe(l) {
  return l.split(/(?<=[.!?])\s+(?=\S)/).map((t) => t.trim()).filter((t) => t.length > 0);
}
class ht {
  constructor(e = {}) {
    this.opts = { ...Xe, ...e }, this.opts.overlap >= this.opts.chunkSize && (this.opts.overlap = Math.floor(this.opts.chunkSize / 4));
  }
  chunk(e) {
    const t = e.replace(/\r\n/g, `
`).trim();
    if (t.length === 0) return [];
    const i = Qe(t);
    if (i.length === 0) return [];
    const { chunkSize: r, overlap: n, minChunkSize: s } = this.opts, a = [];
    let o = [], c = 0;
    const d = [];
    let h = 0;
    for (const p of i) {
      const w = t.indexOf(p, h);
      d.push(w === -1 ? h : w), h = (w === -1 ? h : w) + p.length;
    }
    const u = (p, w) => {
      if (o.length === 0) return;
      const z = o.join(" ");
      if (Z(z) < s && a.length > 0) {
        const I = a[a.length - 1];
        a[a.length - 1] = {
          text: I.text + " " + z,
          index: I.index,
          startOffset: I.startOffset
        };
      } else
        a.push({
          text: z,
          index: a.length,
          startOffset: d[w] ?? 0
        });
      o = [], c = 0;
    };
    let f = 0;
    for (let p = 0; p < i.length; p++) {
      const w = i[p], z = Z(w);
      if (c + z > r && o.length > 0) {
        u(p, f), f = p;
        let g = 0, I = p - 1;
        const k = [];
        for (; I >= 0 && g < n; ) {
          const R = i[I];
          k.unshift(R), g += Z(R), I--;
        }
        k.length > 0 && (o = k, c = g, f = I + 1);
      }
      o.push(w), c += z;
    }
    return u(i.length, f), a;
  }
}
class ut {
  constructor(e) {
    this.vectorDB = e.vectorDB, this.ragPipeline = e.ragPipeline, this.scope = e.scope, this.tools = this.initializeTools();
  }
  /**
   * Get all available MCP tools
   * 
   * @returns Array of MCP tool definitions
   */
  getTools() {
    return this.tools;
  }
  /**
   * Execute a specific MCP tool by name
   * 
   * @param name - Tool name to execute
   * @param params - Tool parameters
   * @returns Tool execution result
   */
  async executeTool(e, t) {
    const i = this.tools.find((r) => r.name === e);
    if (!i)
      throw new m(
        `Tool '${e}' not found`,
        "TOOL_NOT_FOUND",
        { name: e, availableTools: this.tools.map((r) => r.name) }
      );
    try {
      return this.validateParams(t, i.inputSchema), await i.handler(t);
    } catch (r) {
      throw new m(
        `Failed to execute tool '${e}'`,
        "TOOL_EXECUTION_ERROR",
        { name: e, params: t, error: r }
      );
    }
  }
  /**
   * Initialize all MCP tools
   * 
   * @returns Array of MCP tool definitions with handlers
   */
  initializeTools() {
    const e = [
      this.createSearchVectorsTool(),
      this.createInsertDocumentTool(),
      this.createDeleteDocumentTool()
    ];
    return this.ragPipeline && e.push(this.createRAGQueryTool()), e;
  }
  /**
   * Build a non-bypassable matter-scope filter. The scope is AND-merged with
   * any caller-supplied filter so an agent cannot escape its matter by
   * omitting or overriding the filter. Returns undefined when no scope is set.
   */
  scopeFilter(e, t) {
    if (!this.scope || t && this.scope.enforceOn && !this.scope.enforceOn.includes(t))
      return e;
    const i = { field: this.scope.field, operator: "eq", value: this.scope.value };
    return e ? { operator: "and", filters: [i, e] } : i;
  }
  /** Stamp the matter scope onto an insert's metadata (non-bypassable). */
  scopedMetadata(e) {
    return this.scope ? { ...e, [this.scope.field]: this.scope.value } : e;
  }
  /**
   * Create the search_vectors tool
   */
  createSearchVectorsTool() {
    return {
      name: "search_vectors",
      description: "Search for similar vectors using a text query. Returns the most semantically similar documents from the vector database.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query text to find similar documents"
          },
          k: {
            type: "number",
            description: "Number of results to return (default: 5)",
            default: 5,
            minimum: 1,
            maximum: 100
          },
          filter: {
            type: "object",
            description: "Optional metadata filters to narrow results",
            properties: {
              field: { type: "string" },
              operator: {
                type: "string",
                enum: ["eq", "ne", "gt", "gte", "lt", "lte", "in", "contains"]
              },
              value: {}
            }
          },
          includeVectors: {
            type: "boolean",
            description: "Whether to include vector embeddings in results (default: false)",
            default: !1
          }
        },
        required: ["query"]
      },
      handler: async (e) => {
        const { query: t, k: i = 5, filter: r, includeVectors: n = !1 } = e, s = await this.vectorDB.search({
          text: t,
          k: i,
          filter: this.scopeFilter(r, "search_vectors"),
          includeVectors: n
        });
        return {
          success: !0,
          results: s.map((a) => ({
            id: a.id,
            score: a.score,
            metadata: a.metadata,
            ...n && a.vector ? { vector: Array.from(a.vector) } : {}
          })),
          count: s.length
        };
      }
    };
  }
  /**
   * Create the insert_document tool
   */
  createInsertDocumentTool() {
    return {
      name: "insert_document",
      description: "Insert a document with text content and optional metadata into the vector database. The text will be automatically embedded.",
      inputSchema: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "Document text content to embed and store"
          },
          metadata: {
            type: "object",
            description: "Optional metadata to associate with the document (e.g., title, url, tags)",
            additionalProperties: !0
          },
          id: {
            type: "string",
            description: "Optional custom document ID (auto-generated if not provided)"
          }
        },
        required: ["content"]
      },
      handler: async (e) => {
        const { content: t, metadata: i = {} } = e;
        return {
          success: !0,
          id: await this.vectorDB.insert({
            text: t,
            metadata: this.scopedMetadata({
              ...i,
              content: t
              // Store content in metadata for retrieval
            })
          }),
          message: "Document inserted successfully"
        };
      }
    };
  }
  /**
   * Create the delete_document tool
   */
  createDeleteDocumentTool() {
    return {
      name: "delete_document",
      description: "Delete a document from the vector database by its ID.",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Document ID to delete"
          }
        },
        required: ["id"]
      },
      handler: async (e) => {
        const { id: t } = e;
        return await this.vectorDB.delete(t) ? {
          success: !0,
          id: t,
          message: "Document deleted successfully"
        } : {
          success: !1,
          message: `Document with ID '${t}' not found`
        };
      }
    };
  }
  /**
   * Create the rag_query tool
   */
  createRAGQueryTool() {
    return {
      name: "rag_query",
      description: "Execute a RAG (Retrieval-Augmented Generation) query. Retrieves relevant documents and generates an answer using a local LLM.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "User question or query"
          },
          topK: {
            type: "number",
            description: "Number of documents to retrieve for context (default: 5)",
            default: 5,
            minimum: 1,
            maximum: 20
          },
          filter: {
            type: "object",
            description: "Optional metadata filters for document retrieval",
            properties: {
              field: { type: "string" },
              operator: {
                type: "string",
                enum: ["eq", "ne", "gt", "gte", "lt", "lte", "in", "contains"]
              },
              value: {}
            }
          },
          maxTokens: {
            type: "number",
            description: "Maximum tokens to generate in response (default: 512)",
            default: 512,
            minimum: 1,
            maximum: 4096
          },
          temperature: {
            type: "number",
            description: "Sampling temperature for generation (default: 0.7)",
            default: 0.7,
            minimum: 0,
            maximum: 2
          }
        },
        required: ["query"]
      },
      handler: async (e) => {
        if (!this.ragPipeline)
          throw new m(
            "RAG pipeline not configured",
            "RAG_NOT_AVAILABLE",
            { tool: "rag_query" }
          );
        const {
          query: t,
          topK: i = 5,
          filter: r,
          maxTokens: n = 512,
          temperature: s = 0.7
        } = e, a = await this.ragPipeline.query(t, {
          topK: i,
          filter: this.scopeFilter(r, "rag_query"),
          generateOptions: {
            maxTokens: n,
            temperature: s
          }
        });
        return {
          success: !0,
          answer: a.answer,
          sources: a.sources.map((o) => ({
            id: o.id,
            score: o.score,
            metadata: o.metadata
          })),
          metadata: a.metadata
        };
      }
    };
  }
  /**
   * Validate parameters against JSON schema
   * 
   * @param params - Parameters to validate
   * @param schema - JSON schema to validate against
   */
  validateParams(e, t) {
    if (t.required) {
      for (const i of t.required)
        if (e[i] === void 0)
          throw new m(
            `Missing required parameter: ${i}`,
            "INVALID_PARAMS",
            { field: i, schema: t }
          );
    }
    if (t.properties)
      for (const [i, r] of Object.entries(e)) {
        const n = t.properties[i];
        if (!n) {
          if (t.additionalProperties === !1)
            throw new m(
              `Unknown parameter: ${i}`,
              "INVALID_PARAMS",
              { key: i, schema: t }
            );
          continue;
        }
        this.validateType(r, n, i);
      }
  }
  /**
   * Validate a value against a schema type
   * 
   * @param value - Value to validate
   * @param schema - Schema to validate against
   * @param fieldName - Field name for error messages
   */
  validateType(e, t, i) {
    const r = Array.isArray(e) ? "array" : typeof e;
    if (t.type && r !== t.type && e !== null)
      throw new m(
        `Invalid type for parameter '${i}': expected ${t.type}, got ${r}`,
        "INVALID_PARAM_TYPE",
        { fieldName: i, expected: t.type, actual: r }
      );
    if (t.enum && !t.enum.includes(e))
      throw new m(
        `Invalid value for parameter '${i}': must be one of ${t.enum.join(", ")}`,
        "INVALID_PARAM_VALUE",
        { fieldName: i, value: e, allowed: t.enum }
      );
    if (t.type === "number") {
      if (t.minimum !== void 0 && e < t.minimum)
        throw new m(
          `Parameter '${i}' must be >= ${t.minimum}`,
          "INVALID_PARAM_VALUE",
          { fieldName: i, value: e, minimum: t.minimum }
        );
      if (t.maximum !== void 0 && e > t.maximum)
        throw new m(
          `Parameter '${i}' must be <= ${t.maximum}`,
          "INVALID_PARAM_VALUE",
          { fieldName: i, value: e, maximum: t.maximum }
        );
    }
  }
  /**
   * Get tool by name
   * 
   * @param name - Tool name
   * @returns Tool definition or undefined
   */
  getTool(e) {
    return this.tools.find((t) => t.name === e);
  }
  /**
   * Check if a tool exists
   * 
   * @param name - Tool name
   * @returns True if tool exists
   */
  hasTool(e) {
    return this.tools.some((t) => t.name === e);
  }
  /**
   * Get list of available tool names
   * 
   * @returns Array of tool names
   */
  getToolNames() {
    return this.tools.map((e) => e.name);
  }
  /**
   * Mount the tool registry onto a real Model Context Protocol server and
   * start serving over the chosen transport.
   *
   *  - `stdio`            — binds StdioServerTransport; returns the McpServer.
   *    The process stays alive until the client disconnects.
   *  - `sse`              — binds a real Node HTTP server. GET on the endpoint
   *    opens the SSE stream; POST sends messages. Returns the http.Server.
   *  - `streamable-http`  — binds a real Node HTTP server with a single
   *    stateful StreamableHTTPServerTransport handling all verbs. Returns the
   *    http.Server.
   *
   * The HTTP transports are Node-only (`node:http`); they are not part of the
   * browser bundle. Call `server.close()` on the returned http.Server to stop.
   */
  async serve(e, t) {
    const { McpServer: i } = await import("@modelcontextprotocol/sdk/server/mcp.js"), { StdioServerTransport: r } = await import("@modelcontextprotocol/sdk/server/stdio.js"), n = new i(
      { name: "domicile-mcp", version: "0.2.0" },
      { capabilities: { tools: {} } }
    );
    for (const s of this.tools)
      this.registerOnMcpServer(n, s);
    if (e === "stdio") {
      const s = new r();
      return await n.connect(s), n;
    }
    if (e === "sse")
      return this.serveSSE(n, t);
    if (e === "streamable-http")
      return this.serveStreamableHTTP(n, t);
    throw new m(`Unsupported MCP transport: ${e}`, "MCP_TRANSPORT_ERROR", { transport: e });
  }
  /**
   * SSE transport over a real Node HTTP server. One SSEServerTransport per
   * connected client (keyed by sessionId); GET upgrades, POST delivers.
   */
  async serveSSE(e, t) {
    const i = await import("node:http"), { SSEServerTransport: r } = await import("@modelcontextprotocol/sdk/server/sse.js"), n = t?.endpoint ?? "/message", s = /* @__PURE__ */ new Map(), a = i.createServer(async (c, d) => {
      const h = new URL(c.url ?? "/", `http://${c.headers.host ?? "localhost"}`);
      if (c.method === "GET" && h.pathname === n) {
        const u = new r("/message", d);
        s.set(u.sessionId, u), u.onclose = () => s.delete(u.sessionId), await e.connect(u);
        return;
      }
      if (c.method === "POST" && h.pathname === "/message") {
        const u = h.searchParams.get("sessionId") ?? "", f = s.get(u);
        if (!f) {
          d.writeHead(400).end("unknown session");
          return;
        }
        await f.handlePostMessage(c, d);
        return;
      }
      d.writeHead(404).end();
    }), o = t?.port ?? 3001;
    return await new Promise((c) => a.listen(o, c)), a;
  }
  /**
   * Streamable HTTP transport over a real Node HTTP server. A single
   * stateful transport handles initialize/POST/GET/DELETE; one session.
   */
  async serveStreamableHTTP(e, t) {
    const i = await import("node:http"), { StreamableHTTPServerTransport: r } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js"), n = t?.endpoint ?? "/mcp", s = new r({
      sessionIdGenerator: () => crypto.randomUUID()
    });
    await e.connect(s);
    const a = i.createServer(async (c, d) => {
      if (new URL(c.url ?? "/", `http://${c.headers.host ?? "localhost"}`).pathname !== n) {
        d.writeHead(404).end();
        return;
      }
      await s.handleRequest(c, d);
    }), o = t?.port ?? 3001;
    return await new Promise((c) => a.listen(o, c)), a;
  }
  /**
   * Register a single Domicile tool on the MCP Server. Uses the low-level
   * request handler so we control schema shape (our JSONSchema) and delegate
   * execution to our validated `executeTool`.
   */
  registerOnMcpServer(e, t) {
    const i = e;
    try {
      i.tool(
        t.name,
        t.description,
        async (r) => {
          const n = await this.executeTool(t.name, r ?? {});
          return { content: [{ type: "text", text: JSON.stringify(n) }] };
        }
      );
    } catch {
    }
  }
}
function mt(l) {
  const [e, t] = x(null), [i, r] = x(!1), [n, s] = x(null), a = de(null);
  return he(() => {
    let o = !1;
    return r(!1), s(null), l.create().then((c) => {
      if (o) {
        c.dispose?.();
        return;
      }
      a.current = c, t(c), r(!0);
    }).catch((c) => {
      o || s(c instanceof Error ? c : new Error(String(c)));
    }), () => {
      o = !0, l.autoDispose !== !1 && a.current && (a.current.dispose?.().catch(() => {
      }), a.current = null);
    };
  }, []), { db: e, ready: i, error: n };
}
function ft(l) {
  const [e, t] = x([]), [i, r] = x(!1), [n, s] = x(null), a = de(0), o = $(
    (c, d = 5) => {
      if (!l) return;
      const h = ++a.current;
      r(!0), s(null), l.search({ text: c, k: d }).then((u) => {
        h === a.current && t(u);
      }).catch((u) => {
        h === a.current && s(u instanceof Error ? u : new Error(String(u)));
      }).finally(() => {
        h === a.current && r(!1);
      });
    },
    [l]
  );
  return { results: e, loading: i, error: n, search: o };
}
function pt(l) {
  const [e, t] = x(""), [i, r] = x([]), [n, s] = x(!1), [a, o] = x(null), c = $(
    (d) => {
      l && (s(!0), o(null), t(""), r([]), l.query(d).then((h) => {
        t(h.answer), r(h.sources);
      }).catch((h) => o(h instanceof Error ? h : new Error(String(h)))).finally(() => s(!1)));
    },
    [l]
  );
  return { answer: e, sources: i, loading: n, error: a, query: c };
}
function gt(l) {
  const [e, t] = x([]), [i, r] = x(!1), [n, s] = x([]), [a, o] = x(null), c = $(
    async (h) => {
      if (l) {
        t([]), s([]), o(null), r(!0);
        try {
          for await (const u of l.queryStream(h))
            u.type === "retrieval" ? s(u.sources ?? []) : u.type === "generation" && u.content && t((f) => [...f, u.content]);
        } catch (u) {
          o(u instanceof Error ? u : new Error(String(u)));
        } finally {
          r(!1);
        }
      }
    },
    [l]
  ), d = $(() => {
    t([]), s([]), o(null);
  }, []);
  return {
    chunks: e,
    fullText: e.join(""),
    streaming: i,
    sources: n,
    error: a,
    stream: c,
    reset: d
  };
}
function wt() {
  const [l, e] = x(null), [t, i] = x(!0);
  return he(() => {
    let r = !1;
    return ie(!0).then((n) => {
      r || e(n);
    }).finally(() => {
      r || i(!1);
    }), () => {
      r = !0;
    };
  }, []), { capabilities: l, loading: t };
}
function yt(l) {
  const [e, t] = x({
    phase: "idle",
    loaded: 0,
    total: 0,
    error: null
  }), i = $(
    async (r, n) => {
      if (l) {
        t({ phase: "ingesting", loaded: 0, total: r.length, error: null });
        try {
          let a = 0;
          for (let o = 0; o < r.length; o += 10) {
            const c = r.slice(o, o + 10), d = c.map((h, u) => ({
              text: h,
              metadata: n?.[o + u] ?? {}
            }));
            await l.insertBatch(d), a += c.length, t({ phase: "ingesting", loaded: a, total: r.length, error: null });
          }
          t({ phase: "done", loaded: r.length, total: r.length, error: null });
        } catch (s) {
          t((a) => ({
            phase: "error",
            loaded: a.loaded,
            total: a.total,
            error: s instanceof Error ? s : new Error(String(s))
          }));
        }
      }
    },
    [l]
  );
  return { progress: e, ingest: i };
}
class Ke {
  constructor() {
    this.results = [], this.environment = this.detectEnvironment();
  }
  /**
   * Detect browser and system environment
   */
  detectEnvironment() {
    const e = navigator.userAgent;
    let t = "Unknown", i = "Unknown";
    if (e.includes("Chrome") && !e.includes("Edg")) {
      t = "Chrome";
      const r = e.match(/Chrome\/(\d+)/);
      i = r ? r[1] : "Unknown";
    } else if (e.includes("Firefox")) {
      t = "Firefox";
      const r = e.match(/Firefox\/(\d+)/);
      i = r ? r[1] : "Unknown";
    } else if (e.includes("Safari") && !e.includes("Chrome")) {
      t = "Safari";
      const r = e.match(/Version\/(\d+)/);
      i = r ? r[1] : "Unknown";
    } else if (e.includes("Edg")) {
      t = "Edge";
      const r = e.match(/Edg\/(\d+)/);
      i = r ? r[1] : "Unknown";
    }
    return {
      browser: t,
      browserVersion: i,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency || 1,
      deviceMemory: navigator.deviceMemory,
      connection: navigator.connection?.effectiveType
    };
  }
  /**
   * Run a benchmark function and measure performance
   */
  async run(e, t, i, r = {}) {
    const { warmup: n = 0, iterations: s = 1, collectMemory: a = !0 } = r;
    for (let f = 0; f < n; f++)
      await i();
    globalThis.gc && globalThis.gc();
    const o = a ? this.getMemoryUsage() : null, c = [];
    for (let f = 0; f < s; f++) {
      const p = performance.now();
      await i();
      const w = performance.now();
      c.push(w - p);
    }
    const d = a ? this.getMemoryUsage() : null, h = {
      iterations: s,
      min: Math.min(...c),
      max: Math.max(...c),
      mean: c.reduce((f, p) => f + p, 0) / c.length,
      median: this.calculateMedian(c),
      p95: this.calculatePercentile(c, 0.95),
      p99: this.calculatePercentile(c, 0.99)
    };
    o && d && (h.memoryBefore = o, h.memoryAfter = d, h.memoryDelta = d - o);
    const u = {
      name: e,
      description: t,
      metrics: h,
      timestamp: Date.now(),
      environment: this.environment
    };
    return this.results.push(u), u;
  }
  /**
   * Run a throughput benchmark (operations per second)
   */
  async runThroughput(e, t, i, r = {}) {
    const { duration: n = 5e3, warmup: s = 0 } = r;
    for (let p = 0; p < s; p++)
      await i();
    globalThis.gc && globalThis.gc();
    const a = performance.now();
    let o = 0, c = 0;
    for (; performance.now() - a < n; ) {
      const p = performance.now();
      await i();
      const w = performance.now();
      o++, c += w - p;
    }
    const d = performance.now() - a, h = o / d * 1e3, u = c / o, f = {
      name: e,
      description: t,
      metrics: {
        operations: o,
        duration: d,
        opsPerSecond: h,
        avgLatency: u,
        throughput: h
      },
      timestamp: Date.now(),
      environment: this.environment
    };
    return this.results.push(f), f;
  }
  /**
   * Measure memory usage over time during an operation
   */
  async profileMemory(e, t, i, r = {}) {
    const { sampleInterval: n = 100 } = r, s = [], a = setInterval(() => {
      const u = this.getMemoryUsage();
      u !== null && s.push(u);
    }, n), o = performance.now();
    await i();
    const c = performance.now() - o;
    clearInterval(a);
    const d = {
      duration: c,
      samples: s.length,
      minMemory: Math.min(...s),
      maxMemory: Math.max(...s),
      avgMemory: s.reduce((u, f) => u + f, 0) / s.length,
      peakMemory: Math.max(...s),
      memoryGrowth: s[s.length - 1] - s[0]
    }, h = {
      name: e,
      description: t,
      metrics: d,
      timestamp: Date.now(),
      environment: this.environment
    };
    return this.results.push(h), h;
  }
  /**
   * Get current memory usage in MB
   */
  getMemoryUsage() {
    return performance.memory ? performance.memory.usedJSHeapSize / 1024 / 1024 : null;
  }
  /**
   * Calculate median of an array
   */
  calculateMedian(e) {
    const t = [...e].sort((r, n) => r - n), i = Math.floor(t.length / 2);
    return t.length % 2 === 0 ? (t[i - 1] + t[i]) / 2 : t[i];
  }
  /**
   * Calculate percentile of an array
   */
  calculatePercentile(e, t) {
    const i = [...e].sort((n, s) => n - s), r = Math.ceil(i.length * t) - 1;
    return i[Math.max(0, r)];
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
    const e = this.results.reduce(
      (t, i) => t + (i.metrics.duration || 0),
      0
    );
    return {
      name: "VectorDB Performance Benchmark",
      results: this.results,
      summary: {
        totalTests: this.results.length,
        totalDuration: e,
        environment: this.environment
      }
    };
  }
  /**
   * Format results as a readable report
   */
  formatReport() {
    const e = [];
    e.push("=".repeat(80)), e.push("VectorDB Performance Benchmark Report"), e.push("=".repeat(80)), e.push(""), e.push("Environment:"), e.push(`  Browser: ${this.environment.browser} ${this.environment.browserVersion}`), e.push(`  Platform: ${this.environment.platform}`), e.push(`  CPU Cores: ${this.environment.hardwareConcurrency}`), this.environment.deviceMemory && e.push(`  Device Memory: ${this.environment.deviceMemory} GB`), e.push("");
    for (const t of this.results) {
      e.push("-".repeat(80)), e.push(`${t.name}`), e.push(`  ${t.description}`), e.push(""), e.push("  Metrics:");
      for (const [i, r] of Object.entries(t.metrics)) {
        const n = typeof r == "number" ? r.toFixed(2) : r;
        e.push(`    ${i}: ${n}`);
      }
      e.push("");
    }
    return e.push("=".repeat(80)), e.join(`
`);
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
class vt {
  constructor(e = {}) {
    this.benchmark = new Ke(), this.config = {
      datasetSizes: [100, 1e3, 1e4],
      searchQueries: 100,
      embeddingModel: "Xenova/all-MiniLM-L6-v2",
      useRealModels: !1,
      cleanup: !0,
      ...e
    };
  }
  /**
   * Run all benchmarks
   */
  async runAll() {
    console.log(`Starting VectorDB Performance Benchmarks...
`), this.config.useRealModels && await this.benchmarkModelLoadTime(), await this.benchmarkInsertionThroughput();
    for (const e of this.config.datasetSizes)
      await this.benchmarkSearchLatency(e);
    return await this.benchmarkBatchOperations(), await this.benchmarkMemoryUsage(), await this.benchmarkCachePerformance(), console.log(`
All benchmarks complete!`), this.benchmark.getSummary();
  }
  /**
   * Benchmark 1: Model Load Time
   */
  async benchmarkModelLoadTime() {
    console.log("Running Model Load Time Benchmark...");
    const e = {
      storage: { dbName: "bench-model-load", version: 1 },
      index: { dimensions: 384, metric: "cosine", indexType: "hnsw" },
      embedding: {
        model: this.config.embeddingModel,
        device: "wasm",
        cache: !1
        // Disable cache to measure true load time
      }
    };
    await this.benchmark.run(
      "Model Load Time",
      "Time to initialize embedding model from cold start",
      async () => {
        const t = new ee(e);
        await t.initialize(), await t.dispose();
      },
      { iterations: 3, warmup: 0 }
    ), this.config.cleanup && await this.cleanupDatabase("bench-model-load");
  }
  /**
   * Benchmark 2: Insertion Throughput
   */
  async benchmarkInsertionThroughput() {
    console.log("Running Insertion Throughput Benchmark...");
    const e = await this.createTestDB("bench-insert-throughput");
    let t = 0;
    await this.benchmark.runThroughput(
      "Single Insert Throughput",
      "Number of single document insertions per second",
      async () => {
        await e.insert({
          text: `Test document ${t++}`,
          metadata: { index: t }
        });
      },
      { duration: 3e3, warmup: 10 }
    ), t = 0, await this.benchmark.runThroughput(
      "Batch Insert Throughput (100 docs)",
      "Number of batch insertions (100 docs each) per second",
      async () => {
        const i = Array.from({ length: 100 }, (r, n) => ({
          text: `Batch document ${t++}-${n}`,
          metadata: { batch: t, index: n }
        }));
        await e.insertBatch(i);
      },
      { duration: 3e3, warmup: 2 }
    ), await e.dispose(), this.config.cleanup && await this.cleanupDatabase("bench-insert-throughput");
  }
  /**
   * Benchmark 3: Search Latency for Various Dataset Sizes
   */
  async benchmarkSearchLatency(e) {
    console.log(`Running Search Latency Benchmark (${e} vectors)...`);
    const t = await this.createTestDB(`bench-search-${e}`);
    console.log(`  Inserting ${e} documents...`);
    const i = performance.now(), r = 100;
    for (let o = 0; o < e; o += r) {
      const c = Array.from(
        { length: Math.min(r, e - o) },
        (d, h) => ({
          text: this.generateTestDocument(o + h),
          metadata: {
            index: o + h,
            category: ["AI", "ML", "NLP", "CV", "RL"][Math.floor(Math.random() * 5)]
          }
        })
      );
      await t.insertBatch(c);
    }
    const n = performance.now() - i;
    console.log(`  Inserted in ${(n / 1e3).toFixed(2)}s`);
    const s = [
      "machine learning algorithms",
      "deep neural networks",
      "natural language processing",
      "computer vision techniques",
      "reinforcement learning agents"
    ];
    let a = 0;
    await this.benchmark.run(
      `Search Latency (${e} vectors)`,
      `Average search time for k=10 on ${e} vector dataset`,
      async () => {
        const o = s[a % s.length];
        a++, await t.search({ text: o, k: 10 });
      },
      { iterations: this.config.searchQueries, warmup: 5 }
    ), a = 0, await this.benchmark.run(
      `Search with Filter (${e} vectors)`,
      `Search time with metadata filter on ${e} vectors`,
      async () => {
        const o = s[a % s.length];
        a++, await t.search({
          text: o,
          k: 10,
          filter: { field: "category", operator: "eq", value: "AI" }
        });
      },
      { iterations: Math.min(50, this.config.searchQueries), warmup: 5 }
    ), await t.dispose(), this.config.cleanup && await this.cleanupDatabase(`bench-search-${e}`);
  }
  /**
   * Benchmark 4: Batch Operations
   */
  async benchmarkBatchOperations() {
    console.log("Running Batch Operations Benchmark...");
    const e = await this.createTestDB("bench-batch-ops"), t = [10, 50, 100, 500];
    for (const i of t)
      await this.benchmark.run(
        `Batch Insert (${i} docs)`,
        `Time to insert ${i} documents in a single batch`,
        async () => {
          const r = Array.from({ length: i }, (n, s) => ({
            text: `Batch document ${s}`,
            metadata: { index: s }
          }));
          await e.insertBatch(r);
        },
        { iterations: 10, warmup: 2 }
      );
    await e.dispose(), this.config.cleanup && await this.cleanupDatabase("bench-batch-ops");
  }
  /**
   * Benchmark 5: Memory Usage
   */
  async benchmarkMemoryUsage() {
    console.log("Running Memory Usage Benchmark...");
    const e = await this.createTestDB("bench-memory");
    await this.benchmark.profileMemory(
      "Memory Usage During Insertion",
      "Memory consumption while inserting 5000 documents",
      async () => {
        for (let r = 0; r < 5e3; r += 100) {
          const n = Array.from({ length: 100 }, (s, a) => ({
            text: this.generateTestDocument(r + a),
            metadata: { index: r + a }
          }));
          await e.insertBatch(n);
        }
      },
      { sampleInterval: 100 }
    ), await this.benchmark.profileMemory(
      "Memory Usage During Search",
      "Memory consumption during 100 search operations",
      async () => {
        for (let t = 0; t < 100; t++)
          await e.search({ text: "test query", k: 10 });
      },
      { sampleInterval: 50 }
    ), await e.dispose(), this.config.cleanup && await this.cleanupDatabase("bench-memory");
  }
  /**
   * Benchmark 6: Cache Performance
   */
  async benchmarkCachePerformance() {
    console.log("Running Cache Performance Benchmark...");
    const e = await this.createTestDB("bench-cache");
    await e.insertBatch(
      Array.from({ length: 1e3 }, (s, a) => ({
        text: this.generateTestDocument(a),
        metadata: { index: a }
      }))
    );
    const t = "machine learning";
    await this.benchmark.run(
      "Search (Cold Cache)",
      "Search time with empty embedding cache",
      async () => {
        e.clearCaches(), await e.search({ text: t, k: 10 });
      },
      { iterations: 10, warmup: 0 }
    ), await this.benchmark.run(
      "Search (Warm Cache)",
      "Search time with cached embeddings",
      async () => {
        await e.search({ text: t, k: 10 });
      },
      { iterations: 100, warmup: 5 }
    );
    const i = [
      "machine learning",
      "deep learning",
      "neural networks",
      "artificial intelligence",
      "data science"
    ];
    let r = 0, n = 0;
    for (let s = 0; s < 100; s++) {
      const a = i[s % i.length], o = e.getPerformanceStats();
      await e.search({ text: a, k: 10 }), e.getPerformanceStats().caches.embeddings.count > o.caches.embeddings.count ? n++ : r++;
    }
    console.log(`  Cache hit rate: ${(r / (r + n) * 100).toFixed(2)}%`), await e.dispose(), this.config.cleanup && await this.cleanupDatabase("bench-cache");
  }
  /**
   * Create a test VectorDB instance
   */
  async createTestDB(e) {
    const t = {
      storage: { dbName: e, version: 1 },
      index: { dimensions: 384, metric: "cosine", indexType: "hnsw" },
      embedding: {
        model: this.config.embeddingModel,
        device: "wasm",
        cache: !0
      },
      performance: {
        maxMemoryMB: 500,
        vectorCacheSize: 104857600,
        embeddingCacheSize: 52428800,
        enableWorkers: !1,
        lazyLoadIndex: !1,
        lazyLoadModels: !1
      }
    }, i = new ee(t);
    return await i.initialize(), i;
  }
  /**
   * Generate a test document with varied content
   */
  generateTestDocument(e) {
    const t = [
      "machine learning algorithms and optimization techniques",
      "deep neural networks for image classification",
      "natural language processing and text analysis",
      "computer vision and object detection systems",
      "reinforcement learning for autonomous agents",
      "data science and statistical modeling approaches",
      "artificial intelligence and cognitive computing",
      "predictive analytics and forecasting methods",
      "big data processing and distributed systems",
      "cloud computing and scalable architectures"
    ];
    return `${t[e % t.length]} - Document ${e}`;
  }
  /**
   * Clean up test database
   */
  async cleanupDatabase(e) {
    return new Promise((t, i) => {
      const r = indexedDB.deleteDatabase(e);
      r.onsuccess = () => t(), r.onerror = () => i(r.error), r.onblocked = () => {
        console.warn(`Database ${e} deletion blocked`), t();
      };
    });
  }
  /**
   * Get benchmark results
   */
  getResults() {
    return this.benchmark.getSummary();
  }
  /**
   * Print formatted report
   */
  printReport() {
    console.log(`
` + this.benchmark.formatReport());
  }
  /**
   * Export results as JSON
   */
  exportJSON() {
    return this.benchmark.exportJSON();
  }
}
const bt = "0.2.0";
export {
  ge as BM25Index,
  ke as BatchOptimizer,
  Ke as Benchmark,
  vt as BenchmarkRunner,
  te as CharTokenizer,
  $e as DEFAULT_LEGAL_CORPUS,
  Ge as DEFAULT_LEGAL_QUESTIONS,
  xe as DEFAULT_RETRY_CONFIG,
  E as DimensionMismatchError,
  ee as Domicile,
  et as ErrorHandler,
  ot as FallbackLLMProvider,
  Q as HnswIndex,
  P as IndexCorruptedError,
  ue as IndexedDBStorage,
  T as InputValidator,
  K as LRUCache,
  ut as MCPServer,
  ze as MemoryManager,
  X as ModelLoadError,
  me as ModelRegistry,
  We as NoopReranker,
  oe as PerformanceOptimizer,
  Ee as ProgressiveLoader,
  dt as RAGPipelineManager,
  it as ResidencyGuard,
  re as ResidencyViolationError,
  ht as SentenceChunker,
  L as StorageQuotaError,
  Y as TransformersEmbedding,
  lt as TransformersReranker,
  ct as TransformersTokenizer,
  bt as VERSION,
  ee as VectorDB,
  m as VectorDBError,
  at as WebLLMProvider,
  st as WllamaProvider,
  Ie as WorkerPool,
  nt as benchmarkCitationAccuracy,
  Ne as benchmarkIndex,
  rt as benchmarkSuite,
  tt as createDomicile,
  ie as detectCapabilities,
  fe as getModelRegistry,
  we as reciprocalRankFusion,
  F as tokenize,
  wt as useCapabilities,
  mt as useDomicile,
  yt as useIngestProgress,
  pt as useRag,
  gt as useRagStream,
  ft as useSearch
};
//# sourceMappingURL=index.js.map
