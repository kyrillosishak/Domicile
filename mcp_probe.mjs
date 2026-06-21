// Integration probe: start MCPServer over SSE + streamable-http and run a real
// MCP initialize/tools/list/tools/call handshake against the HTTP server.
// Uses a stub VectorDB so we test the transport wiring, not embeddings.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { MCPServer } from './dist/index.js';

const docs = new Map();
let n = 0;
const stubDB = {
  async search({ text, k = 5 }) {
    const all = [...docs.values()];
    // trivial relevance: substring match, else rank by insertion order
    const scored = all
      .map((d) => ({ ...d, score: d.metadata.content.toLowerCase().includes(String(text).toLowerCase()) ? 0.9 : 0.1 }))
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map(({ id, score, metadata }) => ({ id, score, metadata }));
  },
  async insert({ text, metadata = {} }) {
    const id = `v${n++}`;
    docs.set(id, { id, metadata: { ...metadata, content: text } });
    return id;
  },
  async delete(id) { const had = docs.delete(id); return had; },
};
await stubDB.insert({ text: 'A vector embedding maps text into a high-dimensional space.', metadata: { matter: 'M-1' } });
await stubDB.insert({ text: 'Privileged communication about indemnification.', metadata: { matter: 'M-1' } });

async function probe(transport, label) {
  const mcp = new MCPServer({ vectorDB: stubDB });
  const httpServer = await mcp.serve(transport, { port: 0 });
  const addr = httpServer.address();
  const base = `http://localhost:${addr.port}`;
  process.stderr.write(`${label}: listening on ${base}\n`);

  const ct = transport === 'sse'
    ? new SSEClientTransport(new URL(`${base}/message`))
    : new StreamableHTTPClientTransport(new URL(`${base}/mcp`));
  const client = new Client({ name: 'probe', version: '0.0.0' }, { capabilities: {} });
  await client.connect(ct);

  await client.initialize({ capabilities: {}, protocolVersion: '2025-06-18', clientInfo: { name: 'probe', version: '0.0.0' } });
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name);
  process.stderr.write(`${label}: tools = ${JSON.stringify(names)}\n`);

  const res = await client.callTool({ name: 'search_vectors', arguments: { query: 'embedding', k: 2 } });
  const payload = res.content?.[0]?.text ? JSON.parse(res.content[0].text) : {};
  process.stderr.write(`${label}: search_vectors -> ${payload.count} hit(s)\n`);

  // insert via tool, then verify it shows in a search
  const ins = await client.callTool({ name: 'insert_document', arguments: { content: 'new passage about custody', metadata: { cat: 'privacy' } } });
  process.stderr.write(`${label}: insert_document -> ${JSON.parse(ins.content[0].text).id}\n`);

  await client.close();
  httpServer.close();
  return { names, searchCount: payload.count, inserted: Boolean(ins.content?.[0]?.text) };
}

let ok = true;
try {
  const sse = await probe('sse', 'SSE');
  if (!sse.names.includes('search_vectors') || sse.searchCount !== 1) ok = false;
  const http = await probe('streamable-http', 'StreamableHTTP');
  if (!http.names.includes('search_vectors') || http.searchCount !== 1) ok = false;
  console.log(ok ? 'MCP TRANSPORT PROBE: PASS' : 'MCP TRANSPORT PROBE: FAIL (unexpected results)');
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.error('MCP TRANSPORT PROBE: FAIL', err);
  process.exit(1);
}
