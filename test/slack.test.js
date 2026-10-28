import './helpers/env.js';

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { AIMessage } from '@langchain/core/messages';

import * as db from '../src/db.js';
import { SlackAIAgent } from '../src/agent.js';
import {
    startFakeSlack, createTestApp, dispatch, eventBody, actionBody, commandBody, viewBody, waitFor, ScriptedModel
} from './helpers/fake-slack.js';

// no email and a one word name, so research doesn't go out to the network
const jane = { id: 'UJANE', name: 'jane', real_name: 'Jane', tz: 'Asia/Colombo', profile: { title: 'Founder' } };

let slack;
let model;
let agent;

before(async () => {
    slack = await startFakeSlack({ members: ['UTEAM', 'UBOT'], users: { UJANE: jane } });
    model = new ScriptedModel();
    agent = new SlackAIAgent({ slack: createTestApp(slack), model });
});

after(() => slack.close());

beforeEach(() => {
    slack.reset();
    model.responses.length = 0;
    agent.access.reset();
});

const lastResponse = () => slack.responses.at(-1);

describe('slack wiring', () => {
    test('outsiders get turned away by the slash command', async () => {
        const acks = await dispatch(agent.slack, commandBody(slack, 'stats', { user_id: 'USTRANGER' }));

        assert.equal(acks.length, 1);
        assert.match(lastResponse().text, /Only members of <#CLEADS>/);
    });

    test('unknown subcommands get the help text', async () => {
        await dispatch(agent.slack, commandBody(slack, 'dance'));
        assert.match(lastResponse().text, /\/agent analyze @someone/);
    });

    test('analyze without a mention explains how to use it', async () => {
        await dispatch(agent.slack, commandBody(slack, 'analyze jane'));
        assert.match(lastResponse().text, /Usage: `\/agent analyze @someone`/);
    });

    test('the home tab is locked for outsiders', async () => {
        await dispatch(agent.slack, eventBody({ type: 'app_home_opened', user: 'USTRANGER', tab: 'home', channel: 'DSTRANGER' }));

        const [publish] = slack.callsTo('views.publish');
        assert.equal(publish.user_id, 'USTRANGER');
        assert.match(JSON.stringify(publish.view), /only for members of the private leads channel/);
    });

    test('mentions from outsiders never reach the model', async () => {
        const before = model.calls.length;
        await dispatch(agent.slack, eventBody({
            type: 'app_mention', user: 'USTRANGER', text: '<@UBOT> top leads?', channel: 'CLEADS', ts: '5.000100'
        }));

        const [reply] = slack.callsTo('chat.postMessage');
        assert.equal(reply.thread_ts, '5.000100');
        assert.match(reply.text, /only answer questions from members/);
        assert.equal(model.calls.length, before);
    });

    test('lead data stays out of public channels', async () => {
        await dispatch(agent.slack, eventBody({
            type: 'app_mention', user: 'UTEAM', text: '<@UBOT> top leads?', channel: 'CPUBLIC', ts: '6.000100'
        }));
        assert.match(slack.callsTo('chat.postMessage')[0].text, /only talk about leads in <#CLEADS>/);
    });

    test('a DM is answered in place by the assistant', async () => {
        model.responses.push(new AIMessage('**Nobody** new yet.'));
        await dispatch(agent.slack, eventBody({
            type: 'message', channel_type: 'im', user: 'UTEAM', text: 'anyone new?', channel: 'DTEAM', ts: '7.000100'
        }));

        const [placeholder] = slack.callsTo('chat.postMessage');
        assert.equal(placeholder.channel, 'DTEAM');
        assert.equal(placeholder.thread_ts, undefined);
        assert.equal(slack.callsTo('chat.update')[0].text, '*Nobody* new yet.');
    });

    test('messages from other bots are ignored', async () => {
        await dispatch(agent.slack, eventBody({
            type: 'message', channel_type: 'im', bot_id: 'BOTHER', user: 'UOTHER', text: 'beep', channel: 'DTEAM', ts: '8.000100'
        }));
        assert.equal(slack.callsTo('chat.postMessage').length, 0);
    });

    test('the bot joining a channel is not a lead', async () => {
        await dispatch(agent.slack, eventBody({ type: 'member_joined_channel', user: 'UBOT', channel: 'CGENERAL', channel_type: 'C' }));
        assert.deepEqual(slack.calls.filter(call => call.method !== 'auth.test'), []);
    });
});

describe('slack flows', { skip: !process.env.TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
    const analysisJson = JSON.stringify({
        fitScore: 84,
        confidence: 'medium',
        segment: 'Founder',
        summary: 'Founder of a small developer tools startup.',
        insights: ['Building developer tools'],
        recommendations: ['Invite her to the founders call'],
        welcomeMessage: 'Hi Jane, welcome aboard!'
    });
    const welcomeValues = text => ({ message: { text: { type: 'plain_text_input', value: text } } });

    let pool;
    let analysis;

    before(async () => {
        // a schema of our own, db.test.js runs at the same time against the same database
        pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: '-c search_path=slack_flows' });
        await pool.query('DROP SCHEMA IF EXISTS slack_flows CASCADE');
        await pool.query('CREATE SCHEMA slack_flows');
        await db.initDatabase(pool);
        await agent.worker.start();
    });

    after(async () => {
        await agent.worker.stop();
        await db.closeDatabase();
    });

    test('a new member is queued, analyzed and posted with review buttons', async () => {
        model.responses.push(new AIMessage(analysisJson));
        await dispatch(agent.slack, eventBody({ type: 'team_join', user: jane }));

        await waitFor(async () => (await db.getJobCounts()).done === 1);
        analysis = await db.getLatestAnalysis('UJANE');

        assert.equal(analysis.fitScore, 84);
        assert.equal(analysis.slackChannel, 'CLEADS');
        const post = slack.callsTo('chat.postMessage').find(message => message.channel === 'CLEADS');
        assert.match(post.text, /Jane \(84\/100\)/);
        assert.ok(post.attachments[0].blocks.some(block => block.type === 'actions'));
    });

    test('joining another channel does not analyze her again', async () => {
        await dispatch(agent.slack, eventBody({ type: 'member_joined_channel', user: 'UJANE', channel: 'CGENERAL', channel_type: 'C' }));
        assert.deepEqual(await db.getJobCounts(), { done: 1 });
    });

    test('marking a good fit updates the original post', async () => {
        await dispatch(agent.slack, actionBody('analysis_qualify', analysis.id));

        const [update] = slack.callsTo('chat.update');
        assert.equal(update.ts, analysis.slackTs);
        assert.match(JSON.stringify(update.attachments), /Marked as a good fit by <@UTEAM>/);
        assert.equal((await db.getAnalysis(analysis.id)).feedback, 'qualified');
    });

    test('the welcome button opens the drafted message', async () => {
        await dispatch(agent.slack, actionBody('analysis_welcome', analysis.id));

        const [open] = slack.callsTo('views.open');
        assert.equal(open.trigger_id, 'trigger-1');
        assert.equal(open.view.blocks[1].element.initial_value, 'Hi Jane, welcome aboard!');
    });

    test('an empty welcome message is refused inside the modal', async () => {
        const acks = await dispatch(agent.slack, viewBody('welcome_dm', { analysisId: analysis.id }, welcomeValues('   ')));

        assert.deepEqual(acks[0], { response_action: 'errors', errors: { message: 'The message is empty' } });
        assert.equal(slack.callsTo('conversations.open').length, 0);
    });

    test('sending the welcome DM records who sent it', async () => {
        await dispatch(agent.slack, viewBody('welcome_dm', { analysisId: analysis.id }, welcomeValues('Hey Jane, glad you are here!')));

        assert.equal(slack.callsTo('conversations.open')[0].users, 'UJANE');
        const dm = slack.callsTo('chat.postMessage').find(message => message.channel === 'DUJANE');
        assert.equal(dm.text, 'Hey Jane, glad you are here!');
        assert.equal((await db.getAnalysis(analysis.id)).welcomedBy, 'UTEAM');
        assert.match(JSON.stringify(slack.callsTo('chat.update')[0].attachments), /Welcome DM sent by <@UTEAM>/);
    });

    test('/agent leads and stats reflect the work so far', async () => {
        await dispatch(agent.slack, commandBody(slack, 'leads 7'));
        assert.match(JSON.stringify(lastResponse().blocks), /<@UJANE>/);

        await dispatch(agent.slack, commandBody(slack, 'stats'));
        assert.match(JSON.stringify(lastResponse().blocks), /1 good fit, 0 not a fit/);
    });

    test('members see the dashboard on the home tab', async () => {
        await dispatch(agent.slack, eventBody({ type: 'app_home_opened', user: 'UTEAM', tab: 'home', channel: 'DTEAM' }));

        const [publish] = slack.callsTo('views.publish');
        assert.match(JSON.stringify(publish.view), /Members analyzed\*\\n1/);
        assert.match(JSON.stringify(publish.view), /"value":"\d+","action_id":"analysis_view"|"action_id":"analysis_view","value":"\d+"/);
    });

    test('a question in the leads channel is answered from the database', async () => {
        model.responses.push(
            new AIMessage({ content: '', tool_calls: [{ id: 'call_1', name: 'get_top_leads', args: { days: 7 } }] }),
            new AIMessage('<@UJANE> (84, Founder) is the one to talk to.')
        );
        await dispatch(agent.slack, eventBody({
            type: 'app_mention', user: 'UTEAM', text: '<@UBOT> who should we talk to?', channel: 'CLEADS', ts: '9.000100'
        }));

        const toolResult = model.calls.at(-1).at(-1);
        assert.match(toolResult.content, /"slackUserId":"UJANE"/);
        assert.equal(slack.callsTo('chat.postMessage')[0].thread_ts, '9.000100');
        assert.equal(slack.callsTo('chat.update')[0].text, '<@UJANE> (84, Founder) is the one to talk to.');
    });

    test('/agent forget removes her data and post and stops new analyses', async () => {
        await dispatch(agent.slack, commandBody(slack, 'forget <@UJANE|jane>'));

        // bolt's listener client adds team_id to every call, only the target matters here
        const deleted = slack.callsTo('chat.delete').map(({ channel, ts }) => ({ channel, ts }));
        assert.deepEqual(deleted, [{ channel: 'CLEADS', ts: analysis.slackTs }]);
        assert.match(lastResponse().text, /Deleted 1 analysis record/);
        assert.equal(await db.getLatestAnalysis('UJANE'), null);

        await dispatch(agent.slack, eventBody({ type: 'team_join', user: jane }));
        assert.deepEqual(await db.getJobCounts(), {});
    });
});
