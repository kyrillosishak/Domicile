# Migration Guide

Guide for migrating between versions of Browser VectorDB.

## Version Compatibility

Browser VectorDB follows [Semantic Versioning](https://semver.org/):

- **Major versions** (1.0.0 → 2.0.0): Breaking changes
- **Minor versions** (1.0.0 → 1.1.0): New features, backward compatible
- **Patch versions** (1.0.0 → 1.0.1): Bug fixes, backward compatible

## Current Version: 1.0.0

This is the initial release. Future migration guides will be added here.

## Migrating from Pre-release

If you were using a pre-release or development version, follow these steps:

### 1. Update Package

```bash
npm install @vectordb/browser-vectordb@latest
```

### 2. Update Imports

```typescript
// Old (if using development version)
import { VectorDB } from './src/core/VectorDB';

// New
import { VectorDB } from '@vectordb/browser-vectordb';
```

### 3. Update Configuration

Configuration structure is now standardized:

```typescript
// Old (development version)
const db = new VectorDB({
  dbName: 'my-app',
  dimensions: 384,
  model: 'Xenova/all-MiniLM-L6-v2',
});

// New (v1.0.0)
const db = new VectorDB({
  storage: {
    dbName: 'my-app',
  },
  index: {
    indexType: 'hnsw',
    dimensions: 384,
    metric: 'cosine',
  },
  embedding: {
    model: 'Xenova/all-MiniLM-L6-v2',
    device: 'wasm',
  },
});
```

### 4. Update Method Calls

Some method signatures have changed:

```typescript
// Old
await db.search(query, 10);

// New
await db.search({
  text: query,
  k: 10,
});
```

### 5. Export and Re-import Data

If database schema changed:

```typescript
// Export from old version
const oldDb = new VectorDB(oldConfig);
await oldDb.initialize();
const data = await oldDb.export();

// Save backup
const json = JSON.stringify(data);
localStorage.setItem('db-backup', json);

// Clear old database
await oldDb.clear();
await oldDb.dispose();

// Import to new version
const newDb = new VectorDB(newConfig);
await newDb.initialize();
await newDb.import(data);
```

## Future Migrations

### Preparing for Future Versions

To make future migrations easier:

1. **Use the export/import API:**

```typescript
// Regular backups
const backup = await db.export();
localStorage.setItem('db-backup-' + Date.now(), JSON.stringify(backup));
```

2. **Version your data:**

```typescript
await db.insert({
  text: 'Document text',
  metadata: {
    title: 'Document',
    schemaVersion: '1.0.0',  // Track version
  },
});
```

3. **Use TypeScript:**

TypeScript will catch breaking changes at compile time.

4. **Pin versions in production:**

```json
{
  "dependencies": {
    "@vectordb/browser-vectordb": "1.0.0"  // Exact version
  }
}
```

## Breaking Changes Log

### v1.0.0 (Initial Release)

No breaking changes (initial release).

## Deprecation Policy

When features are deprecated:

1. **Deprecation warning** added in minor version
2. **Feature removed** in next major version
3. **Migration guide** provided

Example:

```typescript
// v1.5.0 - Deprecation warning
/**
 * @deprecated Use search() instead. Will be removed in v2.0.0
 */
async oldSearch(query: string): Promise<SearchResult[]> {
  console.warn('oldSearch() is deprecated. Use search() instead.');
  return this.search({ text: query, k: 10 });
}

// v2.0.0 - Removed
// oldSearch() no longer available
```

## Data Migration

### Export Data

Always export data before major version upgrades:

```typescript
async function exportDatabase(db: VectorDB, filename: string) {
  const data = await db.export();
  const json = JSON.stringify(data, null, 2);
  
  // Browser download
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

await exportDatabase(db, 'vectordb-backup.json');
```

### Import Data

Import data to new version:

```typescript
async function importDatabase(db: VectorDB, file: File) {
  const text = await file.text();
  const data = JSON.parse(text);
  
  // Validate version compatibility
  if (data.version !== '1.0.0') {
    console.warn('Data from different version:', data.version);
  }
  
  await db.import(data);
}

const fileInput = document.getElementById('fileInput') as HTMLInputElement;
const file = fileInput.files[0];
await importDatabase(db, file);
```

### Transform Data

If schema changes between versions:

```typescript
async function migrateData(oldData: ExportData): Promise<ExportData> {
  // Transform data structure
  const newData = {
    ...oldData,
    version: '2.0.0',
    vectors: oldData.vectors.map(v => ({
      ...v,
      metadata: {
        ...v.metadata,
        // Add new required field
        schemaVersion: '2.0.0',
      },
    })),
  };
  
  return newData;
}

// Export from old version
const oldData = await oldDb.export();

// Transform
const newData = await migrateData(oldData);

// Import to new version
await newDb.import(newData);
```

## Testing Migrations

### Test Before Production

Always test migrations in development:

```typescript
async function testMigration() {
  // 1. Create test database with old version
  const oldDb = new VectorDB(oldConfig);
  await oldDb.initialize();
  
  // 2. Add test data
  await oldDb.insertBatch([
    { text: 'Test 1', metadata: { id: 1 } },
    { text: 'Test 2', metadata: { id: 2 } },
  ]);
  
  // 3. Export
  const data = await oldDb.export();
  await oldDb.dispose();
  
  // 4. Import to new version
  const newDb = new VectorDB(newConfig);
  await newDb.initialize();
  await newDb.import(data);
  
  // 5. Verify data
  const count = await newDb.size();
  console.assert(count === 2, 'Data count mismatch');
  
  const results = await newDb.search({ text: 'Test', k: 10 });
  console.assert(results.length === 2, 'Search results mismatch');
  
  console.log('✓ Migration test passed');
  await newDb.dispose();
}

await testMigration();
```

### Rollback Plan

Always have a rollback plan:

```typescript
async function rollback(backupData: ExportData) {
  // 1. Clear current database
  await db.clear();
  
  // 2. Restore from backup
  await db.import(backupData);
  
  console.log('✓ Rolled back to backup');
}

// Keep backup
const backup = await db.export();

try {
  // Attempt migration
  await migrate();
} catch (error) {
  console.error('Migration failed:', error);
  await rollback(backup);
}
```

## Version-Specific Guides

### Migrating to v2.0.0 (Future)

*This section will be updated when v2.0.0 is released.*

### Migrating to v3.0.0 (Future)

*This section will be updated when v3.0.0 is released.*

## Best Practices

### 1. Regular Backups

```typescript
// Backup weekly
setInterval(async () => {
  const backup = await db.export();
  const json = JSON.stringify(backup);
  localStorage.setItem('db-backup-weekly', json);
}, 7 * 24 * 60 * 60 * 1000);
```

### 2. Version Tracking

```typescript
// Track version in metadata
await db.insert({
  text: 'Document',
  metadata: {
    title: 'Document',
    appVersion: '1.0.0',
    dbVersion: '1.0.0',
    createdAt: Date.now(),
  },
});
```

### 3. Gradual Migration

```typescript
// Migrate in batches
async function migrateInBatches(oldDb: VectorDB, newDb: VectorDB, batchSize = 100) {
  const total = await oldDb.size();
  let migrated = 0;
  
  while (migrated < total) {
    // Export batch
    const results = await oldDb.search({
      text: '',
      k: batchSize,
    });
    
    // Transform and import
    const documents = results.map(r => ({
      text: r.metadata.content,
      metadata: r.metadata,
    }));
    
    await newDb.insertBatch(documents);
    
    // Delete from old
    await Promise.all(results.map(r => oldDb.delete(r.id)));
    
    migrated += results.length;
    console.log(`Migrated ${migrated}/${total}`);
  }
}
```

### 4. Validation

```typescript
// Validate after migration
async function validateMigration(oldDb: VectorDB, newDb: VectorDB) {
  const oldCount = await oldDb.size();
  const newCount = await newDb.size();
  
  if (oldCount !== newCount) {
    throw new Error(`Count mismatch: ${oldCount} vs ${newCount}`);
  }
  
  // Sample check
  const oldResults = await oldDb.search({ text: 'test', k: 10 });
  const newResults = await newDb.search({ text: 'test', k: 10 });
  
  if (oldResults.length !== newResults.length) {
    throw new Error('Search results mismatch');
  }
  
  console.log('✓ Migration validated');
}
```

## Support

### Getting Help

- **Documentation**: [Full Docs](../README.md)
- **Issues**: [GitHub Issues](https://github.com/your-repo/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-repo/discussions)

### Reporting Migration Issues

When reporting migration issues, include:

1. Old version number
2. New version number
3. Error messages
4. Migration steps taken
5. Sample data (if possible)

## Changelog

See [CHANGELOG.md](../CHANGELOG.md) for detailed version history.

## Next Steps

- **[API Reference](./API.md)** - Complete API documentation
- **[Troubleshooting](./TROUBLESHOOTING.md)** - Common issues
- **[Examples](../examples/README.md)** - Code examples

---

Questions about migration? [Open a discussion](https://github.com/your-repo/discussions).
