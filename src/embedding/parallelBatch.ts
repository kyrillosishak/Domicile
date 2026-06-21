/**
 * Parallel batch embedding dispatch. Reserved for future use when the
 * `WorkerPool` worker source becomes a true standalone module; for v2.0
 * we operate in-process to keep the bundle slim.
 */

export function createInvocation(texts: string[]): { type: 'embed-batch'; payload: string[]; id: number } {
  return { type: 'embed-batch', payload: texts, id: Date.now() };
}
