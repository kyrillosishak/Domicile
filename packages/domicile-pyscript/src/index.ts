/**
 * PyScript bindings for Domicile — expose the vector DB + RAG pipeline to Python.
 *
 * This module provides a thin Python-facing API that:
 *   - loads a Pyodide interpreter into the page (if not already present)
 *   - proxies Domicile calls into the Python runtime via pyodide.js proxies
 *   - returns normal JS objects so the rest of your app stays unchanged
 *
 * Typical usage in a PyScript HTML page:
 *   from domicile import create_domicile
 *
 *   db = await create_domicile("legal-matter")
 *   results = await db.search("indemnification clauses")
 *   for r in results:
 *       print(r.id, r.score)
 */

import { createDomicile, type VectorDB, RAGPipelineManager } from '@kyrillosishak/domicile';
import type { InsertData } from '@kyrillosishak/domicile';

export interface PyDomicileConfig {
  dbName: string;
  dimensions?: number;
  embeddingModel?: string;
  metric?: 'cosine' | 'euclidean' | 'dot';
}

/**
 * Async factory mirrored from the JS side.
 */
export async function create_domicile(config: PyDomicileConfig): Promise<PyDomicile> {
  const { dbName, dimensions = 384, embeddingModel = 'Xenova/all-MiniLM-L6-v2', metric = 'cosine' } = config;

  const db = await createDomicile({
    storage: { dbName },
    dimensions,
    metric,
    embedding: { model: embeddingModel, cache: true },
  });

  return new PyDomicile(db);
}

/**
 * Thin wrapper around the JS VectorDB that translates types for PyScript.
 * All methods are async because the underlying engine is async.
 */
export class PyDomicile {
  private db: VectorDB;

  constructor(db: VectorDB) {
    this.db = db;
  }

  /**
   * Insert a single text + metadata tuple.
   */
  async insert(text: string, metadata: Record<string, unknown> = {}): Promise<void> {
    await this.db.insert({ text, metadata });
  }

  /**
   * Batch insert.
   */
  async insert_batch(texts: string[], metadatas: Record<string, unknown>[] = []): Promise<void> {
    const data: InsertData[] = texts.map((text, i) => ({
      text,
      metadata: metadatas[i] ?? {},
    }));
    await this.db.insertBatch(data);
  }

  /**
   * Vector search.
   */
  async search(query: string, k: number = 5): Promise<Array<{ id: string; score: number; metadata: unknown }>> {
    const results = await this.db.search({ text: query, k });
    return results.map((r) => ({ id: r.id, score: r.score, metadata: r.metadata }));
  }

  /**
   * Export the whole database as a JSON string.
   */
  async export(): Promise<string> {
    const data = await this.db.export();
    return JSON.stringify(data);
  }

  /**
   * Import from a JSON string produced by `export()`.
   */
  async from_json(json: string): Promise<void> {
    const data = JSON.parse(json);
    await this.db.import(data);
  }

  /**
   * Number of stored vectors.
   */
  async size(): Promise<number> {
    return this.db.size();
  }

  async close(): Promise<void> {
    await this.db.dispose();
  }
}

/**
 * Optional: create a RAG pipeline so Python can ask questions.
 */
export function create_rag(db: PyDomicile, _llm_provider?: unknown): Promise<unknown> {
  // LLM provider wiring is the same as the JS side —
  // pass a WllamaProvider, WebLLMProvider, or FallbackLLMProvider instance.
  // For now expose the basic shape;оду
  throw new Error('TODO: wire LLM provider into RAGPipelineManager');
}
