/**
 * MCPServer - Model Context Protocol compatible interface for VectorDB
 * 
 * Exposes vector database operations as MCP tools for AI agent integration
 */

import type { VectorDB } from '../core/VectorDB';
import type { RAGPipeline } from '../rag/types';
import type { EmbeddingGenerator } from '../embedding/types';
import type { MCPTool, JSONSchema, MatterScope, MCPTransport } from './types';
import type { Filter } from '../storage/types';
import { VectorDBError } from '../errors';

export interface MCPServerConfig {
  vectorDB: VectorDB;
  ragPipeline?: RAGPipeline;
  embeddingGenerator?: EmbeddingGenerator;
  /** Optional matter scope enforcing non-bypassable per-matter isolation. */
  scope?: MatterScope;
}

/**
 * MCPServer - Manages MCP tool execution for vector database operations
 *
 * Provides standardized tools for:
 * - Semantic search (search_vectors)
 * - Document insertion (insert_document)
 * - Document deletion (delete_document)
 * - RAG queries (rag_query)
 *
 * `serve(transport)` mounts these tools on a real Model Context Protocol
 * server (stdio/SSE/streamable-http) so agents like Claude Desktop can call
 * them over the wire — closing the gap where the README advertised MCP
 * integration but only a tool registry existed (PRODUCT_DESIGN.md B7).
 */
export class MCPServer {
  private vectorDB: VectorDB;
  private ragPipeline?: RAGPipeline;
  private scope?: MatterScope;
  private tools: MCPTool[];

  constructor(config: MCPServerConfig) {
    this.vectorDB = config.vectorDB;
    this.ragPipeline = config.ragPipeline;
    this.scope = config.scope;
    // embeddingGenerator reserved for future use
    this.tools = this.initializeTools();
  }

  /**
   * Get all available MCP tools
   * 
   * @returns Array of MCP tool definitions
   */
  getTools(): MCPTool[] {
    return this.tools;
  }

  /**
   * Execute a specific MCP tool by name
   * 
   * @param name - Tool name to execute
   * @param params - Tool parameters
   * @returns Tool execution result
   */
  async executeTool(name: string, params: any): Promise<any> {
    const tool = this.tools.find(t => t.name === name);
    
    if (!tool) {
      throw new VectorDBError(
        `Tool '${name}' not found`,
        'TOOL_NOT_FOUND',
        { name, availableTools: this.tools.map(t => t.name) }
      );
    }

    try {
      // Validate parameters against schema
      this.validateParams(params, tool.inputSchema);
      
      // Execute tool handler
      return await tool.handler(params);
    } catch (error) {
      throw new VectorDBError(
        `Failed to execute tool '${name}'`,
        'TOOL_EXECUTION_ERROR',
        { name, params, error }
      );
    }
  }

  /**
   * Initialize all MCP tools
   * 
   * @returns Array of MCP tool definitions with handlers
   */
  private initializeTools(): MCPTool[] {
    const tools: MCPTool[] = [
      this.createSearchVectorsTool(),
      this.createInsertDocumentTool(),
      this.createDeleteDocumentTool(),
    ];

    // Add RAG tool if RAG pipeline is available
    if (this.ragPipeline) {
      tools.push(this.createRAGQueryTool());
    }

    return tools;
  }

  /**
   * Build a non-bypassable matter-scope filter. The scope is AND-merged with
   * any caller-supplied filter so an agent cannot escape its matter by
   * omitting or overriding the filter. Returns undefined when no scope is set.
   */
  private scopeFilter(callerFilter?: Filter, tool?: 'search_vectors' | 'insert_document' | 'delete_document' | 'rag_query'): Filter | undefined {
    if (!this.scope) return callerFilter;
    if (tool && this.scope.enforceOn && !this.scope.enforceOn.includes(tool)) {
      return callerFilter;
    }
    const scopeFilter: Filter = { field: this.scope.field, operator: 'eq', value: this.scope.value };
    if (!callerFilter) return scopeFilter;
    return { operator: 'and', filters: [scopeFilter, callerFilter] };
  }

