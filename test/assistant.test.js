import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AIMessage, HumanMessage } from '@langchain/core/messages';

import { LeadAssistant } from '../src/ai/assistant.js';
import { createLeadTools, summarize, toFunctionSpec } from '../src/ai/tools.js';

// plays the model: returns canned messages in order and records what it was sent
class ScriptedModel {
    constructor(responses) {
        this.responses = responses;
        this.calls = [];
        this.boundTools = null;
    }

    bindTools(tools) {
        this.boundTools = tools;
        return this;
    }

    async invoke(messages) {
        this.calls.push([...messages]);
        return this.responses.shift();
    }
}

const toolCall = (name, args, id = `call_${name}`) => new AIMessage({ content: '', tool_calls: [{ id, name, args }] });

const lead = {
    id: 3,
    memberId: 'U0123ABC',
    name: 'Jane Doe',
    title: 'CTO',
    email: 'jane@acme.com',
    fitScore: 91,
    confidence: 'high',
    segment: 'Engineering leader',
    summary: 'Runs the platform team at Acme',
    insights: ['Owns the infra budget'],
    recommendations: ['Offer a demo'],
    research: [{ type: 'github', title: 'GitHub: jdoe', url: 'https://github.com/jdoe', content: 'lots of text' }],
    analyzedAt: new Date('2026-10-27T10:00:00Z')
};

function fakeStore() {
    const calls = [];
    return {
        calls,
        getTopLeads: async options => { calls.push(['getTopLeads', options]); return [lead]; },
        getStats: async days => { calls.push(['getStats', days]); return { days, total: 1 }; },
        searchMembers: async (text, options) => { calls.push(['searchMembers', text, options]); return text === 'nobody' ? [] : [lead]; },
        getAnalysis: async id => { calls.push(['getAnalysis', id]); return lead; },
        getLatestAnalysis: async memberId => { calls.push(['getLatestAnalysis', memberId]); return lead; }
    };
}

const findTool = (store, name) => createLeadTools(store).find(item => item.name === name);

describe('lead tools', () => {
    test('summaries carry the domain but never the email address', () => {
        const summary = summarize(lead);

        assert.equal(summary.emailDomain, 'acme.com');
        assert.equal(summary.tier, 'hot');
        assert.doesNotMatch(JSON.stringify(summary), /jane@/);
    });

    test('get_top_leads clamps whatever the model asks for', async () => {
        const store = fakeStore();
        const tool = findTool(store, 'get_top_leads');

        await tool.invoke({ days: 9999, limit: 500, minScore: -10 });
        await tool.invoke({});
        await tool.invoke({ days: '14' });

        assert.deepEqual(store.calls.map(call => call[1]), [
            { days: 365, limit: 20, minScore: 0 },
            { days: 30, limit: 10, minScore: 0 },
            { days: 14, limit: 10, minScore: 0 }
        ]);
    });

    test('get_member finds people by slack id, analysis id or name', async () => {
        const store = fakeStore();
        const tool = findTool(store, 'get_member');

        await tool.invoke({ member: 'U0123ABC' });
        await tool.invoke({ member: '42' });
        const byName = JSON.parse(await tool.invoke({ member: 'Jane' }));

        assert.deepEqual(store.calls.map(call => call[0]), ['getLatestAnalysis', 'getAnalysis', 'searchMembers']);
        assert.deepEqual(byName.sources, [{ type: 'github', title: 'GitHub: jdoe', url: 'https://github.com/jdoe' }]);
        assert.equal(await tool.invoke({ member: 'nobody' }), 'No analysis found for that member.');
    });

    test('function specs leave out keys some providers reject', () => {
        const specs = createLeadTools(fakeStore()).map(toFunctionSpec);

        assert.deepEqual(specs.map(spec => spec.function.name), ['get_top_leads', 'search_members', 'get_member', 'get_stats']);
        for (const spec of specs) {
            assert.equal(spec.function.parameters.type, 'object');
            assert.equal('$schema' in spec.function.parameters, false);
            assert.equal('additionalProperties' in spec.function.parameters, false);
        }
    });
});

describe('LeadAssistant', () => {
    test('runs the lookups the model asks for and returns its answer', async () => {
        const store = fakeStore();
        const model = new ScriptedModel([
            toolCall('get_top_leads', { days: 7 }),
            new AIMessage('*Jane Doe* (91) is the best lead this week.')
        ]);
        const assistant = new LeadAssistant(model, { tools: createLeadTools(store) });

        const reply = await assistant.ask('best leads this week?');

        assert.equal(reply, '*Jane Doe* (91) is the best lead this week.');
        assert.deepEqual(store.calls[0], ['getTopLeads', { days: 7, limit: 10, minScore: 0 }]);
        assert.equal(model.boundTools.length, 4);

        const toolResult = model.calls[1].at(-1);
        assert.equal(toolResult.tool_call_id, 'call_get_top_leads');
        assert.match(toolResult.content, /"fitScore":91/);
        assert.doesNotMatch(toolResult.content, /jane@acme\.com/);
    });

    test('hands tool errors back so the model can recover', async () => {
        const model = new ScriptedModel([
            toolCall('search_members', { query: 'x' }),
            toolCall('drop_tables', {}),
            new AIMessage('Nothing matched.')
        ]);
        const assistant = new LeadAssistant(model, { tools: createLeadTools(fakeStore()) });

        assert.equal(await assistant.ask('find x'), 'Nothing matched.');
        assert.match(model.calls[1].at(-1).content, /^Tool failed/);
        assert.match(model.calls[2].at(-1).content, /Unknown tool "drop_tables"/);
    });

    test('gives up after maxSteps instead of looping forever', async () => {
        const model = new ScriptedModel(Array.from({ length: 5 }, (_, i) => toolCall('get_stats', {}, `call_${i}`)));
        const assistant = new LeadAssistant(model, { tools: createLeadTools(fakeStore()), maxSteps: 3 });

        assert.match(await assistant.ask('keep going'), /couldn't get to an answer/);
        assert.equal(model.calls.length, 3);
    });

    test('sends earlier turns and today\'s date', async () => {
        const model = new ScriptedModel([new AIMessage('She is a CTO.')]);
        const assistant = new LeadAssistant(model, { tools: [] });

        await assistant.ask('and her title?', [new HumanMessage('who is jane?'), new AIMessage('Jane Doe, 91.')]);

        const sent = model.calls[0];
        assert.equal(sent.length, 4);
        assert.match(sent[0].text, /Today is \d{4}-\d{2}-\d{2}/);
        assert.equal(sent.at(-1).text, 'and her title?');
    });

    test('an empty final message still gets a reply', async () => {
        const assistant = new LeadAssistant(new ScriptedModel([new AIMessage('')]), { tools: [] });
        assert.equal(await assistant.ask('hello?'), "I don't have an answer for that.");
    });
});
