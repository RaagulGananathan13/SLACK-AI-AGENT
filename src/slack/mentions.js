import { AIMessage, HumanMessage } from '@langchain/core/messages';

import config from '../config.js';
import log from '../logger.js';
import { escape } from './blocks.js';
import { toSlackMarkdown } from './format.js';

export function stripBotMention(text, botUserId) {
    return String(text || '').replaceAll(`<@${botUserId}>`, '').trim();
}

const isDirect = event => event.channel_type === 'im' || String(event.channel).startsWith('D');

function toMessage(message, botUserId) {
    return message.bot_id || message.user === botUserId
        ? new AIMessage(message.text)
        : new HumanMessage(stripBotMention(message.text, botUserId));
}

// earlier turns of the conversation: the thread if there is one, otherwise the last
// half hour of the DM. A top level mention in a channel starts fresh.
export async function conversationHistory(client, event, botUserId, limit = 8) {
    let messages = [];

    if (event.thread_ts) {
        const result = await client.conversations.replies({ channel: event.channel, ts: event.thread_ts, limit: 50 });
        messages = result.messages || [];
    } else if (isDirect(event)) {
        const oldest = String(Math.floor(Date.now() / 1000) - 30 * 60);
        const result = await client.conversations.history({ channel: event.channel, oldest, limit: limit + 1 });
        // history is newest first
        messages = (result.messages || []).reverse();
    }

    return messages
        .filter(message => message.ts !== event.ts && message.text)
        .slice(-limit)
        .map(message => toMessage(message, botUserId));
}

async function answer({ event, client, context, agent }) {
    const direct = isDirect(event);
    // threads keep channels tidy, in a DM only stay in a thread if the user started one
    const threadTs = direct ? event.thread_ts : (event.thread_ts || event.ts);
    const reply = text => client.chat.postMessage({ channel: event.channel, thread_ts: threadTs, text });

    if (!(await agent.access.isAllowed(event.user))) {
        await reply('🔒 Sorry, I only answer questions from members of the leads channel.');
        return;
    }
    // lead data stays out of public channels, even when someone with access asks there
    if (!direct && event.channel !== config.slack.channelId) {
        await reply(`I only talk about leads in <#${config.slack.channelId}> or in a DM, ask me there.`);
        return;
    }

    const question = stripBotMention(event.text, context.botUserId);
    if (!question) {
        await reply('Ask me about new members, e.g. _who are the best leads this week?_');
        return;
    }

    const history = await conversationHistory(client, event, context.botUserId).catch(error => {
        log.warn('Could not load conversation history:', error.message);
        return [];
    });
    const placeholder = await reply('_Looking that up…_');

    let text;
    try {
        text = toSlackMarkdown(await agent.assistant.ask(question, history));
    } catch (error) {
        log.error('Assistant failed:', error.message);
        text = `Sorry, something went wrong (${escape(error.message)}).`;
    }
    await client.chat.update({ channel: event.channel, ts: placeholder.ts, text });
}

export function registerMentions(app, agent) {
    app.event('app_mention', async ({ event, client, context }) => {
        // a mention inside a DM also arrives as message.im, answer that one only
        if (isDirect(event)) return;
        await answer({ event, client, context, agent });
    });

    app.message(async ({ message, client, context }) => {
        // only plain messages people send us directly: no edits, joins or bot posts
        if (message.channel_type !== 'im' || message.subtype || message.bot_id) return;
        await answer({ event: message, client, context, agent });
    });
}
