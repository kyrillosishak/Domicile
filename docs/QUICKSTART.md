# Quickstart Guide

Get started with Domicile in 5 minutes. This guide covers installation, basic setup, and common operations.

## Installation

### NPM

```bash
npm install domicile
```

### CDN (ES Modules)

```html
<script type="module">
  import { VectorDB } from 'https://cdn.jsdelivr.net/npm/domicile@latest/dist/index.js';
</script>
```

## Basic Setup

### 1. Create a Database

```typescript
import { VectorDB } from 'domicile';

const db = new VectorDB({
  storage: {
    dbName: 'my-app',              // Your app name
  },
  index: {
    indexType: 'hnsw',           // Index type
    dimensions: 384,               // Must match embedding model
    metric: 'cosine',              // Distance metric
  },
  embedding: {
    model: 'Xenova/all-MiniLM-L6-v2',  // HuggingFace model
    device: 'wasm',                     // 'wasm' or 'webgpu'
    cache: true,                        // Cache model locally
  },
});
```

### 2. Initialize

```typescript
await db.initialize();
console.log('Database ready!');
```

## Core Operations

### Insert Documents

```typescript
// Single document
const id = await db.insert({
  text: 'Machine learning is a subset of artificial intelligence',
  metadata: {
    title: 'ML Introduction',
    category: 'tech',
    tags: ['AI', 'ML'],
  },
});

console.log('Inserted:', id);
```

### Batch Insert

```typescript
const documents = [
  {
    text: 'Python is a popular programming language',
    metadata: { category: 'programming' },
  },
  {
    text: 'JavaScript runs in the browser',
    metadata: { category: 'programming' },
  },
  {
    text: 'Neural networks mimic the human brain',
    metadata: { category: 'AI' },
  },
];

const ids = await db.insertBatch(documents);
console.log(`Inserted ${ids.length} documents`);
```

### Search

```typescript
// Basic search
const results = await db.search({
  text: 'artificial intelligence',
  k: 5,  // Return top 5 results
});

results.forEach(result => {
  console.log(`Score: ${result.score.toFixed(3)}`);
  console.log(`Title: ${result.metadata.title}`);
  console.log(`Text: ${result.metadata.content}`);
  console.log('---');
});
```

### Search with Filters

```typescript
// Filter by category
const techResults = await db.search({
  text: 'programming',
  k: 10,
  filter: {
    field: 'category',
    operator: 'eq',
    value: 'tech',
  },
});

// Filter by date range
const recentResults = await db.search({
  text: 'latest news',
  k: 10,
  filter: {
    field: 'timestamp',
    operator: 'gte',
    value: Date.now() - 86400000,  // Last 24 hours
  },
});

// Filter by tags
const taggedResults = await db.search({
  text: 'tutorials',
  k: 10,
  filter: {
    field: 'tags',
    operator: 'contains',
    value: 'beginner',
  },
});
```

### Update Documents

```typescript
await db.update(id, {
  metadata: {
    category: 'updated-category',
    lastModified: Date.now(),
  },
});
```

### Delete Documents

```typescript
const deleted = await db.delete(id);
if (deleted) {
  console.log('Document deleted');
}
```

### Get Database Size

```typescript
const count = await db.size();
console.log(`Database contains ${count} documents`);
```

### Clear Database

```typescript
await db.clear();
console.log('Database cleared');
```

## Complete Example

Here's a complete working example:

