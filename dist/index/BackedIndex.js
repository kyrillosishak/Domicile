/**
 * BackedIndex — the seam between the public IndexManager and any ANN implementation.
 *
 * Two stable contracts:
 *  - numeric labels ↔ stable string ids (the label is internal, the id is external)
 *  - serialize()/load() round-trip a 2.x binary blob (header + body)
 *
 * The label map lives in `indexes.BackedIndex` instance, NOT in the ANN: this
 * lets us swap HNSW for BruteForceSearch without losing id mapping.
 */
export {};
//# sourceMappingURL=BackedIndex.js.map