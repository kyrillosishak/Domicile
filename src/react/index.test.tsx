/**
 * Tests for @domicile/react hooks. Runs in happy-dom (per-file env directive)
 * with fake-indexeddb from the global setup.
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { useDomicile, useSearch, useRag, useRagStream, useCapabilities, useIngestProgress } from './index';
import type { VectorDB } from '../core/VectorDB';
import type { RAGPipelineManager } from '../rag/RAGPipelineManager';

function makeMockDb(overrides: Partial<VectorDB> = {}): VectorDB {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    insertBatch: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockResolvedValue('id'),
    size: vi.fn().mockResolvedValue(0),
    ...overrides,
  } as unknown as VectorDB;
}

describe('useCapabilities', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('detects capabilities and stops loading', async () => {
    const { result } = renderHook(() => useCapabilities());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.capabilities).not.toBeNull();
    expect(typeof result.current.capabilities!.wasm).toBe('boolean');
  });
});

describe('useDomicile', () => {
  it('creates the db and reports ready', async () => {
    const db = makeMockDb();
    const create = vi.fn().mockResolvedValue(db);
    const { result, unmount } = renderHook(() => useDomicile({ create }));

    expect(result.current.ready).toBe(false);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.db).toBe(db);
    expect(create).toHaveBeenCalledTimes(1);

    unmount();
    // auto-dispose on unmount
    await waitFor(() => expect(db.dispose).toHaveBeenCalled());
  });

  it('surfaces creation errors', async () => {
    const create = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useDomicile({ create }));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.ready).toBe(false);
    expect(result.current.error!.message).toBe('boom');
  });
});

describe('useSearch', () => {
  it('issues a search and stores results', async () => {
    const db = makeMockDb({
      search: vi.fn().mockResolvedValue([
        { id: '1', score: 0.9, metadata: {} },
      ]),
    });
    const { result } = renderHook(() => useSearch(db));

    act(() => result.current.search('hello', 3));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.results).toHaveLength(1);
    expect(db.search).toHaveBeenCalledWith({ text: 'hello', k: 3 });
  });

  it('ignores results from a stale query', async () => {
    let resolveFirst!: (v: any) => void;
    const first = new Promise((res) => (resolveFirst = res));
    const db = makeMockDb({
      search: vi
        .fn()
        .mockReturnValueOnce(first)
        .mockResolvedValueOnce([{ id: '2', score: 0.5, metadata: {} }]),
    });
    const { result } = renderHook(() => useSearch(db));

    act(() => result.current.search('slow'));
    act(() => result.current.search('fast'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    // The stale first result, when it finally resolves, must not overwrite.
    resolveFirst([{ id: '1', score: 0.99, metadata: {} }]);
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.results.map((r) => r.id)).toEqual(['2']);
  });
});

describe('useRag', () => {
  it('runs a non-streaming RAG query', async () => {
    const rag = {
      query: vi.fn().mockResolvedValue({
        answer: '42',
        sources: [{ id: 's1', score: 1, metadata: {} }],
      }),
    } as unknown as RAGPipelineManager;
    const { result } = renderHook(() => useRag(rag));

    act(() => result.current.query('meaning?'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.answer).toBe('42');
    expect(result.current.sources).toHaveLength(1);
  });
});

describe('useRagStream', () => {
  it('accumulates streamed generation chunks', async () => {
    const rag = {
      queryStream: async function* (): AsyncGenerator<any> {
        yield { type: 'retrieval', sources: [{ id: 's1', score: 1, metadata: {} }] };
        yield { type: 'generation', content: 'Hello ' };
        yield { type: 'generation', content: 'world' };
        yield { type: 'complete' };
      },
    } as unknown as RAGPipelineManager;

    const { result } = renderHook(() => useRagStream(rag));
    await act(async () => {
      await result.current.stream('hi');
    });
    expect(result.current.streaming).toBe(false);
    expect(result.current.chunks).toEqual(['Hello ', 'world']);
    expect(result.current.fullText).toBe('Hello world');
    expect(result.current.sources).toHaveLength(1);
  });
});

describe('useIngestProgress', () => {
  it('ingests in chunks and reports progress', async () => {
    const db = makeMockDb({ insertBatch: vi.fn().mockResolvedValue([]) });
    const { result } = renderHook(() => useIngestProgress(db));

    const texts = Array.from({ length: 25 }, (_, i) => `doc ${i}`);
    await act(async () => {
      await result.current.ingest(texts);
    });

    expect(result.current.progress.phase).toBe('done');
    expect(result.current.progress.loaded).toBe(25);
    expect(result.current.progress.total).toBe(25);
    // 25 docs / chunkSize 10 → 3 insertBatch calls.
    expect(db.insertBatch).toHaveBeenCalledTimes(3);
  });
});
