/**
 * MCP interface types
 */

export interface JSONSchema {
  type: string;
  properties?: Record<string, any>;
  required?: string[];
  description?: string;
  [key: string]: any;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  handler: (params: any) => Promise<any>;
}

/**
 * Matter-scoping for multi-matter agent exposure. A scope injects a
 * non-bypassable default metadata filter into every search/insert/rag call,
 * so an agent wired to one matter cannot read or write another's documents
 * (PRODUCT_DESIGN.md B7). Today `filter` is caller-supplied and optional —
 * unsafe for multi-tenant agent exposure; the scope closes that hole.
 */
export interface MatterScope {
  /** The metadata field that identifies a matter (e.g. 'matter'). */
  field: string;
  /** The matter value to enforce. */
  value: string;
  /** Which tools the scope applies to. Default: all data-touching tools. */
  enforceOn?: ('search_vectors' | 'insert_document' | 'delete_document' | 'rag_query')[];
}

export type MCPTransport = 'stdio' | 'sse' | 'streamable-http';

