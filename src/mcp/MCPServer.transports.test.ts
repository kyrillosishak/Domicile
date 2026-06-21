// @vitest-environment node
/**
 * HTTP-transport regression tests for MCPServer.serve().
 *
 * These bind real Node HTTP servers (sse + streamable-http) and confirm an
 * MCP `initialize` round-trips. Runs in the node environment — happy-dom's
 * fetch blocks cross-origin requests to 127.0.0.1, which would false-fail.
 */

import { describe, it, expect } from 'vitest';
import { MCPServer } from './MCPServer';
import type { VectorDB } from '../core/VectorDB';

function makeServer(): MCPServer {
  const mockVectorDB = {
    search: async () => [{ id: 'x', score: 0.9, metadata: {} }],
    insert: async () => 'id-1',
    delete: async () => true,
  } as unknown as VectorDB;
  return new MCPServer({ vectorDB: mockVectorDB });
}

const nextPort = (() => {
  let p = 13490;
  return () => ++p;
})();

async function postInitialize(port: number, endpoint: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'vitest', version: '0' },
      },
    }),
  });
  return { status: res.status, body: await res.text() };
}

describe('MCPServer HTTP transports', () => {
  it('streamable-http binds a real listener and answers initialize', async () => {
    const port = nextPort();
    const mcp = makeServer();
    const server = await mcp.serve('streamable-http', { port, endpoint: '/mcp' });
    try {
      const { status, body } = await postInitialize(port, '/mcp');
      expect(status).toBe(200);
      expect(body).toContain('domicile-mcp');
      expect(body).toContain('"id":1');
    } finally {
      server.close();
    }
  }, 15000);

  it('SSE rejects POST for an unknown session with 400 (session opens via GET)', async () => {
    const port = nextPort();
    const mcp = makeServer();
    const server = await mcp.serve('sse', { port, endpoint: '/message' });
    try {
      const { status, body } = await postInitialize(port, '/message');
      expect(status).toBe(400);
      expect(body).toContain('session');
    } finally {
      server.close();
    }
  }, 15000);

  it('rejects an unsupported transport', async () => {
    const mcp = makeServer();
    await expect(mcp.serve('websocket' as any)).rejects.toThrow();
  }, 10000);
});
