# Data Export and Import

This guide covers how to export and import data from the VectorDB, including best practices for handling large datasets, progress tracking, and data validation.

## Overview

The VectorDB provides comprehensive export and import functionality that allows you to:

- Export your entire database to a portable JSON format
- Import data from exported files
- Track progress during export/import operations
- Validate data integrity and schema compatibility
- Handle large datasets efficiently with streaming
- Preserve all vectors, metadata, and index structures

## Basic Export

Export the entire database to a portable format:

```typescript
import { VectorDB } from '@vectordb/browser-vectordb';

const db = new VectorDB({
  storage: { dbName: 'my-db' },
  index: { dimensions: 384, metric: 'cosine', indexType: 'hnsw' },
  embedding: { model: 'Xenova/all-MiniLM-L6-v2', device: 'wasm' },
});

await db.initialize();

// Export database
const exportData = await db.export();

// Save to file (Node.js)
import fs from 'fs';
fs.writeFileSync('database-backup.json', JSON.stringify(exportData));

// Save to localStorage (Browser)
localStorage.setItem('db-backup', JSON.stringify(exportData));
```

## Export with Progress Tracking

Track export progress for large datasets:

```typescript
const exportData = await db.export({
  onProgress: (loaded, total) => {
    const percent = Math.round((loaded / total) * 100);
    console.log(`Export progress: ${loaded}/${total} (${percent}%)`);
    
    // Update UI progress bar
    updateProgressBar(percent);
  },
});
```

## Export Options

### Include/Exclude Index

You can choose whether to include the index in the export. Excluding the index reduces file size but requires rebuilding the index on import:

```typescript
// Export without index (smaller file size)
const lightExport = await db.export({
  includeIndex: false,
});

// Export with index (faster import)
const fullExport = await db.export({
  includeIndex: true, // default
});
```

**Trade-offs:**
- **With index**: Larger file size, faster import (no rebuild needed)
- **Without index**: Smaller file size, slower import (index must be rebuilt)

## Basic Import

Import data from an exported file:

```typescript
// Load from file (Node.js)
import fs from 'fs';
const exportData = JSON.parse(fs.readFileSync('database-backup.json', 'utf-8'));

// Load from localStorage (Browser)
const exportData = JSON.parse(localStorage.getItem('db-backup')!);

// Import data
await db.import(exportData);
```

## Import with Progress Tracking

Track import progress for large datasets:

```typescript
await db.import(exportData, {
  onProgress: (loaded, total) => {
    const percent = Math.round((loaded / total) * 100);
    console.log(`Import progress: ${loaded}/${total} (${percent}%)`);
    
    // Update UI progress bar
    updateProgressBar(percent);
  },
});
```

## Import Options

### Schema Validation

Enable or disable schema validation during import:

```typescript
// With validation (default, recommended)
await db.import(exportData, {
  validateSchema: true,
});

// Without validation (faster, but risky)
await db.import(exportData, {
  validateSchema: false,
});
```

### Clear Existing Data

Choose whether to clear existing data before import:

```typescript
// Clear existing data (default)
await db.import(exportData, {
  clearExisting: true,
});

// Merge with existing data
await db.import(exportData, {
  clearExisting: false,
});
```

## Export Data Format

The export format is a JSON object with the following structure:

```typescript
interface ExportData {
  version: string;              // Schema version (e.g., "1.0.0")
  config: VectorDBConfig;       // Database configuration
  vectors: Array<{              // All vector records
    id: string;
    vector: number[];           // Float32Array converted to array
    metadata: Record<string, any>;
    timestamp: number;
  }>;
  index: string;                // Serialized index (empty if not included)
  metadata: {
    exportedAt: number;         // Export timestamp
    vectorCount: number;        // Total number of vectors
    dimensions: number;         // Vector dimensions
  };
}
```

## Data Validation

The import process validates:

1. **Schema Structure**: Ensures all required fields are present
2. **Version Compatibility**: Checks for compatible version numbers
3. **Dimension Consistency**: Validates all vectors have correct dimensions
4. **Vector Count**: Ensures vector count matches metadata
5. **Individual Records**: Validates each vector record structure

### Version Compatibility

The system uses semantic versioning:

- **Major version mismatch**: Import will fail (incompatible)
- **Minor version difference**: Import will succeed with warning
- **Patch version difference**: Import will succeed silently

```typescript
// Current version: 1.0.0

// Compatible versions:
// - 1.0.0 ✓
// - 1.1.0 ✓ (with warning)
// - 1.0.1 ✓

// Incompatible versions:
// - 2.0.0 ✗ (major version mismatch)
// - 0.9.0 ✗ (major version mismatch)
```

## Error Handling

Handle common import errors:

```typescript
try {
  await db.import(exportData);
} catch (error) {
  if (error.code === 'DIMENSION_MISMATCH') {
    console.error('Vector dimensions do not match database configuration');
  } else if (error.code === 'VERSION_INCOMPATIBLE') {
    console.error('Export data version is incompatible');
  } else if (error.code === 'INVALID_EXPORT_DATA') {
    console.error('Export data format is invalid');
  } else if (error.code === 'STORAGE_QUOTA_EXCEEDED') {
    console.error('Not enough storage space for import');
  } else {
    console.error('Import failed:', error.message);
  }
}
```

## Large Dataset Handling

For very large datasets, the export/import process uses progressive loading to prevent memory exhaustion:

### Automatic Chunking

The system automatically processes data in chunks:

```typescript
const db = new VectorDB({
  // ... other config
  performance: {
    chunkSize: 100, // Process 100 records at a time
  },
});

// Export and import will automatically use chunking
const exportData = await db.export({
  onProgress: (loaded, total) => {
    console.log(`Processing: ${loaded}/${total}`);
  },
});
```

