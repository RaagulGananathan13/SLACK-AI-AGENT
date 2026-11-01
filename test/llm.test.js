import { test } from 'node:test';
import assert from 'node:assert/strict';

import { reasoningEffort } from '../src/ai/llm.js';

test('reasoning is turned off for gpt-6 and kept short for gpt-oss', () => {
    assert.equal(reasoningEffort('gpt-6-luna'), 'none');
    assert.equal(reasoningEffort('openai/gpt-oss-120b'), 'low');
    assert.equal(reasoningEffort('gpt-oss:20b'), 'low');
});

test('other models get no reasoning parameter at all', () => {
    for (const model of ['gemini-3.8-flash', 'llama3.1', 'openrouter/free', undefined]) {
        assert.equal(reasoningEffort(model), null, String(model));
    }
});
