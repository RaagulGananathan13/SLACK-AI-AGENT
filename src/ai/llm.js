import { ChatOpenAI } from '@langchain/openai';

import config from '../config.js';

export function createChatModel(options = {}) {
    const { model, baseURL, apiKey, temperature } = config.llm;

    return new ChatOpenAI({
        model,
        temperature,
        // ollama ignores the key but the openai client refuses to start without one
        apiKey: apiKey || 'none',
        timeout: 60000,
        maxRetries: 3,
        ...(baseURL && { configuration: { baseURL } }),
        // gpt-6 models reject temperature/tools on chat completions unless reasoning is off
        ...(model?.startsWith('gpt-6') && { modelKwargs: { reasoning_effort: 'none' } }),
        ...options
    });
}