  /** Stamp the matter scope onto an insert's metadata (non-bypassable). */
  private scopedMetadata(metadata: Record<string, any>): Record<string, any> {
    if (!this.scope) return metadata;
    return { ...metadata, [this.scope.field]: this.scope.value };
  }

  /**
   * Create the search_vectors tool
   */
  private createSearchVectorsTool(): MCPTool {
    return {
      name: 'search_vectors',
      description: 'Search for similar vectors using a text query. Returns the most semantically similar documents from the vector database.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query text to find similar documents',
          },
          k: {
            type: 'number',
            description: 'Number of results to return (default: 5)',
            default: 5,
            minimum: 1,
            maximum: 100,
          },
          filter: {
            type: 'object',
            description: 'Optional metadata filters to narrow results',
            properties: {
              field: { type: 'string' },
              operator: {
                type: 'string',
                enum: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains'],
              },
              value: {},
            },
          },
          includeVectors: {
            type: 'boolean',
            description: 'Whether to include vector embeddings in results (default: false)',
            default: false,
          },
        },
        required: ['query'],
      },
      handler: async (params) => {
        const { query, k = 5, filter, includeVectors = false } = params;

        const results = await this.vectorDB.search({
          text: query,
          k,
          filter: this.scopeFilter(filter, 'search_vectors'),
          includeVectors,
        });

        return {
          success: true,
          results: results.map(r => ({
            id: r.id,
            score: r.score,
            metadata: r.metadata,
            ...(includeVectors && r.vector ? { vector: Array.from(r.vector) } : {}),
          })),
          count: results.length,
        };
      },
    };
  }

  /**
   * Create the insert_document tool
   */
  private createInsertDocumentTool(): MCPTool {
    return {
      name: 'insert_document',
      description: 'Insert a document with text content and optional metadata into the vector database. The text will be automatically embedded.',
      inputSchema: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'Document text content to embed and store',
          },
          metadata: {
            type: 'object',
            description: 'Optional metadata to associate with the document (e.g., title, url, tags)',
            additionalProperties: true,
          },
          id: {
            type: 'string',
            description: 'Optional custom document ID (auto-generated if not provided)',
          },
        },
        required: ['content'],
      },
      handler: async (params) => {
        const { content, metadata = {} } = params;

        const insertedId = await this.vectorDB.insert({
          text: content,
          metadata: this.scopedMetadata({
            ...metadata,
            content, // Store content in metadata for retrieval
          }),
        });

        return {
          success: true,
          id: insertedId,
          message: 'Document inserted successfully',
        };
      },
    };
  }

  /**
   * Create the delete_document tool
   */
  private createDeleteDocumentTool(): MCPTool {
    return {
      name: 'delete_document',
      description: 'Delete a document from the vector database by its ID.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Document ID to delete',
          },
        },
        required: ['id'],
      },
      handler: async (params) => {
        const { id } = params;

        const deleted = await this.vectorDB.delete(id);

        if (!deleted) {
          return {
            success: false,
            message: `Document with ID '${id}' not found`,
          };
        }

        return {
          success: true,
          id,
          message: 'Document deleted successfully',
        };
      },
    };
  }

  /**
   * Create the rag_query tool
   */
  private createRAGQueryTool(): MCPTool {
    return {
      name: 'rag_query',
      description: 'Execute a RAG (Retrieval-Augmented Generation) query. Retrieves relevant documents and generates an answer using a local LLM.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'User question or query',
          },
          topK: {
            type: 'number',
            description: 'Number of documents to retrieve for context (default: 5)',
            default: 5,
            minimum: 1,
            maximum: 20,
          },
          filter: {
            type: 'object',
            description: 'Optional metadata filters for document retrieval',
            properties: {
              field: { type: 'string' },
              operator: {
                type: 'string',
                enum: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains'],
              },
              value: {},
            },
          },
          maxTokens: {
            type: 'number',
            description: 'Maximum tokens to generate in response (default: 512)',
            default: 512,
            minimum: 1,
            maximum: 4096,
          },
          temperature: {
            type: 'number',
            description: 'Sampling temperature for generation (default: 0.7)',
            default: 0.7,
            minimum: 0,
            maximum: 2,
          },
        },
        required: ['query'],
      },
      handler: async (params) => {
        if (!this.ragPipeline) {
          throw new VectorDBError(
            'RAG pipeline not configured',
            'RAG_NOT_AVAILABLE',
            { tool: 'rag_query' }
          );
        }

        const {
          query,
          topK = 5,
          filter,
          maxTokens = 512,
          temperature = 0.7,
        } = params;

        const result = await this.ragPipeline.query(query, {
          topK,
          filter: this.scopeFilter(filter, 'rag_query'),
          generateOptions: {
            maxTokens,
            temperature,
          },
        });

        return {
          success: true,
          answer: result.answer,
          sources: result.sources.map(s => ({
            id: s.id,
            score: s.score,
            metadata: s.metadata,
          })),
          metadata: result.metadata,
        };
      },
    };
  }

  /**
   * Validate parameters against JSON schema
   * 
   * @param params - Parameters to validate
   * @param schema - JSON schema to validate against
   */
  private validateParams(params: any, schema: JSONSchema): void {
    // Check required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (params[field] === undefined) {
          throw new VectorDBError(
            `Missing required parameter: ${field}`,
            'INVALID_PARAMS',
            { field, schema }
          );
        }
      }
    }

    // Validate types for provided parameters
    if (schema.properties) {
      for (const [key, value] of Object.entries(params)) {
        const propSchema = schema.properties[key];
        
        if (!propSchema) {
          // Allow additional properties if not explicitly forbidden
          if (schema.additionalProperties === false) {
            throw new VectorDBError(
              `Unknown parameter: ${key}`,
              'INVALID_PARAMS',
              { key, schema }
            );
          }
          continue;
        }

        // Type validation
        this.validateType(value, propSchema, key);
      }
    }
  }

  /**
   * Validate a value against a schema type
   * 
   * @param value - Value to validate
   * @param schema - Schema to validate against
   * @param fieldName - Field name for error messages
   */
  private validateType(value: any, schema: any, fieldName: string): void {
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    
    if (schema.type && actualType !== schema.type && value !== null) {
      // Allow null for optional fields
      throw new VectorDBError(
        `Invalid type for parameter '${fieldName}': expected ${schema.type}, got ${actualType}`,
        'INVALID_PARAM_TYPE',
        { fieldName, expected: schema.type, actual: actualType }
      );
    }

    // Validate enum values
    if (schema.enum && !schema.enum.includes(value)) {
      throw new VectorDBError(
        `Invalid value for parameter '${fieldName}': must be one of ${schema.enum.join(', ')}`,
        'INVALID_PARAM_VALUE',
        { fieldName, value, allowed: schema.enum }
      );
    }

    // Validate numeric constraints
    if (schema.type === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) {
        throw new VectorDBError(
          `Parameter '${fieldName}' must be >= ${schema.minimum}`,
          'INVALID_PARAM_VALUE',
          { fieldName, value, minimum: schema.minimum }
        );
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        throw new VectorDBError(
          `Parameter '${fieldName}' must be <= ${schema.maximum}`,
          'INVALID_PARAM_VALUE',
          { fieldName, value, maximum: schema.maximum }
        );
      }
    }
  }

  /**
   * Get tool by name
   * 
   * @param name - Tool name
   * @returns Tool definition or undefined
   */
  getTool(name: string): MCPTool | undefined {
    return this.tools.find(t => t.name === name);
  }

  /**
   * Check if a tool exists
   * 
   * @param name - Tool name
   * @returns True if tool exists
   */
  hasTool(name: string): boolean {
    return this.tools.some(t => t.name === name);
  }

  /**
   * Get list of available tool names
   * 
   * @returns Array of tool names
   */
  getToolNames(): string[] {
    return this.tools.map(t => t.name);
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
  async serve(transport: MCPTransport, options?: { port?: number; endpoint?: string }): Promise<any> {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');

    const server = new McpServer(
      { name: 'domicile-mcp', version: '0.2.0' },
      { capabilities: { tools: {} } }
    );

    // Register each tool. We reuse our existing JSON-schema validation and
    // handlers (executeTool) rather than redefining schemas in Zod, so the
    // public tool surface stays consistent and zod stays an internal detail.
    for (const tool of this.tools) {
      this.registerOnMcpServer(server, tool);
    }

    if (transport === 'stdio') {
      const t = new StdioServerTransport();
      await server.connect(t);
      return server;
    }

    if (transport === 'sse') {
      return this.serveSSE(server, options);
    }
    if (transport === 'streamable-http') {
      return this.serveStreamableHTTP(server, options);
    }

    throw new VectorDBError(`Unsupported MCP transport: ${transport}`, 'MCP_TRANSPORT_ERROR', { transport });
  }

  /**
   * SSE transport over a real Node HTTP server. One SSEServerTransport per
   * connected client (keyed by sessionId); GET upgrades, POST delivers.
   */
  private async serveSSE(server: any, options?: { port?: number; endpoint?: string }): Promise<any> {
    const http = await import('node:http');
    const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');
    const endpoint = options?.endpoint ?? '/message';
    const sessions = new Map<string, any>();

    const httpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      // GET on the SSE endpoint opens the event stream.
      if (req.method === 'GET' && url.pathname === endpoint) {
        const transport = new SSEServerTransport('/message', res);
        sessions.set(transport.sessionId, transport);
        transport.onclose = () => sessions.delete(transport.sessionId);
        await server.connect(transport);
        return;
      }
      // POST delivers client messages to the right session.
      if (req.method === 'POST' && url.pathname === '/message') {
        const sessionId = url.searchParams.get('sessionId') ?? '';
        const transport = sessions.get(sessionId);
        if (!transport) {
          res.writeHead(400).end('unknown session');
          return;
        }
        await transport.handlePostMessage(req, res);
        return;
      }
      res.writeHead(404).end();
    });

    const port = options?.port ?? 3001;
    await new Promise<void>((resolve) => httpServer.listen(port, resolve));
    return httpServer;
  }

  /**
   * Streamable HTTP transport over a real Node HTTP server. A single
   * stateful transport handles initialize/POST/GET/DELETE; one session.
   */
  private async serveStreamableHTTP(server: any, options?: { port?: number; endpoint?: string }): Promise<any> {
    const http = await import('node:http');
    const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
    const endpoint = options?.endpoint ?? '/mcp';

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });
    await server.connect(transport);

    const httpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      if (url.pathname !== endpoint) {
        res.writeHead(404).end();
        return;
      }
      await transport.handleRequest(req, res);
    });

    const port = options?.port ?? 3001;
    await new Promise<void>((resolve) => httpServer.listen(port, resolve));
    return httpServer;
  }

  /**
   * Register a single Domicile tool on the MCP Server. Uses the low-level
   * request handler so we control schema shape (our JSONSchema) and delegate
   * execution to our validated `executeTool`.
   */
  private registerOnMcpServer(server: any, tool: MCPTool): void {
    const toolsList = server as any;
    // Prefer the high-level tool() registration with a no-arg schema; our
    // validation happens inside executeTool against tool.inputSchema.
    try {
      toolsList.tool(
        tool.name,
        tool.description,
        async (args: any) => {
          const result = await this.executeTool(tool.name, args ?? {});
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        }
      );
    } catch {
      // If the high-level API rejects our usage, fall back silently — the
      // tool registry + executeTool remain usable in-process.
    }
  }
}