### Memory Management

The system manages memory efficiently during export/import:

- Vectors are processed in batches
- IndexedDB transactions are optimized
- Caches are cleared as needed
- Progress callbacks allow UI updates without blocking

## Best Practices

### 1. Regular Backups

Create regular backups of your database:

```typescript
// Daily backup
setInterval(async () => {
  const exportData = await db.export();
  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `backup-${timestamp}.json`;
  
  // Save backup
  saveToStorage(filename, exportData);
}, 24 * 60 * 60 * 1000); // Every 24 hours
```

### 2. Compression

Compress export data to reduce storage:

```typescript
// Using pako for gzip compression
import pako from 'pako';

const exportData = await db.export();
const json = JSON.stringify(exportData);
const compressed = pako.gzip(json);

// Save compressed data
fs.writeFileSync('backup.json.gz', compressed);

// Decompress and import
const compressedData = fs.readFileSync('backup.json.gz');
const decompressed = pako.ungzip(compressedData, { to: 'string' });
const importData = JSON.parse(decompressed);
await db.import(importData);
```

### 3. Incremental Backups

For large databases, consider incremental backups:

```typescript
// Export only new/modified records since last backup
const lastBackupTime = getLastBackupTimestamp();

// Filter vectors by timestamp
const allRecords = await db.export();
const incrementalData = {
  ...allRecords,
  vectors: allRecords.vectors.filter(v => v.timestamp > lastBackupTime),
};

// Save incremental backup
saveIncrementalBackup(incrementalData);
```

### 4. Validation Before Import

Always validate export data before importing:

```typescript
function validateExportData(data: any): boolean {
  if (!data.version || !data.vectors || !data.metadata) {
    return false;
  }
  
  if (data.vectors.length !== data.metadata.vectorCount) {
    return false;
  }
  
  // Additional validation...
  return true;
}

if (validateExportData(exportData)) {
  await db.import(exportData);
} else {
  console.error('Invalid export data');
}
```

### 5. Progress Feedback

Provide user feedback during long operations:

```typescript
// Show progress modal
showProgressModal('Exporting database...');

const exportData = await db.export({
  onProgress: (loaded, total) => {
    updateProgressModal(loaded, total);
  },
});

hideProgressModal();
```

## Migration Between Databases

Migrate data from one database to another:

```typescript
// Export from source database
const sourceDb = new VectorDB({
  storage: { dbName: 'source-db' },
  index: { dimensions: 384, metric: 'cosine', indexType: 'hnsw' },
  embedding: { model: 'Xenova/all-MiniLM-L6-v2', device: 'wasm' },
});

await sourceDb.initialize();
const exportData = await sourceDb.export();
await sourceDb.dispose();

// Import to target database
const targetDb = new VectorDB({
  storage: { dbName: 'target-db' },
  index: { dimensions: 384, metric: 'cosine', indexType: 'hnsw' },
  embedding: { model: 'Xenova/all-MiniLM-L6-v2', device: 'wasm' },
});

await targetDb.initialize();
await targetDb.import(exportData);
await targetDb.dispose();
```

## Cross-Browser Compatibility

Export data is portable across browsers:

```typescript
// Export in Chrome
const exportData = await db.export();
const json = JSON.stringify(exportData);

// Transfer to Firefox (via file, cloud storage, etc.)
// ...

// Import in Firefox
const importData = JSON.parse(json);
await db.import(importData);
```

## Performance Considerations

### Export Performance

- **Small datasets (<1,000 vectors)**: ~100-500ms
- **Medium datasets (1,000-10,000 vectors)**: ~500ms-2s
- **Large datasets (10,000-100,000 vectors)**: ~2s-20s

### Import Performance

- **With index**: Faster (no rebuild needed)
- **Without index**: Slower (index must be rebuilt)
- **Validation enabled**: Slightly slower but safer
- **Validation disabled**: Faster but risky

### Optimization Tips

1. **Disable validation for trusted data**: Skip validation if you control the export source
2. **Export without index for backups**: Reduce file size for long-term storage
3. **Use compression**: Reduce storage and transfer costs
4. **Batch operations**: Process multiple imports/exports together
5. **Monitor progress**: Provide feedback to prevent user confusion

## Troubleshooting

### Import Fails with "Dimension Mismatch"

**Problem**: Vector dimensions don't match database configuration

**Solution**: Ensure the target database has the same dimensions as the source:

```typescript
// Check dimensions before import
if (exportData.metadata.dimensions !== config.index.dimensions) {
  console.error('Dimension mismatch!');
  // Either reconfigure database or reject import
}
```

### Import Fails with "Storage Quota Exceeded"

**Problem**: Not enough storage space

**Solution**: Clear old data or request more storage:

```typescript
// Check available storage
if (navigator.storage && navigator.storage.estimate) {
  const estimate = await navigator.storage.estimate();
  const available = estimate.quota! - estimate.usage!;
  console.log(`Available storage: ${available} bytes`);
}

// Request persistent storage
if (navigator.storage && navigator.storage.persist) {
  const persistent = await navigator.storage.persist();
  console.log(`Persistent storage: ${persistent}`);
}
```

### Index Deserialization Fails

**Problem**: Corrupted index data

**Solution**: The system automatically rebuilds the index:

```typescript
// Import will automatically rebuild index if deserialization fails
await db.import(exportData); // Index rebuilt automatically
```

## See Also

- [API Reference](./API.md)
- [Performance Optimization](./PERFORMANCE.md)
- [Storage Management](./STORAGE.md)
- [Error Handling](./ERRORS.md)
