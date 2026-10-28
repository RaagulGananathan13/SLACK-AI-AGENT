import { test } from 'node:test';
import assert from 'node:assert/strict';

import { conversationHistory, stripBotMention } from '../src/slack/mentions.js';
import { toSlackMarkdown } from '../src/slack/format.js';

const turns = messages => messages.map(message => [message.type, message.text]);

test('stripBotMention only removes the bot', () => {
    assert.equal(stripBotMention('<@UBOT> what about <@U123>?', 'UBOT'), 'what about <@U123>?');
    assert.equal(stripBotMention(undefined, 'UBOT'), '');
});

test('thread history becomes alternating turns without the current message', async () => {
    const client = {
        conversations: {
            replies: async () => ({
                messages: [
                    { ts: '1', user: 'U1', text: '<@UBOT> who joined today?' },
                    { ts: '2', bot_id: 'B1', text: 'Jane Doe (91).' },
                    { ts: '3', user: 'U1', text: '<@UBOT> tell me more' }
                ]
            })
        }
    };

    const history = await conversationHistory(client, { channel: 'C1', ts: '3', thread_ts: '1' }, 'UBOT');
    assert.deepEqual(turns(history), [['human', 'who joined today?'], ['ai', 'Jane Doe (91).']]);
});

test('a direct message uses the last half hour, oldest first', async () => {
    let params;
    const client = {
        conversations: {
            history: async options => {
                params = options;
                return {
                    messages: [
                        { ts: '9', user: 'U1', text: 'and this week?' },
                        { ts: '8', bot_id: 'B1', text: '12 members.' },
                        { ts: '7', user: 'U1', text: 'how many joined?' }
                    ]
                };
            }
        }
    };

    const history = await conversationHistory(client, { channel: 'D1', ts: '9', channel_type: 'im' }, 'UBOT');

    assert.deepEqual(turns(history), [['human', 'how many joined?'], ['ai', '12 members.']]);
    assert.ok(Number(params.oldest) >= Math.floor(Date.now() / 1000) - 30 * 60 - 1);
});

test('a top level mention in a channel starts fresh', async () => {
    assert.deepEqual(await conversationHistory({}, { channel: 'C1', ts: '1' }, 'UBOT'), []);
});

test('markdown from the model is turned into slack mrkdwn', () => {
    const input = '### Top leads\n- **Jane** at [Acme](https://acme.com)\n* Bob, __maybe__';
    assert.equal(toSlackMarkdown(input), '*Top leads*\n• *Jane* at <https://acme.com|Acme>\n• Bob, *maybe*');
});

test('member mentions survive but broadcasts are defused', () => {
    assert.equal(
        toSlackMarkdown('<@U0123ABC> (92) <!channel> a & b'),
        '<@U0123ABC> (92) &lt;!channel&gt; a &amp; b'
    );
});
