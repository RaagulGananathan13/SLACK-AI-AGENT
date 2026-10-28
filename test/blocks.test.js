import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { analysisMessage, escape } from '../src/slack/blocks.js';

const record = {
    id: 7,
    memberId: 'U123',
    name: 'Jane Doe',
    email: 'jane@acme.com',
    title: '<!channel> CTO',
    fitScore: 86,
    confidence: 'high',
    segment: 'Engineering leader',
    summary: 'Runs <b>platform</b> & infra',
    insights: ['Mentions <!here> a lot'],
    recommendations: ['Offer a demo'],
    research: [
        { type: 'github', url: 'https://github.com/jdoe', title: 'GitHub: jdoe' },
        { type: 'company', url: 'javascript:alert(1)', title: 'bad' }
    ],
    model: 'llama-3.3-70b-versatile (groq)',
    analyzedAt: new Date('2026-10-28T04:00:00Z')
};

const blocksOf = message => message.attachments[0].blocks;

describe('analysisMessage', () => {
    test('escapes text that came from the member or the model', () => {
        const json = JSON.stringify(analysisMessage(record));

        assert.doesNotMatch(json, /<!channel>|<!here>|<b>/);
        assert.match(json, /&lt;!channel&gt; CTO/);
        assert.match(json, /&amp; infra/);
    });

    test('mentions the member when there is a slack id', () => {
        assert.match(JSON.stringify(analysisMessage(record)), /<@U123>/);
        assert.doesNotMatch(JSON.stringify(analysisMessage({ ...record, memberId: null })), /<@/);
    });

    test('picks the color from the score tier', () => {
        assert.equal(analysisMessage(record).attachments[0].color, '#36a64f');
        assert.equal(analysisMessage({ ...record, fitScore: 45 }).attachments[0].color, '#ff9500');
        assert.equal(analysisMessage({ ...record, fitScore: 0 }).attachments[0].color, '#ff4444');
    });

    test('only links http sources', () => {
        const context = blocksOf(analysisMessage(record)).at(-1).elements[0].text;

        assert.match(context, /<https:\/\/github\.com\/jdoe\|GitHub: jdoe>/);
        assert.doesNotMatch(context, /javascript:/);
    });

    test('keeps the header under the 150 character limit', () => {
        const header = blocksOf(analysisMessage({ ...record, name: 'x'.repeat(300) }))[0];
        assert.ok(header.text.text.length <= 150);
    });

    test('works for a sparse record', () => {
        const message = analysisMessage({ name: 'Sam', fitScore: 50, insights: [], recommendations: [] });
        assert.equal(blocksOf(message).length, 3);
    });
});

test('escape handles slack control characters', () => {
    assert.equal(escape('<@U1> & <!here>'), '&lt;@U1&gt; &amp; &lt;!here&gt;');
    assert.equal(escape(undefined), '');
});