```typescript
import { VectorDB } from 'domicile';

async function main() {
  // 1. Create and initialize database
  const db = new VectorDB({
    storage: { dbName: 'quickstart-demo' },
    index: { indexType: 'hnsw', dimensions: 384, metric: 'cosine' },
    embedding: { model: 'Xenova/all-MiniLM-L6-v2', device: 'wasm' },
  });

  await db.initialize();
  console.log('✓ Database initialized');

  // 2. Insert documents
  const documents = [
    {
      text: 'The quick brown fox jumps over the lazy dog',
      metadata: { category: 'examples', type: 'sentence' },
    },
    {
      text: 'Machine learning enables computers to learn from data',
      metadata: { category: 'tech', type: 'definition' },
    },
    {
      text: 'JavaScript is the language of the web',
      metadata: { category: 'programming', type: 'fact' },
    },
    {
      text: 'Neural networks are inspired by biological neurons',
      metadata: { category: 'AI', type: 'explanation' },
    },
  ];

  const ids = await db.insertBatch(documents);
  console.log(`✓ Inserted ${ids.length} documents`);

  // 3. Search
  const results = await db.search({
    text: 'computer learning',
    k: 2,
  });

  console.log('\n🔍 Search Results:');
  results.forEach((result, i) => {
    console.log(`\n${i + 1}. Score: ${result.score.toFixed(3)}`);
    console.log(`   Category: ${result.metadata.category}`);
    console.log(`   Text: ${result.metadata.content}`);
  });

  // 4. Filtered search
  const techResults = await db.search({
    text: 'programming',
    k: 5,
    filter: {
      field: 'category',
      operator: 'eq',
      value: 'tech',
    },
  });

  console.log(`\n✓ Found ${techResults.length} tech documents`);

  // 5. Database stats
  const size = await db.size();
  console.log(`\n📊 Database contains ${size} documents`);

  // 6. Clean up
  await db.dispose();
  console.log('\n✓ Database disposed');
}

main().catch(console.error);
```

## Browser Usage

### HTML Example

```html
<!DOCTYPE html>
<html>
<head>
  <title>VectorDB Demo</title>
</head>
<body>
  <h1>Semantic Search Demo</h1>
  
  <input type="text" id="query" placeholder="Search...">
  <button onclick="search()">Search</button>
  
  <div id="results"></div>

  <script type="module">
    import { VectorDB } from 'https://cdn.jsdelivr.net/npm/domicile@latest/dist/index.js';

    let db;

    async function init() {
      db = new VectorDB({
        storage: { dbName: 'demo' },
        index: { indexType: 'hnsw', dimensions: 384, metric: 'cosine' },
        embedding: { model: 'Xenova/all-MiniLM-L6-v2', device: 'wasm' },
      });

      await db.initialize();
      console.log('Database ready');

      // Insert sample documents
      await db.insertBatch([
        { text: 'Machine learning tutorial', metadata: { title: 'ML Guide' } },
        { text: 'JavaScript basics', metadata: { title: 'JS 101' } },
        { text: 'Python programming', metadata: { title: 'Python Guide' } },
      ]);
    }

    window.search = async function() {
      const query = document.getElementById('query').value;
      const results = await db.search({ text: query, k: 5 });
      
      const resultsDiv = document.getElementById('results');
      resultsDiv.innerHTML = results.map(r => `
        <div>
          <h3>${r.metadata.title}</h3>
          <p>Score: ${r.score.toFixed(3)}</p>
        </div>
      `).join('');
    };

    init();
  </script>
</body>
</html>
```

## Configuration Options

### Embedding Models

Choose a model based on your needs:

```typescript
// Small and fast (384 dimensions, 23MB)
embedding: {
  model: 'Xenova/all-MiniLM-L6-v2',
  device: 'wasm',
}

// Better quality (384 dimensions, 33MB)
embedding: {
  model: 'Xenova/bge-small-en-v1.5',
  device: 'wasm',
}

// Multimodal (text + images, 512 dimensions, 150MB)
embedding: {
  model: 'Xenova/clip-vit-base-patch32',
  device: 'wasm',
}
```

### Device Selection

```typescript
// WASM (works everywhere, slower)
embedding: { device: 'wasm' }

// WebGPU (faster, requires GPU support)
embedding: { device: 'webgpu' }
```

### Distance Metrics

```typescript
// Cosine similarity (recommended for normalized embeddings)
index: { metric: 'cosine' }

// Euclidean distance
index: { metric: 'euclidean' }

// Dot product
index: { metric: 'dot' }
```

## Error Handling

