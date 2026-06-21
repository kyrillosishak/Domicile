# MCP Integration Guide

Learn how to integrate Browser VectorDB with AI assistants using the Model Context Protocol (MCP). This guide covers setup, tool usage, and best practices.

## What is MCP?

Model Context Protocol (MCP) is a standardized interface that allows AI assistants (like Claude, ChatGPT, and others) to interact with external tools and data sources. Browser VectorDB provides MCP-compatible tools for semantic search and RAG workflows.

## Quick Start

### 1. Create MCP Server

```typescript
import { VectorDB, MCPServer, RAGPipelineManager } from '@vectordb/browser-vectordb';

// Initialize database
const db = new VectorDB({
  storage: { dbName: 'mcp-demo' },
  index: { indexType: 'hnsw', dimensions: 384, metric: 'cosine' },
  embedding: { model: 'Xenova/all-MiniLM-L6-v2', device: 'wasm' },
});

await db.initialize();

// Optional: Setup RAG pipeline
const llm = new WllamaProvider({ model: '...' });
await llm.initialize();

const embedding = new TransformersEmbedding({
  model: 'Xenova/all-MiniLM-L6-v2',
  device: 'wasm',
});
await embedding.initialize();

const rag = new RAGPipelineManager(db, llm, embedding);

// Create MCP server
const mcp = new MCPServer(db, rag);
```

### 2. Get Available Tools

```typescript
const tools = mcp.getTools();

tools.forEach(tool => {
  console.log(`Tool: ${tool.name}`);
  console.log(`Description: ${tool.description}`);
  console.log(`Schema:`, tool.inputSchema);
});
```

### 3. Execute Tools

```typescript
// Search vectors
const results = await mcp.executeTool('search_vectors', {
  query: 'machine learning',
  k: 5,
});

// Insert document
const id = await mcp.executeTool('insert_document', {
  content: 'Machine learning is a subset of AI',
  metadata: { category: 'tech' },
});

// RAG query
const answer = await mcp.executeTool('rag_query', {
  query: 'What is machine learning?',
  topK: 3,
});
```

## Available MCP Tools

### search_vectors

Searches for similar vectors using text query.

**Input Schema:**

```typescript
{
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Search query text',
    },
    k: {
      type: 'number',
      description: 'Number of results to return',
      default: 5,
    },
    filter: {
      type: 'object',
      description: 'Metadata filters',
      properties: {
        field: { type: 'string' },
        operator: { 
          type: 'string',
          enum: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains'],
        },
        value: {},
      },
    },
  },
  required: ['query'],
}
```

**Example:**

```typescript
const results = await mcp.executeTool('search_vectors', {
  query: 'artificial intelligence',
  k: 10,
  filter: {
    field: 'category',
    operator: 'eq',
    value: 'tech',
  },
});

console.log(`Found ${results.length} results`);
results.forEach(r => {
  console.log(`- ${r.metadata.title} (score: ${r.score.toFixed(3)})`);
});
```

### insert_document

Inserts a document with text content and metadata.

**Input Schema:**

```typescript
{
  type: 'object',
  properties: {
    content: {
      type: 'string',
      description: 'Document text content',
    },
    metadata: {
      type: 'object',
      description: 'Document metadata',
    },
  },
  required: ['content'],
}
```

**Example:**

```typescript
const id = await mcp.executeTool('insert_document', {
  content: 'Neural networks are inspired by biological neurons.',
  metadata: {
    title: 'Neural Networks',
    category: 'AI',
    source: 'nn-guide.pdf',
    date: Date.now(),
  },
});

console.log('Inserted document:', id);
```

### delete_document

Deletes a document by ID.

**Input Schema:**

```typescript
{
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description: 'Document ID to delete',
    },
  },
  required: ['id'],
}
```

**Example:**

```typescript
const deleted = await mcp.executeTool('delete_document', {
  id: 'doc-id-123',
});

console.log('Deleted:', deleted);
```

### rag_query

Queries with retrieval-augmented generation.

**Input Schema:**

```typescript
{
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'User question',
    },
    topK: {
      type: 'number',
      description: 'Number of documents to retrieve',
      default: 5,
    },
  },
  required: ['query'],
}
```

**Example:**

```typescript
const result = await mcp.executeTool('rag_query', {
  query: 'What is deep learning?',
  topK: 3,
});

console.log('Answer:', result.answer);
console.log('Sources:', result.sources.length);
```

## Standalone MCP Server

Create a production-ready MCP server:

```typescript
import {
  VectorDB,
  MCPServer,
  RAGPipelineManager,
  WllamaProvider,
  TransformersEmbedding,
} from '@vectordb/browser-vectordb';

class StandaloneMCPServer {
  private db: VectorDB;
  private mcp: MCPServer;
  private rag?: RAGPipelineManager;

  async initialize(config: {
    dbName: string;
    enableRAG?: boolean;
    llmModel?: string;
  }) {
    // Initialize database
    this.db = new VectorDB({
      storage: { dbName: config.dbName },
      index: { indexType: 'hnsw', dimensions: 384, metric: 'cosine' },
      embedding: { model: 'Xenova/all-MiniLM-L6-v2', device: 'wasm' },
    });

    await this.db.initialize();
    console.log('✓ Database initialized');

    // Optional: Setup RAG
    if (config.enableRAG && config.llmModel) {
      const llm = new WllamaProvider({
        model: config.llmModel,
        nThreads: 4,
        nContext: 2048,
      });

      await llm.initialize();
      console.log('✓ LLM initialized');

      const embedding = new TransformersEmbedding({
        model: 'Xenova/all-MiniLM-L6-v2',
        device: 'wasm',
      });

      await embedding.initialize();

      this.rag = new RAGPipelineManager(this.db, llm, embedding);
      console.log('✓ RAG pipeline initialized');
    }

    // Create MCP server
    this.mcp = new MCPServer(this.db, this.rag);
    console.log('✓ MCP server ready');
  }

  getTools() {
    return this.mcp.getTools();
  }

  async executeTool(name: string, params: any) {
    try {
      const result = await this.mcp.executeTool(name, params);
      return {
        success: true,
        result,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async loadKnowledgeBase(documents: Array<{ text: string; metadata: any }>) {
    await this.db.insertBatch(documents);
    console.log(`✓ Loaded ${documents.length} documents`);
  }

  async dispose() {
    await this.db.dispose();
    console.log('✓ Server disposed');
  }
}

// Usage
async function main() {
  const server = new StandaloneMCPServer();

  await server.initialize({
    dbName: 'mcp-server',
    enableRAG: true,
    llmModel: 'https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf',
  });

  // Load knowledge base
  await server.loadKnowledgeBase([
    {
      text: 'Machine learning enables computers to learn from data.',
      metadata: { title: 'ML Intro', category: 'AI' },
    },
    {
      text: 'Neural networks consist of interconnected nodes.',
      metadata: { title: 'NN Basics', category: 'AI' },
    },
  ]);

  // List available tools
  const tools = server.getTools();
  console.log('\nAvailable tools:');
  tools.forEach(tool => {
    console.log(`- ${tool.name}: ${tool.description}`);
  });

  // Execute tools
  console.log('\n--- Search Example ---');
  const searchResult = await server.executeTool('search_vectors', {
    query: 'machine learning',
    k: 2,
  });
  console.log(searchResult);

  console.log('\n--- RAG Example ---');
  const ragResult = await server.executeTool('rag_query', {
    query: 'What is machine learning?',
    topK: 2,
  });
  console.log(ragResult);

  await server.dispose();
}

main().catch(console.error);
```

## Integration with AI Assistants

### Claude Desktop

Configure Claude Desktop to use your MCP server:

**config.json:**

```json
{
  "mcpServers": {
    "browser-vectordb": {
      "command": "node",
      "args": ["path/to/your/mcp-server.js"],
      "env": {
        "DB_NAME": "claude-knowledge",
        "ENABLE_RAG": "true"
      }
    }
  }
}
```

### Custom Integration

Implement a custom MCP client:

```typescript
class MCPClient {
  private server: StandaloneMCPServer;

  async connect(config: any) {
    this.server = new StandaloneMCPServer();
    await this.server.initialize(config);
  }

  async callTool(name: string, params: any) {
    return await this.server.executeTool(name, params);
  }

  async disconnect() {
    await this.server.dispose();
  }
}

// Usage
const client = new MCPClient();
await client.connect({
  dbName: 'my-knowledge-base',
  enableRAG: true,
  llmModel: '...',
});

const result = await client.callTool('search_vectors', {
  query: 'AI concepts',
  k: 5,
});

await client.disconnect();
```

## Advanced Features

### Custom Tools

Add custom tools to the MCP server:

```typescript
class CustomMCPServer extends MCPServer {
  getTools(): MCPTool[] {
    const baseTool = super.getTools();
    
    return [
      ...baseTools,
      {
        name: 'summarize_documents',
        description: 'Summarizes multiple documents',
        inputSchema: {
          type: 'object',
          properties: {
            category: { type: 'string' },
            maxDocs: { type: 'number', default: 10 },
          },
          required: ['category'],
        },
        handler: async (params) => {
          // Custom implementation
          const results = await this.vectorDB.search({
            text: params.category,
            k: params.maxDocs,
            filter: {
              field: 'category',
              operator: 'eq',
              value: params.category,
            },
          });

          const summary = results.map(r => r.metadata.title).join(', ');
          return { summary, count: results.length };
        },
      },
    ];
  }
}
```

### Parameter Validation

Add validation for tool parameters:

```typescript
class ValidatedMCPServer extends MCPServer {
  async executeTool(name: string, params: any): Promise<any> {
    // Validate parameters
    const tool = this.getTools().find(t => t.name === name);
    if (!tool) {
      throw new Error(`Tool ${name} not found`);
    }

    this.validateParams(params, tool.inputSchema);

    // Execute tool
    return await super.executeTool(name, params);
  }

  private validateParams(params: any, schema: any): void {
    // Check required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in params)) {
          throw new Error(`Missing required parameter: ${field}`);
        }
      }
    }

    // Check types
    for (const [key, value] of Object.entries(params)) {
      const propSchema = schema.properties[key];
      if (propSchema && propSchema.type) {
        const actualType = typeof value;
        if (actualType !== propSchema.type) {
          throw new Error(`Invalid type for ${key}: expected ${propSchema.type}, got ${actualType}`);
        }
      }
    }
  }
}
```

### Error Handling

Implement robust error handling:

```typescript
class RobustMCPServer extends MCPServer {
  async executeTool(name: string, params: any): Promise<any> {
    try {
      return await super.executeTool(name, params);
    } catch (error) {
      console.error(`Error executing tool ${name}:`, error);
      
      return {
        error: true,
        message: error.message,
        code: error.code || 'UNKNOWN_ERROR',
        details: error.details,
      };
    }
  }
}
```

### Logging and Monitoring

Add logging for tool execution:

```typescript
class MonitoredMCPServer extends MCPServer {
  private metrics = {
    calls: new Map<string, number>(),
    errors: new Map<string, number>(),
    latency: new Map<string, number[]>(),
  };

  async executeTool(name: string, params: any): Promise<any> {
    const startTime = Date.now();
    
    try {
      // Track call count
      this.metrics.calls.set(name, (this.metrics.calls.get(name) || 0) + 1);
      
      // Execute tool
      const result = await super.executeTool(name, params);
      
      // Track latency
      const latency = Date.now() - startTime;
      const latencies = this.metrics.latency.get(name) || [];
      latencies.push(latency);
      this.metrics.latency.set(name, latencies);
      
      console.log(`Tool ${name} executed in ${latency}ms`);
      
      return result;
    } catch (error) {
      // Track errors
      this.metrics.errors.set(name, (this.metrics.errors.get(name) || 0) + 1);
      throw error;
    }
  }

  getMetrics() {
    const stats: any = {};
    
    for (const [tool, calls] of this.metrics.calls) {
      const latencies = this.metrics.latency.get(tool) || [];
      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const errors = this.metrics.errors.get(tool) || 0;
      
      stats[tool] = {
        calls,
        errors,
        errorRate: errors / calls,
        avgLatency: avgLatency.toFixed(2) + 'ms',
      };
    }
    
    return stats;
  }
}
```

## Best Practices

### 1. Initialize Once

```typescript
// ✅ Good - Initialize once and reuse
const server = new StandaloneMCPServer();
await server.initialize(config);

// ❌ Bad - Don't create multiple instances
const server1 = new StandaloneMCPServer();
const server2 = new StandaloneMCPServer();
```

### 2. Validate Input

```typescript
// ✅ Good - Validate parameters
async executeTool(name: string, params: any) {
  if (!params.query || typeof params.query !== 'string') {
    throw new Error('Invalid query parameter');
  }
  return await super.executeTool(name, params);
}
```

### 3. Handle Errors Gracefully

```typescript
// ✅ Good - Return error information
try {
  return await mcp.executeTool(name, params);
} catch (error) {
  return {
    error: true,
    message: error.message,
    code: error.code,
  };
}
```

### 4. Add Logging

```typescript
// ✅ Good - Log tool execution
console.log(`Executing tool: ${name}`);
const result = await mcp.executeTool(name, params);
console.log(`Tool ${name} completed in ${latency}ms`);
```

### 5. Monitor Performance

```typescript
// ✅ Good - Track metrics
const metrics = server.getMetrics();
console.log('Tool usage:', metrics);
```

## Troubleshooting

### Tool Not Found

Ensure the tool name is correct:

```typescript
const tools = mcp.getTools();
console.log('Available tools:', tools.map(t => t.name));
```

### Invalid Parameters

Check the tool's input schema:

```typescript
const tool = mcp.getTools().find(t => t.name === 'search_vectors');
console.log('Schema:', tool.inputSchema);
```

### RAG Tool Not Available

Ensure RAG pipeline is initialized:

```typescript
const rag = new RAGPipelineManager(db, llm, embedding);
const mcp = new MCPServer(db, rag);  // Pass rag parameter
```

### Slow Tool Execution

1. Use WebGPU for faster inference
2. Reduce retrieval count (topK)
3. Enable caching
4. Optimize database size

## Examples

See complete examples in:
- [examples/mcp-usage.ts](../examples/mcp-usage.ts)
- [examples/mcp-server-standalone.ts](../examples/mcp-server-standalone.ts)

## Next Steps

- **[API Reference](./API.md)** - Complete API documentation
- **[RAG Tutorial](./RAG_TUTORIAL.md)** - Build RAG applications
- **[Performance Guide](./PERFORMANCE.md)** - Optimize performance
- **[Examples](../examples/README.md)** - More code examples

---

Happy integrating! 🚀
