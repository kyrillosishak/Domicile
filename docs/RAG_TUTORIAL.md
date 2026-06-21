# RAG Pipeline Tutorial

Learn how to build Retrieval-Augmented Generation (RAG) applications with Browser VectorDB. This tutorial covers everything from basic setup to advanced techniques.

## What is RAG?

Retrieval-Augmented Generation combines:
1. **Retrieval**: Finding relevant documents from a knowledge base
2. **Augmentation**: Adding retrieved context to a prompt
3. **Generation**: Using an LLM to generate informed responses

RAG enables LLMs to answer questions based on your specific data without fine-tuning.

## Prerequisites

```bash
npm install @vectordb/browser-vectordb
```

## Basic RAG Setup

### 1. Initialize Components

```typescript
import { VectorDB, RAGPipelineManager, WllamaProvider, TransformersEmbedding } from '@vectordb/browser-vectordb';

// Create vector database
const db = new VectorDB({
  storage: { dbName: 'rag-demo' },
  index: { indexType: 'hnsw', dimensions: 384, metric: 'cosine' },
  embedding: { model: 'Xenova/all-MiniLM-L6-v2', device: 'wasm' },
});

await db.initialize();

// Create LLM provider
const llm = new WllamaProvider({
  model: 'https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf',
  nThreads: 4,
  nContext: 2048,
});

await llm.initialize();

// Create embedding generator
const embedding = new TransformersEmbedding({
  model: 'Xenova/all-MiniLM-L6-v2',
  device: 'wasm',
});

await embedding.initialize();

// Create RAG pipeline
const rag = new RAGPipelineManager(db, llm, embedding);
```

### 2. Add Knowledge Base

```typescript
const documents = [
  {
    text: 'Machine learning is a subset of artificial intelligence that enables computers to learn from data without explicit programming.',
    metadata: {
      title: 'Machine Learning Introduction',
      category: 'AI',
      source: 'ml-guide.pdf',
    },
  },
  {
    text: 'Neural networks are computing systems inspired by biological neural networks. They consist of interconnected nodes (neurons) organized in layers.',
    metadata: {
      title: 'Neural Networks Basics',
      category: 'AI',
      source: 'nn-guide.pdf',
    },
  },
  {
    text: 'Deep learning is a subset of machine learning that uses neural networks with multiple layers to learn hierarchical representations.',
    metadata: {
      title: 'Deep Learning Overview',
      category: 'AI',
      source: 'dl-guide.pdf',
    },
  },
];

await db.insertBatch(documents);
console.log('Knowledge base loaded');
```

### 3. Query with RAG

```typescript
const result = await rag.query('What is machine learning?', {
  topK: 3,  // Retrieve top 3 relevant documents
  generateOptions: {
    maxTokens: 256,
    temperature: 0.7,
  },
});

console.log('Answer:', result.answer);
console.log('Sources:', result.sources.length);
console.log('Retrieval time:', result.metadata.retrievalTime, 'ms');
console.log('Generation time:', result.metadata.generationTime, 'ms');
```

## Streaming Responses

For better UX, stream the response as it's generated:

```typescript
const stream = rag.queryStream('Explain neural networks', {
  topK: 3,
});

for await (const chunk of stream) {
  if (chunk.type === 'retrieval') {
    console.log(`Retrieved ${chunk.sources?.length} documents`);
  } else if (chunk.type === 'generation') {
    process.stdout.write(chunk.content);
  }
}
```

## Advanced Techniques

### 1. Custom Context Templates

Format retrieved documents with custom templates:

```typescript
const result = await rag.query('What is deep learning?', {
  topK: 3,
  contextTemplate: `
Document: {title}
Source: {source}
Content: {content}
---
  `.trim(),
});
```

### 2. Metadata Filtering

Retrieve documents from specific sources:

```typescript
const result = await rag.query('Explain AI concepts', {
  topK: 5,
  filter: {
    field: 'category',
    operator: 'eq',
    value: 'AI',
  },
});
```

### 3. Token Limit Handling

Limit context size to fit within model constraints:

```typescript
const result = await rag.query('Summarize machine learning', {
  topK: 10,
  generateOptions: {
    maxTokens: 512,
    // Context will be truncated if too long
  },
});
```

### 4. Custom Prompts

Build custom prompts for specific use cases:

```typescript
class CustomRAGPipeline extends RAGPipelineManager {
  protected buildPrompt(query: string, context: string): string {
    return `
You are a helpful AI assistant. Answer the question based on the provided context.
If the context doesn't contain enough information, say so.

Context:
${context}

Question: ${query}

Answer (be concise and accurate):
    `.trim();
  }
}

const customRag = new CustomRAGPipeline(db, llm, embedding);
```

## Document Processing

### Chunking Long Documents

Split long documents into smaller chunks for better retrieval:

```typescript
function chunkDocument(text: string, chunkSize: number = 500, overlap: number = 50): string[] {
  const chunks: string[] = [];
  let start = 0;
  
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    start = end - overlap;
  }
  
  return chunks;
}

// Process long document
const longDocument = '...'; // Your long text
const chunks = chunkDocument(longDocument);

const documents = chunks.map((chunk, i) => ({
  text: chunk,
  metadata: {
    title: 'Long Document',
    chunkIndex: i,
    totalChunks: chunks.length,
  },
}));

await db.insertBatch(documents);
```

### Adding Citations

Track sources for generated answers:

```typescript
const result = await rag.query('What is AI?', { topK: 3 });

console.log('Answer:', result.answer);
console.log('\nSources:');
result.sources.forEach((source, i) => {
  console.log(`[${i + 1}] ${source.metadata.title} (${source.metadata.source})`);
  console.log(`    Relevance: ${source.score.toFixed(3)}`);
});
```

### Confidence Scoring

Evaluate answer confidence based on retrieval scores:

```typescript
function calculateConfidence(sources: SearchResult[]): number {
  if (sources.length === 0) return 0;
  
  // Average of top 3 scores
  const topScores = sources.slice(0, 3).map(s => s.score);
  const avgScore = topScores.reduce((a, b) => a + b, 0) / topScores.length;
  
  return avgScore;
}

const result = await rag.query('What is quantum computing?', { topK: 5 });
const confidence = calculateConfidence(result.sources);

console.log('Answer:', result.answer);
console.log('Confidence:', (confidence * 100).toFixed(1) + '%');

if (confidence < 0.5) {
  console.log('⚠️ Low confidence - answer may not be reliable');
}
```

## WebLLM Integration

Use WebGPU-accelerated inference for faster generation:

```typescript
import { WebLLMProvider } from '@vectordb/browser-vectordb';

// Check WebGPU support
const hasWebGPU = 'gpu' in navigator;

if (hasWebGPU) {
  const llm = new WebLLMProvider({
    model: 'TinyLlama-1.1B-Chat-v1.0-q4f32_1-MLC',
    temperature: 0.7,
  });

  await llm.initialize();
  
  const rag = new RAGPipelineManager(db, llm, embedding);
  
  // Much faster generation with WebGPU
  const result = await rag.query('Explain AI', { topK: 3 });
  console.log(result.answer);
} else {
  console.log('WebGPU not available, using WASM');
}
```

## Complete RAG Application

Here's a complete example with all features:

```typescript
import {
  VectorDB,
  RAGPipelineManager,
  WllamaProvider,
  TransformersEmbedding,
  SearchResult,
} from '@vectordb/browser-vectordb';

class RAGApplication {
  private db: VectorDB;
  private rag: RAGPipelineManager;
  private llm: WllamaProvider;
  private embedding: TransformersEmbedding;

  async initialize() {
    // Setup database
    this.db = new VectorDB({
      storage: { dbName: 'rag-app' },
      index: { indexType: 'hnsw', dimensions: 384, metric: 'cosine' },
      embedding: { model: 'Xenova/all-MiniLM-L6-v2', device: 'wasm' },
    });

    await this.db.initialize();

    // Setup LLM
    this.llm = new WllamaProvider({
      model: 'https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf',
      nThreads: 4,
      nContext: 2048,
    });

    await this.llm.initialize();

    // Setup embedding
    this.embedding = new TransformersEmbedding({
      model: 'Xenova/all-MiniLM-L6-v2',
      device: 'wasm',
    });

    await this.embedding.initialize();

    // Create RAG pipeline
    this.rag = new RAGPipelineManager(this.db, this.llm, this.embedding);

    console.log('✓ RAG application initialized');
  }

  async addDocuments(documents: Array<{ text: string; metadata: any }>) {
    await this.db.insertBatch(documents);
    console.log(`✓ Added ${documents.length} documents`);
  }

  async query(question: string, options?: {
    topK?: number;
    filter?: any;
    stream?: boolean;
  }) {
    const topK = options?.topK ?? 3;
    const filter = options?.filter;
    const stream = options?.stream ?? false;

    if (stream) {
      return this.queryStream(question, topK, filter);
    } else {
      return this.querySync(question, topK, filter);
    }
  }

  private async querySync(question: string, topK: number, filter?: any) {
    const result = await this.rag.query(question, {
      topK,
      filter,
      generateOptions: {
        maxTokens: 512,
        temperature: 0.7,
      },
    });

    const confidence = this.calculateConfidence(result.sources);

    return {
      answer: result.answer,
      sources: result.sources.map(s => ({
        title: s.metadata.title,
        source: s.metadata.source,
        relevance: s.score,
      })),
      confidence,
      metadata: result.metadata,
    };
  }

  private async *queryStream(question: string, topK: number, filter?: any) {
    const stream = this.rag.queryStream(question, {
      topK,
      filter,
      generateOptions: {
        maxTokens: 512,
        temperature: 0.7,
      },
    });

    for await (const chunk of stream) {
      yield chunk;
    }
  }

  private calculateConfidence(sources: SearchResult[]): number {
    if (sources.length === 0) return 0;
    const topScores = sources.slice(0, 3).map(s => s.score);
    return topScores.reduce((a, b) => a + b, 0) / topScores.length;
  }

  async dispose() {
    await this.db.dispose();
    await this.llm.dispose();
    await this.embedding.dispose();
    console.log('✓ RAG application disposed');
  }
}

// Usage
async function main() {
  const app = new RAGApplication();
  await app.initialize();

  // Add knowledge base
  await app.addDocuments([
    {
      text: 'Machine learning enables computers to learn from data.',
      metadata: { title: 'ML Intro', source: 'ml-guide.pdf' },
    },
    {
      text: 'Neural networks consist of interconnected nodes.',
      metadata: { title: 'NN Basics', source: 'nn-guide.pdf' },
    },
  ]);

  // Query
  const result = await app.query('What is machine learning?');
  console.log('\nAnswer:', result.answer);
  console.log('Confidence:', (result.confidence * 100).toFixed(1) + '%');
  console.log('\nSources:');
  result.sources.forEach((s, i) => {
    console.log(`[${i + 1}] ${s.title} - Relevance: ${s.relevance.toFixed(3)}`);
  });

  // Streaming query
  console.log('\nStreaming answer:');
  const stream = app.query('Explain neural networks', { stream: true });
  for await (const chunk of stream) {
    if (chunk.type === 'generation') {
      process.stdout.write(chunk.content);
    }
  }

  await app.dispose();
}

main().catch(console.error);
```

## Browser Integration

### Interactive Chat Interface

