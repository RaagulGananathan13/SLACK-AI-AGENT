import config from '../config.js';
import log from '../logger.js';
import { getStats, getTopLeads, forgetMember } from '../db.js';
import { leadList, statsBlocks, mrkdwn } from './blocks.js';

// slack sends mentions as <@U123|name> when the command has escaping turned on
export function parseMention(text) {
    return String(text).match(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/)?.[1] ?? null;
}

export function parseDays(value, fallback) {
    const days = parseInt(value, 10);
    return days > 0 ? Math.min(days, 365) : fallback;
}

export function helpText(command) {
    return [
        `*${command} analyze @someone* - research and score a member right now`,
        `*${command} leads [days]* - highest scoring members, last 7 days by default`,
        `*${command} stats [days]* - numbers for the last 30 days by default`,
        `*${command} forget @someone* - delete everything stored about a member and stop analyzing them`
    ].join('\n');
}

const replies = {
    queued: id => `🔍 Analyzing <@${id}>, the result will be posted in <#${config.slack.channelId}>.`,
    pending: id => `<@${id}> is already in the queue.`,
    opted_out: id => `<@${id}> asked to be forgotten, so they won't be analyzed.`
};

const subcommands = {
    async analyze({ text, command, respond, agent }) {
        const memberId = parseMention(text);
        if (!memberId) return respond(`Usage: \`${command.command} analyze @someone\``);

        const result = await agent.queueAnalysis(memberId, {
            force: true,
            reason: 'command',
            requestedBy: command.user_id
        });
        await respond(replies[result.queued ? 'queued' : result.reason](memberId));
    },

    async leads({ args, respond }) {
        const days = parseDays(args[0], 7);
        const leads = await getTopLeads({ days, limit: 10 });

        await respond({
            text: `Top leads from the last ${days} days`,
            blocks: [{ type: 'section', text: mrkdwn(`*Top leads from the last ${days} days*`) }, ...leadList(leads)]
        });
    },

    async stats({ args, respond }) {
        const days = parseDays(args[0], 30);
        const stats = await getStats(days);

        await respond({
            text: `Stats for the last ${days} days`,
            blocks: [{ type: 'section', text: mrkdwn(`*Last ${days} days*`) }, ...statsBlocks(stats)]
        });
    },

    async forget({ text, command, respond, client }) {
        const memberId = parseMention(text);
        if (!memberId) return respond(`Usage: \`${command.command} forget @someone\``);

        const { deleted, messages } = await forgetMember(memberId, command.user_id);
        for (const message of messages) {
            await client.chat.delete(message).catch(error => {
                log.warn(`Could not delete message ${message.ts}:`, error.message);
            });
        }

        log.info(`Forgot ${memberId} (${deleted} analyses) at the request of ${command.user_id}`);
        await respond(`🗑️ Deleted ${deleted} analysis record(s) and ${messages.length} message(s) about <@${memberId}>. They won't be analyzed again.`);
    }
};

export function registerCommands(app, agent) {
    app.command(config.slack.command, async ({ command, ack, respond, client }) => {
        await ack();

        if (!(await agent.access.isAllowed(command.user_id))) {
            return respond(`🔒 Only members of <#${config.slack.channelId}> can use ${command.command}.`);
        }

        const [name = '', ...args] = command.text.trim().split(/\s+/);
        const key = name.toLowerCase();
        if (!Object.hasOwn(subcommands, key)) return respond(helpText(command.command));

        try {
            await subcommands[key]({ args, text: args.join(' '), command, respond, client, agent });
        } catch (error) {
            log.error(`${command.command} ${key} failed:`, error.message);
            await respond(`Something went wrong: ${error.message}`);
        }
    });
}