```typescript
import { 
  VectorDBError, 
  StorageQuotaError, 
  DimensionMismatchError 
} from '@vectordb/browser-vectordb';

try {
  await db.insert(data);
} catch (error) {
  if (error instanceof StorageQuotaError) {
    console.error('Storage quota exceeded');
    // Export and clear old data
    const backup = await db.export();
    await db.clear();
  } else if (error instanceof DimensionMismatchError) {
    console.error('Vector dimensions do not match');
  } else if (error instanceof VectorDBError) {
    console.error('Database error:', error.message);
  } else {
    throw error;
  }
}
```

## Performance Tips

### 1. Use Batch Operations

```typescript
// ✅ Fast - Single transaction
await db.insertBatch(documents);

// ❌ Slow - Multiple transactions
for (const doc of documents) {
  await db.insert(doc);
}
```

### 2. Enable Caching

```typescript
embedding: {
  model: 'Xenova/all-MiniLM-L6-v2',
  cache: true,  // Cache model in IndexedDB
}
```

### 3. Use WebGPU When Available

```typescript
// Detect WebGPU support
const hasWebGPU = 'gpu' in navigator;

embedding: {
  model: 'Xenova/all-MiniLM-L6-v2',
  device: hasWebGPU ? 'webgpu' : 'wasm',
}
```

### 4. Filter Early

```typescript
// ✅ Good - Filter during search
const results = await db.search({
  text: query,
  k: 10,
  filter: { field: 'category', operator: 'eq', value: 'tech' },
});

// ❌ Bad - Filter after search
const allResults = await db.search({ text: query, k: 100 });
const filtered = allResults.filter(r => r.metadata.category === 'tech');
```

### 5. Limit Result Count

```typescript
// Only request what you need
const results = await db.search({
  text: query,
  k: 10,  // Not 100
});
```

## Data Persistence

### Export Database

```typescript
// Export to JSON
const data = await db.export();
const json = JSON.stringify(data);

// Save to file (browser)
const blob = new Blob([json], { type: 'application/json' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'database-backup.json';
a.click();

// Save to localStorage
localStorage.setItem('db-backup', json);
```

### Import Database

```typescript
// Load from localStorage
const json = localStorage.getItem('db-backup');
const data = JSON.parse(json);
await db.import(data);

// Load from file (browser)
const file = document.getElementById('fileInput').files[0];
const text = await file.text();
const data = JSON.parse(text);
await db.import(data);
```

## Next Steps

Now that you know the basics, explore more advanced features:

- **[RAG Tutorial](./RAG_TUTORIAL.md)** - Build retrieval-augmented generation pipelines
- **[MCP Integration](./MCP_INTEGRATION.md)** - Integrate with AI assistants
- **[Performance Guide](./PERFORMANCE.md)** - Optimize for production
- **[API Reference](./API.md)** - Complete API documentation
- **[Examples](../examples/README.md)** - More code examples

## Common Issues

### Model Loading Slow

First load downloads the model. Subsequent loads use cache:

```typescript
embedding: {
  model: 'Xenova/all-MiniLM-L6-v2',
  cache: true,  // Enable caching
}
```

### Storage Quota Exceeded

Export and clear old data:

```typescript
const backup = await db.export();
// Save backup somewhere
await db.clear();
```

### WebGPU Not Available

Fall back to WASM:

```typescript
const hasWebGPU = 'gpu' in navigator;
embedding: {
  device: hasWebGPU ? 'webgpu' : 'wasm',
}
```

### Dimension Mismatch

Ensure vector dimensions match index configuration:

```typescript
// Model outputs 384 dimensions
embedding: { model: 'Xenova/all-MiniLM-L6-v2' }

// Index must match
index: { dimensions: 384 }
```

## Support

- **Documentation**: [Full Docs](../README.md)
- **Examples**: [Code Examples](../examples/README.md)
- **Issues**: [GitHub Issues](https://github.com/your-repo/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-repo/discussions)

---

Happy coding! 🚀
