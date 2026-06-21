/**
 * Core seam contracts.
 *
 * These interfaces are the stable boundaries between Domicile's layers.
 * The facade (`VectorDB` / `Domicile`) is constructed from injected
 * implementations of these interfaces — it never imports a concrete
 * adapter. That is what makes every runtime component swappable
 * (Voy → hnsw, WebLLM → wllama → fallback) without touching the
 * residency boundary or the RAG pipeline.
 *
 * Zero runtime dependencies. Types only.
 */
export {};
//# sourceMappingURL=contracts.js.map