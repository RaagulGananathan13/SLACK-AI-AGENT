import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AIMessage } from '@langchain/core/messages';

import { checkCase, runEval, summarize } from '../eval/harness.js';
import { ScriptedModel } from './helpers/fake-slack.js';

const dataset = JSON.parse(readFileSync(new URL('../eval/cases.json', import.meta.url), 'utf8'));

const reply = (fitScore, confidence = 'high') => new AIMessage(JSON.stringify({
    fitScore, confidence, insights: ['x'], recommendations: ['y']
}));

test('checkCase compares against the band and the expected confidence', () => {
    assert.deepEqual(checkCase({ min: 70, max: 100 }, { fitScore: 85 }), { pass: true, problems: [], distance: 0 });
    assert.deepEqual(checkCase({ min: 70, max: 100 }, { fitScore: 60 }), {
        pass: false,
        problems: ['score 60 outside 70-100'],
        distance: 10
    });

    const thin = checkCase({ min: 0, max: 55, confidence: 'low' }, { fitScore: 30, confidence: 'medium' });
    assert.equal(thin.pass, false);
    assert.deepEqual(thin.problems, ['confidence medium, expected low']);
});

test('the dataset is well formed', () => {
    const ids = dataset.cases.map(testCase => testCase.id);
    assert.equal(new Set(ids).size, ids.length);

    for (const { id, member, research, expect } of dataset.cases) {
        assert.ok(member.name, id);
        assert.ok(Array.isArray(research), id);
        assert.ok(expect.min >= 0 && expect.max <= 100 && expect.min <= expect.max, id);
    }
    assert.ok(ids.includes('prompt-injection'));
});

test('runEval reports passes, misses and broken answers', async () => {
    const model = new ScriptedModel([reply(90), reply(20), new AIMessage('no json'), new AIMessage('still none')]);
    const cases = [
        { id: 'a', member: { name: 'A' }, research: [], expect: { min: 70, max: 100 } },
        { id: 'b', member: { name: 'B' }, research: [], expect: { min: 50, max: 100 } },
        { id: 'c', member: { name: 'C' }, research: [], expect: { min: 0, max: 100 } }
    ];
    const seen = [];

    const results = await runEval(model, cases, { onResult: result => seen.push(result.id) });

    assert.deepEqual(seen, ['a', 'b', 'c']);
    assert.deepEqual(results.map(result => result.pass), [true, false, false]);
    assert.equal(results[1].distance, 30);
    assert.match(results[2].problems[0], /invalid output/);

    const summary = summarize(results);
    assert.equal(summary.passed, 1);
    assert.equal(summary.total, 3);
    assert.equal(summary.meanDistance, 15);
});
