/**
 * RAGPipelineManager - Orchestrates retrieval and generation for RAG workflows
 *
 * Pipeline stages (PRODUCT_DESIGN.md B6):
 *  1. Retrieve   — dense ANN search, optionally fused with BM25 (hybrid)
 *  2. Rerank     — optional cross-encoder re-scoring of top-K
 *  3. Format     — context from retrieved passages via a configurable template
 *  4. Truncate   — to the model's context budget using a REAL tokenizer
 *  5. Prompt     — configurable system instruction + context + question
 *  6. Generate   — LLM, streaming or not
 *  7. Cite       — bind the answer to source passages as Citation[]
 */
import { CharTokenizer } from './Tokenizer';
import { NoopReranker } from './Reranker';
import { BM25Index, reciprocalRankFusion } from './HybridSearch';
import { VectorDBError } from '../errors';
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant. Use the following context to answer the user\'s question. ' +
    'If the context doesn\'t contain relevant information, say so. ' +
    'Cite sources by their [n] number when grounding a claim.';
const DEFAULT_PROMPT_TEMPLATE = `{system}

Context:
{context}

Question: {question}

Answer:`;
/**
 * RAGPipelineManager - Implements the RAG (Retrieval-Augmented Generation) pipeline
 */
export class RAGPipelineManager {
    constructor(config) {
        this.vectorDB = config.vectorDB;
        this.llmProvider = config.llmProvider;
        this.embeddingGenerator = config.embeddingGenerator;
        this.defaultContextTemplate = config.defaultContextTemplate || this.getDefaultTemplate();
        this.defaultPromptTemplate = config.defaultPromptTemplate ?? {};
        this.defaultMaxContextTokens = config.defaultMaxContextTokens || 2000;
        this.tokenizer = config.tokenizer ?? new CharTokenizer();
        this.reranker = config.reranker ?? new NoopReranker();
        this.bm25 = new BM25Index();
        this.hybridByDefault = config.hybridByDefault ?? false;
        this.rerankByDefault = config.rerankByDefault ?? false;
        this.retrieveMultiplier = config.retrieveMultiplier ?? 4;
    }
    /**
     * Index a document's text into the BM25 sparse index for hybrid search.
     * Call this when documents are added to the vector DB so the sparse index
     * stays in sync. (The dense index is maintained by VectorDB itself.)
     */
    indexDocument(id, text) {
        this.bm25.add(id, text);
    }
    /** Remove a document from the BM25 sparse index. */
    removeDocument(id) {
        this.bm25.remove(id);
    }
    /**
     * Swap the LLM provider at runtime. Used by UIs that boot with a
     * retrieval-only (noop) provider and upgrade to a real local LLM once its
     * model finishes loading in the background.
     */
    setLLMProvider(provider) {
        this.llmProvider = provider;
    }
    /** The active LLM provider (for UI status display). */
    getLLMProvider() {
        return this.llmProvider;
    }
    /**
     * Execute a RAG query: retrieve relevant documents and generate a response
     *
     * @param query - User query text
     * @param options - RAG options including topK, filters, and generation settings
     * @returns RAG result with answer, sources, and metadata
     */
    async query(query, options) {
        try {
            const useHybrid = options?.hybrid ?? this.hybridByDefault;
            const useRerank = options?.rerank ?? this.rerankByDefault;
            // Step 1: Retrieve (dense, optionally fused with BM25)
            const retrievalStart = Date.now();
            let sources = await this.retrieve(query, options, useHybrid);
            // Step 2: Rerank (optional cross-encoder re-scoring)
            let reranked = false;
            if (useRerank && sources.length > 1) {
                sources = await this.reranker.rerank(query, sources);
                reranked = this.reranker.isReady();
            }
            const retrievalTime = Date.now() - retrievalStart;
            // Step 3: Format context from retrieved passages
            const context = this.formatContext(sources, options);
            // Step 4: Truncate using the real tokenizer
            const maxTokens = options?.maxContextTokens || this.defaultMaxContextTokens;
            const truncatedContext = await this.tokenizer.truncate(context, maxTokens);
            // Step 5: Build prompt with configurable template
            const prompt = this.buildPrompt(query, truncatedContext, options?.promptTemplate);
            // Step 6: Generate
            const generationStart = Date.now();
            const answer = await this.llmProvider.generate(prompt, options?.generateOptions);
            const generationTime = Date.now() - generationStart;
            // Step 7: Token accounting + citations
            const tokensGenerated = await this.tokenizer.count(answer);
            const contextLength = await this.tokenizer.count(truncatedContext);
            const citations = this.buildCitations(sources);
            return {
                answer,
                sources: options?.includeSourcesInResponse !== false ? sources : [],
                citations,
                metadata: {
                    retrievalTime,
                    generationTime,
                    tokensGenerated,
                    contextLength,
                    reranked,
                    hybrid: useHybrid,
                },
            };
        }
        catch (error) {
            throw new VectorDBError('Failed to execute RAG query', 'RAG_QUERY_ERROR', { error, query });
        }
    }
    /**
     * Execute a streaming RAG query: retrieve documents and stream the generated response
     *
     * @param query - User query text
     * @param options - RAG options including topK, filters, and generation settings
     * @yields RAG stream chunks with retrieval results and generated text
     */
    async *queryStream(query, options) {
        try {
            const useHybrid = options?.hybrid ?? this.hybridByDefault;
            const useRerank = options?.rerank ?? this.rerankByDefault;
            // Step 1: Retrieve (+ optional hybrid + rerank)
            const retrievalStart = Date.now();
            let sources = await this.retrieve(query, options, useHybrid);
            if (useRerank && sources.length > 1) {
                sources = await this.reranker.rerank(query, sources);
            }
            const retrievalTime = Date.now() - retrievalStart;
            yield {
                type: 'retrieval',
                content: '',
                sources: options?.includeSourcesInResponse !== false ? sources : [],
                metadata: { retrievalTime },
            };
            // Step 2-4: format, truncate (real tokenizer), prompt
            const context = this.formatContext(sources, options);
            const maxTokens = options?.maxContextTokens || this.defaultMaxContextTokens;
            const truncatedContext = await this.tokenizer.truncate(context, maxTokens);
            const prompt = this.buildPrompt(query, truncatedContext, options?.promptTemplate);
            // Step 5: Stream generated response
            const generationStart = Date.now();
            for await (const chunk of this.llmProvider.generateStream(prompt, options?.generateOptions)) {
                yield {
                    type: 'generation',
                    content: chunk,
                };
            }
            const generationTime = Date.now() - generationStart;
            yield {
                type: 'complete',
                content: '',
                metadata: {
                    retrievalTime,
                    generationTime,
                },
            };
        }
        catch (error) {
            throw new VectorDBError('Failed to execute streaming RAG query', 'RAG_STREAM_ERROR', { error, query });
        }
    }
    /**
     * Retrieve relevant documents for a query
     *
     * @param query - User query text
     * @param options - RAG options with topK and filter
     * @returns Array of search results
     */
    async retrieve(query, options, useHybrid = false) {
        // Generate query embedding
        const queryVector = await this.embeddingGenerator.embed(query);
        const topK = options?.topK || 5;
        // Over-retrieve when reranking or fusing so the later stages have a
        // candidate pool to reorder, then trim back to topK.
        const retrieveK = (options?.rerank ?? this.rerankByDefault) || useHybrid
            ? topK * this.retrieveMultiplier
            : topK;
        // Dense retrieval
        const dense = await this.vectorDB.search({
            vector: queryVector,
            k: retrieveK,
            filter: options?.filter,
            includeVectors: false,
        });
        if (!useHybrid || this.bm25.size() === 0) {
            return dense.slice(0, topK);
        }
        // Sparse (BM25) retrieval over the same corpus
        const sparse = this.bm25.search(query).slice(0, retrieveK);
        // Fuse via Reciprocal Rank Fusion. Dense hits carry their metadata;
        // sparse-only hits are hydrated from the dense results when present.
        const denseById = new Map(dense.map((r) => [r.id, r]));
        const fused = reciprocalRankFusion(dense.map((r) => ({ id: r.id })), sparse).slice(0, topK);
        return fused.map((f) => {
            const hit = denseById.get(f.id);
            if (hit)
                return { ...hit, score: f.score };
            // Sparse-only hit: minimal record (metadata hydrable by caller).
            return { id: f.id, score: f.score, metadata: {} };
        });
    }
    /**
     * Format context from retrieved documents using a template
     *
     * @param results - Search results to format
     * @param options - RAG options with optional context template
     * @returns Formatted context string
     */
    formatContext(results, options) {
        if (results.length === 0) {
            return 'No relevant information found.';
        }
        const itemTemplate = options?.promptTemplate?.contextItemTemplate
            ?? options?.contextTemplate
            ?? this.defaultPromptTemplate?.contextItemTemplate
            ?? this.defaultContextTemplate;
        const join = options?.promptTemplate?.contextJoin
            ?? this.defaultPromptTemplate?.contextJoin
            ?? '\n\n';
        const formattedResults = results.map((result, index) => {
            return this.applyTemplate(itemTemplate, result, index);
        });
        return formattedResults.join(join);
    }
    /**
     * Apply a template to a search result
     *
     * @param template - Template string with placeholders
     * @param result - Search result to format
     * @param index - Result index (0-based)
     * @returns Formatted string
     */
    applyTemplate(template, result, index) {
        let formatted = template;
        // Replace placeholders
        formatted = formatted.replace(/\{index\}/g, String(index + 1));
        formatted = formatted.replace(/\{score\}/g, result.score.toFixed(4));
        formatted = formatted.replace(/\{content\}/g, result.metadata.content || '');
        formatted = formatted.replace(/\{title\}/g, result.metadata.title || '');
        formatted = formatted.replace(/\{url\}/g, result.metadata.url || '');
        formatted = formatted.replace(/\{id\}/g, result.id);
        // Replace any custom metadata fields
        formatted = formatted.replace(/\{metadata\.(\w+)\}/g, (_match, field) => {
            return result.metadata[field] !== undefined ? String(result.metadata[field]) : '';
        });
        return formatted;
    }
    /**
     * Build a prompt with context injection, using a configurable template.
     *
     * Replaces the previously hardcoded English instruction. Callers pass a
     * PromptTemplate (system, contextItemTemplate, template) for
     * jurisdiction-aware or domain-specific instructions.
     */
    buildPrompt(query, context, templateOverride) {
        const tpl = templateOverride ?? this.defaultPromptTemplate;
        const system = tpl.system ?? DEFAULT_SYSTEM_PROMPT;
        const template = tpl.template ?? DEFAULT_PROMPT_TEMPLATE;
        return template
            .replace('{system}', system)
            .replace('{context}', context)
            .replace('{question}', query);
    }
    /**
     * Build citation objects binding the answer back to its source passages.
     * Each citation carries the source id, score, a snippet, metadata, and a
     * 1-based rank — the audit trail that makes privilege-grounded answers
     * reviewable (PRODUCT_DESIGN.md B6, stage 7).
     */
    buildCitations(sources) {
        return sources.map((s, i) => ({
            id: s.id,
            score: s.score,
            snippet: this.snippetOf(s),
            metadata: s.metadata ?? {},
            rank: i + 1,
        }));
    }
    snippetOf(s) {
        const content = s.metadata?.content;
        if (typeof content === 'string')
            return content.slice(0, 280);
        if (typeof s.metadata?.title === 'string')
            return s.metadata.title;
        return '';
    }
    /**
     * Get the default context template
     *
     * @returns Default template string
     */
    getDefaultTemplate() {
        return `Document {index}:
{content}`;
    }
    /**
     * Set a custom context template
     *
     * @param template - Template string with placeholders
     */
    setContextTemplate(template) {
        this.defaultContextTemplate = template;
    }
    /**
     * Set the default maximum context tokens
     *
     * @param maxTokens - Maximum number of tokens for context
     */
    setMaxContextTokens(maxTokens) {
        this.defaultMaxContextTokens = maxTokens;
    }
    /**
     * Get current configuration
     *
     * @returns Current RAG pipeline configuration
     */
    getConfig() {
        return {
            defaultContextTemplate: this.defaultContextTemplate,
            defaultMaxContextTokens: this.defaultMaxContextTokens,
        };
    }
}
//# sourceMappingURL=RAGPipelineManager.js.map