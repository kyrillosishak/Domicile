# Troubleshooting Guide

Common issues and solutions for Browser VectorDB.

## Table of Contents

- [Installation Issues](#installation-issues)
- [Initialization Problems](#initialization-problems)
- [Model Loading Issues](#model-loading-issues)
- [Search Problems](#search-problems)
- [Storage Issues](#storage-issues)
- [Performance Problems](#performance-problems)
- [Browser Compatibility](#browser-compatibility)
- [Error Messages](#error-messages)

---

## Installation Issues

### NPM Install Fails

**Problem:** `npm install` fails with dependency errors

**Solutions:**

```bash
# Clear npm cache
npm cache clean --force

# Delete node_modules and package-lock.json
rm -rf node_modules package-lock.json

# Reinstall
npm install

# Or use specific version
npm install @vectordb/browser-vectordb@latest
```

### TypeScript Errors

**Problem:** TypeScript compilation errors

**Solution:**

Ensure you have compatible TypeScript version:

```bash
npm install --save-dev typescript@^5.0.0
```

Update `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020", "DOM"],
    "moduleResolution": "node",
    "esModuleInterop": true
  }
}
```

---

## Initialization Problems

### Database Won't Initialize

**Problem:** `db.initialize()` hangs or fails

**Symptoms:**
```typescript
await db.initialize();  // Never completes
```

**Solutions:**

1. **Check browser support:**

```typescript
// Check IndexedDB support
if (!('indexedDB' in window)) {
  console.error('IndexedDB not supported');
}

// Check WebAssembly support
if (!('WebAssembly' in window)) {
  console.error('WebAssembly not supported');
}
```

2. **Check network connection:**

Models need to download on first use. Check browser console for network errors.

3. **Clear IndexedDB:**

```typescript
// Delete existing database
const request = indexedDB.deleteDatabase('my-app');
request.onsuccess = () => console.log('Database deleted');
```

4. **Add timeout:**

```typescript
const timeout = new Promise((_, reject) => 
  setTimeout(() => reject(new Error('Initialization timeout')), 30000)
);

try {
  await Promise.race([db.initialize(), timeout]);
} catch (error) {
  console.error('Initialization failed:', error);
}
```

### Initialization Slow

**Problem:** First initialization takes too long

**Cause:** Model download (23-150MB depending on model)

**Solutions:**

1. **Use smaller model:**

```typescript
embedding: {
  model: 'Xenova/all-MiniLM-L6-v2',  // 23MB (fast)
  // vs 'Xenova/bge-base-en-v1.5'    // 109MB (slow)
}
```

2. **Show loading indicator:**

```typescript
console.log('Loading model... (this may take a minute on first load)');
await db.initialize();
console.log('Ready!');
```

3. **Pre-load on app start:**

```typescript
// Start loading early
const initPromise = db.initialize();

// Do other setup
// ...

// Wait for completion
await initPromise;
```

---

## Model Loading Issues

### Model Download Fails

**Problem:** Model fails to download

**Error:** `Failed to load model: network error`

**Solutions:**

1. **Check network connection:**

```typescript
if (!navigator.onLine) {
  console.error('No internet connection');
}
```

2. **Use CDN:**

Models are cached after first download. Ensure CDN is accessible.

3. **Retry logic:**

```typescript
async function initializeWithRetry(maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await db.initialize();
      return;
    } catch (error) {
      console.log(`Retry ${i + 1}/${maxRetries}`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  throw new Error('Failed to initialize after retries');
}
```

### Model Not Cached

**Problem:** Model downloads every time

**Solution:**

Enable caching:

```typescript
embedding: {
  model: 'Xenova/all-MiniLM-L6-v2',
  cache: true,  // Enable caching
}
```

Check IndexedDB quota:

```typescript
if (navigator.storage && navigator.storage.estimate) {
  const estimate = await navigator.storage.estimate();
  console.log('Storage:', {
    usage: (estimate.usage / 1024 / 1024).toFixed(2) + 'MB',
    quota: (estimate.quota / 1024 / 1024).toFixed(2) + 'MB',
  });
}
```

### WebGPU Not Available

**Problem:** WebGPU device not found

**Error:** `WebGPU not supported`

**Solution:**

Fall back to WASM:

```typescript
const hasWebGPU = 'gpu' in navigator;

embedding: {
  model: 'Xenova/all-MiniLM-L6-v2',
  device: hasWebGPU ? 'webgpu' : 'wasm',
}
```

Check browser support:
- Chrome/Edge 113+
- Firefox: Not yet supported
- Safari: Not yet supported

---

## Search Problems

### No Results Returned

**Problem:** Search returns empty array

**Causes:**
1. Database is empty
2. Query doesn't match any documents
3. Filters are too restrictive

**Solutions:**

1. **Check database size:**

```typescript
const count = await db.size();
console.log(`Database contains ${count} documents`);

if (count === 0) {
  console.log('Database is empty - insert documents first');
}
```

2. **Test without filters:**

```typescript
// Try without filter
const results = await db.search({ text: query, k: 10 });

// Then add filter
const filtered = await db.search({
  text: query,
  k: 10,
  filter: { field: 'category', operator: 'eq', value: 'tech' },
});
```

3. **Check filter values:**

```typescript
// List unique values
const allDocs = await db.search({ text: '', k: 1000 });
const categories = new Set(allDocs.map(d => d.metadata.category));
console.log('Available categories:', Array.from(categories));
```

### Poor Search Quality

**Problem:** Search returns irrelevant results

**Solutions:**

1. **Use better embedding model:**

```typescript
// Better quality
embedding: { model: 'Xenova/bge-small-en-v1.5' }

// vs basic model
embedding: { model: 'Xenova/all-MiniLM-L6-v2' }
```

2. **Increase result count:**

```typescript
// Get more results to find relevant ones
const results = await db.search({ text: query, k: 20 });
```

3. **Add metadata filters:**

```typescript
const results = await db.search({
  text: query,
  k: 10,
  filter: {
    field: 'category',
    operator: 'eq',
    value: 'relevant-category',
  },
});
```

4. **Improve document quality:**

```typescript
// ✅ Good - Descriptive text
await db.insert({
  text: 'Machine learning is a subset of AI that enables computers to learn from data',
  metadata: { title: 'ML Introduction' },
});

// ❌ Bad - Too short
await db.insert({
  text: 'ML',
  metadata: { title: 'ML' },
});
```

### Dimension Mismatch Error

**Problem:** `DimensionMismatchError: expected 384, got 768`

**Cause:** Vector dimensions don't match index configuration

**Solution:**

Ensure dimensions match:

```typescript
// Model outputs 384 dimensions
embedding: { model: 'Xenova/all-MiniLM-L6-v2' }

// Index must match
index: { dimensions: 384 }

// NOT 768 or other values
```

---

## Storage Issues

### Storage Quota Exceeded

**Problem:** `StorageQuotaError: Storage quota exceeded`

**Solutions:**

1. **Check quota:**

```typescript
if (navigator.storage && navigator.storage.estimate) {
  const estimate = await navigator.storage.estimate();
  const usagePercent = (estimate.usage / estimate.quota * 100).toFixed(1);
  console.log(`Storage: ${usagePercent}% used`);
}
```

2. **Export and clear:**

```typescript
// Export data
const backup = await db.export();
const json = JSON.stringify(backup);
localStorage.setItem('db-backup', json);

// Clear database
await db.clear();

// Or delete old documents
const oldDocs = await db.search({
  text: '',
  k: 1000,
  filter: {
    field: 'timestamp',
    operator: 'lt',
    value: Date.now() - 30 * 86400000,  // Older than 30 days
  },
});

for (const doc of oldDocs) {
  await db.delete(doc.id);
}
```

3. **Request persistent storage:**

```typescript
if (navigator.storage && navigator.storage.persist) {
  const persistent = await navigator.storage.persist();
  console.log('Persistent storage:', persistent);
}
```

### IndexedDB Errors

**Problem:** IndexedDB operations fail

**Error:** `InvalidStateError`, `TransactionInactiveError`

**Solutions:**

1. **Check browser support:**

```typescript
if (!('indexedDB' in window)) {
  console.error('IndexedDB not supported');
  // Use fallback or show error
}
```

2. **Close and reopen:**

```typescript
await db.dispose();
await db.initialize();
```

3. **Delete corrupted database:**

```typescript
const request = indexedDB.deleteDatabase('my-app');
request.onsuccess = () => {
  console.log('Database deleted');
  // Reinitialize
};
```

### Data Corruption

**Problem:** `IndexCorruptedError: Index data is corrupted`

**Solution:**

Rebuild index:

```typescript
try {
  await db.initialize();
} catch (error) {
  if (error instanceof IndexCorruptedError) {
    console.log('Rebuilding index...');
    await db.rebuildIndex();
  }
}
```

---

## Performance Problems

### Slow Search

**Problem:** Search takes too long (>1 second)

**Solutions:**

1. **Enable WebGPU:**

```typescript
embedding: { device: 'webgpu' }
```

2. **Reduce dataset size:**

```typescript
// Archive old data
const oldDocs = await db.search({
  text: '',
  k: 10000,
  filter: {
    field: 'timestamp',
    operator: 'lt',
    value: Date.now() - 90 * 86400000,
  },
});

const archived = await db.export();
// Save archived data
await Promise.all(oldDocs.map(d => db.delete(d.id)));
```

3. **Use metadata filters:**

```typescript
// Filter early
const results = await db.search({
  text: query,
  k: 10,
  filter: { field: 'category', operator: 'eq', value: 'tech' },
});
```

4. **Reduce result count:**

```typescript
// Only get what you need
const results = await db.search({ text: query, k: 5 });
```

### High Memory Usage

**Problem:** Browser uses too much memory

**Solutions:**

1. **Implement LRU cache:**

```typescript
import { LRUCache } from '@vectordb/browser-vectordb';

const cache = new LRUCache({
  max: 1000,
  maxSize: 100 * 1024 * 1024,  // 100MB
});
```

2. **Use progressive loading:**

```typescript
import { ProgressiveLoader } from '@vectordb/browser-vectordb';

const loader = new ProgressiveLoader(db);
for await (const chunk of loader.loadVectorsInChunks(1000)) {
  // Process chunk
}
```

3. **Dispose when done:**

```typescript
await db.dispose();
```

### Slow Insertion

**Problem:** Inserting documents is slow

**Solutions:**

1. **Use batch operations:**

```typescript
// ✅ Fast
await db.insertBatch(documents);

// ❌ Slow
for (const doc of documents) {
  await db.insert(doc);
}
```

2. **Pre-compute embeddings:**

```typescript
const texts = documents.map(d => d.text);
const vectors = await db.embedding.embedBatch(texts);

const records = documents.map((doc, i) => ({
  vector: vectors[i],
  metadata: doc.metadata,
}));

await db.insertBatch(records);
```

---

## Browser Compatibility

### Safari Issues

**Problem:** Features not working in Safari

**Known Issues:**
- WebGPU not supported
- SharedArrayBuffer requires specific headers

**Solutions:**

1. **Use WASM:**

```typescript
embedding: { device: 'wasm' }
```

2. **Check feature support:**

```typescript
const features = {
  indexedDB: 'indexedDB' in window,
  webAssembly: 'WebAssembly' in window,
  webGPU: 'gpu' in navigator,
  sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
};

console.log('Browser features:', features);
```

### Firefox Issues

**Problem:** WebGPU not available

**Solution:**

Firefox doesn't support WebGPU yet. Use WASM:

```typescript
embedding: { device: 'wasm' }
```

### Mobile Browser Issues

**Problem:** Performance issues on mobile

**Solutions:**

1. **Use smaller models:**

```typescript
embedding: { model: 'Xenova/all-MiniLM-L6-v2' }  // 23MB
```

2. **Reduce dataset size:**

```typescript
storage: { maxVectors: 10000 }
```

3. **Limit operations:**

```typescript
// Smaller batches
const batchSize = 50;  // vs 100 on desktop
```

---

## Error Messages

### Common Errors

#### `VectorDBError: Database not initialized`

**Cause:** Calling methods before `initialize()`

**Solution:**

```typescript
await db.initialize();  // Must call first
await db.insert(data);  // Then use
```

#### `DimensionMismatchError`

**Cause:** Vector dimensions don't match

**Solution:**

```typescript
// Ensure dimensions match
embedding: { model: 'Xenova/all-MiniLM-L6-v2' }  // 384d
index: { dimensions: 384 }  // Must match
```

#### `StorageQuotaError`

**Cause:** IndexedDB quota exceeded

**Solution:**

```typescript
const backup = await db.export();
await db.clear();
```

#### `ModelLoadError`

**Cause:** Failed to load embedding model

**Solution:**

```typescript
// Check network
if (!navigator.onLine) {
  console.error('No internet connection');
}

// Retry
await db.initialize();
```

#### `IndexCorruptedError`

**Cause:** Index data is corrupted

**Solution:**

```typescript
await db.rebuildIndex();
```

---

## Getting Help

### Debug Mode

Enable verbose logging:

```typescript
const db = new VectorDB({
  storage: { dbName: 'my-app' },
  index: { indexType: 'hnsw', dimensions: 384, metric: 'cosine' },
  embedding: { model: 'Xenova/all-MiniLM-L6-v2', device: 'wasm' },
  debug: true,  // Enable debug logging
});
```

### Collect Diagnostics

```typescript
async function collectDiagnostics() {
  const diagnostics = {
    browser: navigator.userAgent,
    features: {
      indexedDB: 'indexedDB' in window,
      webAssembly: 'WebAssembly' in window,
      webGPU: 'gpu' in navigator,
    },
    storage: await navigator.storage?.estimate(),
    dbSize: await db.size(),
    memory: performance.memory ? {
      used: performance.memory.usedJSHeapSize,
      total: performance.memory.totalJSHeapSize,
    } : null,
  };

  console.log('Diagnostics:', diagnostics);
  return diagnostics;
}
```

### Report Issues

When reporting issues, include:

1. Browser and version
2. Error message and stack trace
3. Minimal reproduction code
4. Diagnostics output

**GitHub Issues:** [Report Issue](https://github.com/your-repo/issues)

---

## Next Steps

- **[API Reference](./API.md)** - Complete API documentation
- **[Performance Guide](./PERFORMANCE.md)** - Optimization tips
- **[Examples](../examples/README.md)** - Code examples
- **[FAQ](./FAQ.md)** - Frequently asked questions

---

Still having issues? [Open an issue](https://github.com/your-repo/issues) or [start a discussion](https://github.com/your-repo/discussions).