```html
<!DOCTYPE html>
<html>
<head>
  <title>RAG Chatbot</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    #chat { border: 1px solid #ccc; height: 400px; overflow-y: auto; padding: 10px; margin-bottom: 10px; }
    .message { margin: 10px 0; padding: 10px; border-radius: 5px; }
    .user { background: #e3f2fd; text-align: right; }
    .assistant { background: #f5f5f5; }
    .sources { font-size: 0.9em; color: #666; margin-top: 5px; }
    #input { width: 80%; padding: 10px; }
    #send { padding: 10px 20px; }
  </style>
</head>
<body>
  <h1>RAG Chatbot</h1>
  <div id="chat"></div>
  <input type="text" id="input" placeholder="Ask a question...">
  <button id="send">Send</button>

  <script type="module">
    import { VectorDB, RAGPipelineManager, WllamaProvider, TransformersEmbedding } from 'https://cdn.jsdelivr.net/npm/@vectordb/browser-vectordb@latest/dist/index.js';

    let rag;

    async function init() {
      const db = new VectorDB({
        storage: { dbName: 'chatbot' },
        index: { indexType: 'hnsw', dimensions: 384, metric: 'cosine' },
        embedding: { model: 'Xenova/all-MiniLM-L6-v2', device: 'wasm' },
      });

      await db.initialize();

      const llm = new WllamaProvider({
        model: 'https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf',
      });

      await llm.initialize();

      const embedding = new TransformersEmbedding({
        model: 'Xenova/all-MiniLM-L6-v2',
        device: 'wasm',
      });

      await embedding.initialize();

      rag = new RAGPipelineManager(db, llm, embedding);

      // Load knowledge base
      await db.insertBatch([
        { text: 'Machine learning is...', metadata: { title: 'ML Guide' } },
        { text: 'Neural networks are...', metadata: { title: 'NN Guide' } },
      ]);

      console.log('Chatbot ready');
    }

    async function sendMessage() {
      const input = document.getElementById('input');
      const question = input.value.trim();
      if (!question) return;

      // Add user message
      addMessage(question, 'user');
      input.value = '';

      // Get answer
      const result = await rag.query(question, { topK: 3 });

      // Add assistant message
      const sources = result.sources.map(s => s.metadata.title).join(', ');
      addMessage(result.answer, 'assistant', sources);
    }

    function addMessage(text, role, sources) {
      const chat = document.getElementById('chat');
      const div = document.createElement('div');
      div.className = `message ${role}`;
      div.innerHTML = `
        <div>${text}</div>
        ${sources ? `<div class="sources">Sources: ${sources}</div>` : ''}
      `;
      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
    }

    document.getElementById('send').onclick = sendMessage;
    document.getElementById('input').onkeypress = (e) => {
      if (e.key === 'Enter') sendMessage();
    };

    init();
  </script>
</body>
</html>
```

## Best Practices

### 1. Chunk Documents Appropriately

```typescript
// ✅ Good - Reasonable chunk size
const chunks = chunkDocument(text, 500, 50);

// ❌ Bad - Too large (poor retrieval)
const chunks = chunkDocument(text, 5000, 0);

// ❌ Bad - Too small (loses context)
const chunks = chunkDocument(text, 50, 0);
```

### 2. Use Metadata for Filtering

```typescript
// ✅ Good - Filter by source
const result = await rag.query('question', {
  filter: { field: 'source', operator: 'eq', value: 'trusted-source.pdf' },
});

// ✅ Good - Filter by date
const result = await rag.query('latest news', {
  filter: { field: 'date', operator: 'gte', value: recentDate },
});
```

### 3. Provide Context in Metadata

```typescript
// ✅ Good - Rich metadata
await db.insert({
  text: chunk,
  metadata: {
    title: 'Document Title',
    source: 'source.pdf',
    page: 5,
    section: 'Introduction',
    date: Date.now(),
    author: 'John Doe',
  },
});
```

### 4. Handle Low Confidence

```typescript
const result = await rag.query(question, { topK: 5 });
const confidence = calculateConfidence(result.sources);

if (confidence < 0.5) {
  console.log('I don\'t have enough information to answer confidently.');
  console.log('Here\'s what I found:', result.answer);
  console.log('Please verify this information.');
}
```

### 5. Optimize Retrieval Count

```typescript
// ✅ Good - Balanced
const result = await rag.query(question, { topK: 3 });

// ❌ Bad - Too few (missing context)
const result = await rag.query(question, { topK: 1 });

// ❌ Bad - Too many (noise, slow)
const result = await rag.query(question, { topK: 50 });
```

## Troubleshooting

### Slow Generation

Use WebGPU for faster inference:

```typescript
const hasWebGPU = 'gpu' in navigator;
const llm = hasWebGPU 
  ? new WebLLMProvider({ model: 'TinyLlama-1.1B-Chat-v1.0-q4f32_1-MLC' })
  : new WllamaProvider({ model: '...' });
```

### Poor Answer Quality

1. Increase retrieval count: `topK: 5`
2. Use better embedding model: `Xenova/bge-small-en-v1.5`
3. Improve document chunking
4. Add more relevant documents

### Out of Memory

1. Reduce context size
2. Use smaller model
3. Limit retrieval count
4. Clear cache periodically

## Next Steps

- **[MCP Integration](./MCP_INTEGRATION.md)** - Integrate with AI assistants
- **[Performance Guide](./PERFORMANCE.md)** - Optimize RAG performance
- **[API Reference](./API.md)** - Complete API documentation
- **[Examples](../examples/rag-usage.ts)** - More RAG examples

---

Happy building! 🚀
