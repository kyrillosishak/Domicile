/**
 * Mock factory for WebLLM MLCEngine
 * Provides deterministic text generation for testing without model downloads
 */
/**
 * Generate deterministic response based on prompt
 * Uses simple pattern matching and hashing for consistency
 */
function generateDeterministicResponse(prompt, maxTokens, responses, defaultResponse) {
    // Check for custom responses first
    if (responses?.has(prompt)) {
        return responses.get(prompt);
    }
    // Generate deterministic response based on prompt characteristics
    const baseResponse = defaultResponse || 'This is a mock response generated for testing purposes.';
    // Create variations based on prompt content
    let response = baseResponse;
    // Add prompt-specific content
    if (prompt.toLowerCase().includes('hello') || prompt.toLowerCase().includes('hi')) {
        response = 'Hello! How can I help you today?';
    }
    else if (prompt.toLowerCase().includes('what') || prompt.toLowerCase().includes('?')) {
        response = 'That is an interesting question. Let me provide a helpful answer.';
    }
    else if (prompt.toLowerCase().includes('explain') || prompt.toLowerCase().includes('describe')) {
        response = 'Let me explain this concept in detail. It involves several key aspects.';
    }
    // Respect max_tokens by truncating response
    const words = response.split(' ');
    const estimatedTokens = Math.ceil(words.length * 1.3); // Rough token estimation
    if (estimatedTokens > maxTokens) {
        const targetWords = Math.floor(maxTokens / 1.3);
        response = words.slice(0, targetWords).join(' ');
    }
    return response;
}
/**
 * Simulate streaming by yielding chunks of text
 */
async function* streamMockResponse(response, delay, chunkSize, model) {
    const words = response.split(' ');
    const id = `chatcmpl-mock-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    // Yield chunks of words
    for (let i = 0; i < words.length; i += chunkSize) {
        if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        const chunk = words.slice(i, i + chunkSize).join(' ');
        const content = i + chunkSize < words.length ? chunk + ' ' : chunk;
        yield {
            id,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{
                    delta: { content },
                    index: 0,
                    finish_reason: null,
                }],
        };
    }
    // Final chunk with finish_reason
    yield {
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{
                delta: {},
                index: 0,
                finish_reason: 'stop',
            }],
    };
}
/**
 * Create a mock WebLLM MLCEngine
 *
 * @param options Configuration options for the mock
 * @returns Mock MLCEngine with state tracking
 *
 * @example
 * ```typescript
 * const mockEngine = createMockMLCEngine({
 *   defaultResponse: 'Custom mock response',
 *   simulateDelay: 10
 * });
 *
 * const completion = await mockEngine.chat.completions.create({
 *   messages: [{ role: 'user', content: 'Hello' }]
 * });
 * console.log(completion.choices[0].message.content);
 * ```
 */
export function createMockMLCEngine(options = {}) {
    const { simulateDelay = 0, responses, defaultResponse, streamChunkSize = 3, } = options;
    // Track mock state
    const state = {
        initialized: true,
        disposed: false,
        callCount: 0,
        lastPrompt: null,
        lastResponse: null,
        chatHistory: [],
    };
    const mockEngine = {
        chat: {
            completions: {
                create(params) {
                    if (state.disposed) {
                        throw new Error('Engine has been disposed');
                    }
                    // Extract the user prompt from messages
                    const userMessage = params.messages.find(m => m.role === 'user');
                    const prompt = userMessage?.content || '';
                    // Update state
                    state.callCount++;
                    state.lastPrompt = prompt;
                    state.chatHistory.push(...params.messages);
                    const maxTokens = params.max_tokens || 512;
                    const model = 'mock-model';
                    // Generate response
                    const responseText = generateDeterministicResponse(prompt, maxTokens, responses, defaultResponse);
                    state.lastResponse = responseText;
                    // Handle streaming vs non-streaming
                    if (params.stream) {
                        return streamMockResponse(responseText, simulateDelay, streamChunkSize, model);
                    }
                    else {
                        // Non-streaming response
                        const completion = {
                            id: `chatcmpl-mock-${Date.now()}`,
                            object: 'chat.completion',
                            created: Math.floor(Date.now() / 1000),
                            model,
                            choices: [{
                                    message: {
                                        role: 'assistant',
                                        content: responseText,
                                    },
                                    index: 0,
                                    finish_reason: 'stop',
                                }],
                            usage: {
                                prompt_tokens: Math.ceil(prompt.length / 4),
                                completion_tokens: Math.ceil(responseText.length / 4),
                                total_tokens: Math.ceil((prompt.length + responseText.length) / 4),
                            },
                        };
                        // Simulate async delay if configured
                        if (simulateDelay > 0) {
                            return new Promise(resolve => {
                                setTimeout(() => resolve(completion), simulateDelay);
                            });
                        }
                        return Promise.resolve(completion);
                    }
                },
            },
        },
        async unload() {
            state.disposed = true;
            state.chatHistory = [];
            state.lastPrompt = null;
            state.lastResponse = null;
        },
        async runtimeStatsText() {
            if (state.disposed) {
                throw new Error('Engine has been disposed');
            }
            return `Mock Runtime Stats:
- Calls: ${state.callCount}
- Chat History Length: ${state.chatHistory.length}
- Last Prompt: ${state.lastPrompt || 'None'}
- Status: ${state.disposed ? 'Disposed' : 'Active'}`;
        },
        async resetChat() {
            if (state.disposed) {
                throw new Error('Engine has been disposed');
            }
            state.chatHistory = [];
            state.lastPrompt = null;
            state.lastResponse = null;
        },
        _mockState: state,
    };
    return mockEngine;
}
//# sourceMappingURL=webllm.js.map