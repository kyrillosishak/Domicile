/**
 * @domicile/react — React hooks binding the engine to UI.
 *
 * PRODUCT_DESIGN.md B11. Thin hooks over the custody engine, suspense/
 * concurrent-friendly. Streaming RAG is exposed as a hook that yields chunks.
 * These are the substrate the Desktop app's UI builds on.
 *
 * React is a peer dependency — consumers bring their own. We import only the
 * types + hooks we use so tree-shaking keeps the bundle minimal.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { VectorDB } from '../core/VectorDB';
import type { RAGPipelineManager } from '../rag/RAGPipelineManager';
import type { SearchResult } from '../index/types';
import type { RAGResult, RAGStreamChunk } from '../rag/types';
import { detectCapabilities, type Capabilities } from '../core/capabilities';

export interface UseDomicileConfig {
  /** A factory that returns an initialized VectorDB, or a ready one. */
  create: () => Promise<VectorDB>;
  /** Auto-dispose on unmount. Default true. */
  autoDispose?: boolean;
}

export interface UseDomicileResult {
  db: VectorDB | null;
  ready: boolean;
  error: Error | null;
}

/**
 * Owns the lifecycle of a VectorDB instance: creates it on mount, disposes on
 * unmount. Exposes `ready` + `error` so UI can render loading/failure states.
 */
export function useDomicile(config: UseDomicileConfig): UseDomicileResult {
  const [db, setDb] = useState<VectorDB | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const dbRef = useRef<VectorDB | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);
    config
      .create()
      .then((instance) => {
        if (cancelled) {
          instance.dispose?.();
          return;
        }
        dbRef.current = instance;
        setDb(instance);
        setReady(true);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      });
    return () => {
      cancelled = true;
      if (config.autoDispose !== false && dbRef.current) {
        dbRef.current.dispose?.().catch(() => {});
        dbRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { db, ready, error };
}

export interface UseSearchResult {
  results: SearchResult[];
  loading: boolean;
  error: Error | null;
  search: (query: string, k?: number) => void;
}

/**
 * Imperative search over a VectorDB. Debounced by the caller (each `search`
 * call triggers one query); cancels stale queries via a generation counter.
 */
export function useSearch(db: VectorDB | null): UseSearchResult {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const genRef = useRef(0);

  const search = useCallback(
    (query: string, k = 5) => {
      if (!db) return;
      const gen = ++genRef.current;
      setLoading(true);
      setError(null);
      db
        .search({ text: query, k })
        .then((r) => {
          if (gen !== genRef.current) return; // stale
          setResults(r);
        })
        .catch((err: unknown) => {
          if (gen !== genRef.current) return;
          setError(err instanceof Error ? err : new Error(String(err)));
        })
        .finally(() => {
          if (gen === genRef.current) setLoading(false);
        });
    },
    [db]
  );

  return { results, loading, error, search };
}

export interface UseRagResult {
  answer: string;
  sources: RAGResult['sources'];
  loading: boolean;
  error: Error | null;
  query: (q: string) => void;
}

/** Non-streaming RAG query hook. */
export function useRag(rag: RAGPipelineManager | null): UseRagResult {
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState<RAGResult['sources']>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const query = useCallback(
    (q: string) => {
      if (!rag) return;
      setLoading(true);
      setError(null);
      setAnswer('');
      setSources([]);
      rag
        .query(q)
        .then((res) => {
          setAnswer(res.answer);
          setSources(res.sources);
        })
        .catch((err: unknown) => setError(err instanceof Error ? err : new Error(String(err))))
        .finally(() => setLoading(false));
    },
    [rag]
  );

  return { answer, sources, loading, error, query };
}

export interface UseRagStreamResult {
  chunks: string[];
  fullText: string;
  streaming: boolean;
  sources: RAGStreamChunk['sources'];
  error: Error | null;
  stream: (q: string) => Promise<void>;
  reset: () => void;
}

/**
 * Streaming RAG hook. Accumulates generation chunks into `chunks` and a
 * joined `fullText`; surfaces `retrieval` sources as soon as they arrive.
 */
export function useRagStream(rag: RAGPipelineManager | null): UseRagStreamResult {
  const [chunks, setChunks] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [sources, setSources] = useState<RAGStreamChunk['sources']>([]);
  const [error, setError] = useState<Error | null>(null);

  const stream = useCallback(
    async (q: string) => {
      if (!rag) return;
      setChunks([]);
      setSources([]);
      setError(null);
      setStreaming(true);
      try {
        for await (const chunk of rag.queryStream(q)) {
          if (chunk.type === 'retrieval') {
            setSources(chunk.sources ?? []);
          } else if (chunk.type === 'generation' && chunk.content) {
            setChunks((prev) => [...prev, chunk.content]);
          }
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setStreaming(false);
      }
    },
    [rag]
  );

  const reset = useCallback(() => {
    setChunks([]);
    setSources([]);
    setError(null);
  }, []);

  return {
    chunks,
    fullText: chunks.join(''),
    streaming,
    sources,
    error,
    stream,
    reset,
  };
}

export interface UseCapabilitiesResult {
  capabilities: Capabilities | null;
  loading: boolean;
}

/** Detects and caches runtime capabilities; the Desktop custody panel uses this. */
export function useCapabilities(): UseCapabilitiesResult {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    detectCapabilities(true)
      .then((c) => {
        if (!cancelled) setCapabilities(c);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { capabilities, loading };
}

export interface IngestProgress {
  phase: 'idle' | 'ingesting' | 'done' | 'error';
  loaded: number;
  total: number;
  error: Error | null;
}

export interface UseIngestProgressResult {
  progress: IngestProgress;
  ingest: (texts: string[], metadatas?: Record<string, unknown>[]) => Promise<void>;
}

/**
 * Batch-insert documents with live progress. Wraps `insertBatch`, reporting
 * per-document progress so the matter-workspace UI can render a bar.
 */
export function useIngestProgress(db: VectorDB | null): UseIngestProgressResult {
  const [progress, setProgress] = useState<IngestProgress>({
    phase: 'idle',
    loaded: 0,
    total: 0,
    error: null,
  });

  const ingest = useCallback(
    async (texts: string[], metadatas?: Record<string, unknown>[]) => {
      if (!db) return;
      setProgress({ phase: 'ingesting', loaded: 0, total: texts.length, error: null });
      try {
        // Insert in modest chunks so progress updates are meaningful and we
        // don't hold one giant transaction.
        const chunkSize = 10;
        let loaded = 0;
        for (let i = 0; i < texts.length; i += chunkSize) {
          const slice = texts.slice(i, i + chunkSize);
          const data = slice.map((text, j) => ({
            text,
            metadata: metadatas?.[i + j] ?? {},
          }));
          await db.insertBatch(data);
          loaded += slice.length;
          setProgress({ phase: 'ingesting', loaded, total: texts.length, error: null });
        }
        setProgress({ phase: 'done', loaded: texts.length, total: texts.length, error: null });
      } catch (err: unknown) {
        setProgress((p) => ({
          phase: 'error',
          loaded: p.loaded,
          total: p.total,
          error: err instanceof Error ? err : new Error(String(err)),
        }));
      }
    },
    [db]
  );

  return { progress, ingest };
}

export type {
  VectorDB,
  RAGPipelineManager,
  SearchResult,
  RAGResult,
  RAGStreamChunk,
  Capabilities,
};
