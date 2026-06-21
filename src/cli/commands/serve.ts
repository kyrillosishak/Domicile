/**
 * domicile serve — run the MCP server over the custody layer.
 *
 * PRODUCT_DESIGN.md B7/B9. Defaults to stdio (for Claude Desktop). Optionally
 * matter-scoped so an agent cannot reach another matter's documents.
 */

import { parseFlags } from '../commands.js';
import { ensureNodeEnv } from '../env.js';

export async function cmdServe(args: string[]): Promise<number> {
  const { values } = parseFlags(args, {
    flags: {
      transport: 'string',
      port: 'string',
      db: 'string',
      'embedding-model': 'string',
      dimensions: 'string',
      matter: 'string',
      help: 'boolean',
    },
  });

  if (values.help) {
    console.log(`domicile serve — run the MCP server

Options:
  --transport <stdio|sse|streamable-http>  MCP transport (default: stdio)
  --port <n>                       HTTP port for sse / streamable-http (default: 3001)
  --db <name>                      IndexedDB database name (default: domicile-mcp)
  --embedding-model <id>           Embedding model id (default: Xenova/all-MiniLM-L6-v2)
  --dimensions <n>                 Embedding dimensions (default: 384)
  --matter <id>                    Scope every tool to one matter id
  --help                           Show this help`);
    return 0;
  }

  ensureNodeEnv();

  const transport = (values.transport as string) ?? 'stdio';
  const dbName = (values.db as string) ?? 'domicile-mcp';
  const embeddingModel = (values['embedding-model'] as string) ?? 'Xenova/all-MiniLM-L6-v2';
  const dimensions = Number(values.dimensions ?? 384);
  const matter = values.matter as string | undefined;

  const { createDomicile, MCPServer } = await import('../../index.js');

  const db = await createDomicile({
    storage: { dbName },
    dimensions,
    metric: 'cosine',
    embedding: { model: embeddingModel, cache: true },
  });

  const mcp = new MCPServer({
    vectorDB: db,
    scope: matter
      ? { field: 'matter', value: matter, enforceOn: ['search_vectors', 'insert_document', 'delete_document', 'rag_query'] }
      : undefined,
  });

  if (transport === 'stdio') {
    // Hand off to the MCP SDK's stdio transport. The process stays alive
    // until the client closes the stream.
    process.stderr.write(`domicile MCP serving on stdio (db=${dbName}${matter ? `, matter=${matter}` : ''})\n`);
    await mcp.serve('stdio');
    // serve() resolves after the transport connects; keep alive for stdio.
    return new Promise<number>(() => {
      // The process is held by the open stdio transport; it exits when the
      // client disconnects and the transport closes.
    });
  }

  if (transport === 'sse' || transport === 'streamable-http') {
    const port = Number(values.port ?? 3001);
    process.stderr.write(`domicile MCP serving ${transport} on http://localhost:${port}\n`);
    await mcp.serve(transport, { port });
    return new Promise<number>(() => {
      // The http.Server holds the process alive until killed.
    });
  }

  console.error(`Unsupported transport: ${transport}`);
  return 1;
}
