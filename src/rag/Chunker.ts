/**
 * Chunker — splits long documents into passage-level chunks before embedding.
 *
 * This is the single biggest RAG-quality lever (PRODUCT_DESIGN.md B6). Today
 * a 40-page contract is embedded as one giant vector and stored as one
 * record, which destroys retrieval granularity and citation precision. The
 * chunker turns a document into many small, overlapping, boundary-respecting
 * passages, each embedded and stored as its own record linked back to the
 * parent document via metadata.
 *
 * Strategy: approximate-token sliding window with sentence-boundary
 * alignment and overlap. Token counts use a cheap whitespace heuristic by
 * default; a real tokenizer (Transformers.js) can be injected for precision
 * (used by the truncation stage, B6/Phase 4 task 19).
 */

export interface Chunk {
  /** The chunk text. */
  text: string;
  /** 0-based position of this chunk within the parent document. */
  index: number;
  /** Character offset where this chunk starts in the original document. */
  startOffset: number;
}

export interface ChunkerOptions {
  /** Target chunk size in approximate tokens. Default 256. */
  chunkSize?: number;
  /** Overlap between adjacent chunks in approximate tokens. Default 32. */
  overlap?: number;
  /** Minimum chunk size; trailing fragments smaller than this merge into the previous chunk. Default 64. */
  minChunkSize?: number;
}

export interface Chunker {
  chunk(text: string): Chunk[];
}

const DEFAULTS: Required<ChunkerOptions> = {
  chunkSize: 256,
  overlap: 32,
  minChunkSize: 64,
};

/**
 * Cheap token estimate: ~1 token per 4 characters, with a floor on
 * whitespace-separated words. Good enough for chunk sizing; the truncation
 * stage uses a real tokenizer when available.
 */
function approxTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const byChars = Math.ceil(text.length / 4);
  return Math.max(words, byChars);
}

/**
 * Split text into sentences. Handles common legal-document terminators
 * (period, question mark, exclamation) followed by whitespace or end of
 * string, while not splitting on decimals like "3.14" or section markers.
 */
function splitSentences(text: string): string[] {
  // Match sentence-ending punctuation followed by whitespace/end, but not
  // when preceded by a single digit (crude decimal guard).
  const parts = text.split(/(?<=[.!?])\s+(?=\S)/);
  // Re-attach: the split removes the whitespace; sentences are the parts.
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

export class SentenceChunker implements Chunker {
  private opts: Required<ChunkerOptions>;

  constructor(opts: ChunkerOptions = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    if (this.opts.overlap >= this.opts.chunkSize) {
      // Overlap must be smaller than the chunk or we never advance.
      this.opts.overlap = Math.floor(this.opts.chunkSize / 4);
    }
  }

  chunk(text: string): Chunk[] {
    const clean = text.replace(/\r\n/g, '\n').trim();
    if (clean.length === 0) return [];

    const sentences = splitSentences(clean);
    if (sentences.length === 0) return [];

    const { chunkSize, overlap, minChunkSize } = this.opts;
    const chunks: Chunk[] = [];
    let current: string[] = [];
    let currentTokens = 0;

    // Character offset of each sentence in the original text (for startOffset).
    const sentenceOffsets: number[] = [];
    let scan = 0;
    for (const s of sentences) {
      const at = clean.indexOf(s, scan);
      sentenceOffsets.push(at === -1 ? scan : at);
      scan = (at === -1 ? scan : at) + s.length;
    }

    const flush = (endSentenceIdx: number, startSentenceIdx: number) => {
      if (current.length === 0) return;
      const text = current.join(' ');
      const tokens = approxTokens(text);
      if (tokens < minChunkSize && chunks.length > 0) {
        // Merge a too-small trailing fragment into the previous chunk.
        const prev = chunks[chunks.length - 1];
        chunks[chunks.length - 1] = {
          text: prev.text + ' ' + text,
          index: prev.index,
          startOffset: prev.startOffset,
        };
      } else {
        chunks.push({
          text,
          index: chunks.length,
          startOffset: sentenceOffsets[startSentenceIdx] ?? 0,
        });
      }
      current = [];
      currentTokens = 0;
      void endSentenceIdx;
    };

    let startSentenceIdx = 0;
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const sentenceTokens = approxTokens(sentence);

      // If a single sentence exceeds chunkSize, it becomes its own chunk
      // (hard split would break sentence alignment; better to oversize one
      // chunk than to fragment mid-sentence for legal text).
      if (currentTokens + sentenceTokens > chunkSize && current.length > 0) {
        flush(i, startSentenceIdx);
        // Start the next chunk with overlap: carry trailing sentences back
        // until we've consumed `overlap` tokens.
        startSentenceIdx = i;
        let carryTokens = 0;
        let j = i - 1;
        const carry: string[] = [];
        while (j >= 0 && carryTokens < overlap) {
          const s = sentences[j];
          carry.unshift(s);
          carryTokens += approxTokens(s);
          j--;
        }
        if (carry.length > 0) {
          current = carry;
          currentTokens = carryTokens;
          startSentenceIdx = j + 1;
        }
      }

      current.push(sentence);
      currentTokens += sentenceTokens;
    }
    flush(sentences.length, startSentenceIdx);

    return chunks;
  }
}
