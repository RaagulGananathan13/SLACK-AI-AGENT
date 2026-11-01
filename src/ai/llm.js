import { ChatOpenAI } from '@langchain/openai';

import config from '../config.js';

// gpt-6 only allows tool calls on chat completions with reasoning turned off, and gpt-oss
// burns through groq's free tokens-per-minute budget unless its reasoning stays short
export function reasoningEffort(model = '') {
    if (model.startsWith('gpt-6')) return 'none';
    if (model.includes('gpt-oss')) return 'low';
    return null;
}

export function createChatModel(options = {}) {
    const { model, baseURL, apiKey, temperature } = config.llm;
    const effort = reasoningEffort(model);

    return new ChatOpenAI({
        model,
        temperature,
        // ollama ignores the key but the openai client refuses to start without one
        apiKey: apiKey || 'none',
        timeout: 60000,
        maxRetries: 3,
        ...(baseURL && { configuration: { baseURL } }),
        ...(effort && { modelKwargs: { reasoning_effort: effort } }),
        ...options
    });
}
