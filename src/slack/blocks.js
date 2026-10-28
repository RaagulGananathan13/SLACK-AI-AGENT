import { tiers, tierFor } from '../tiers.js';

// Anything that came from a member profile or the model goes through this. Without it a
// title like "<!channel>" would ping the whole leads channel.
export const escape = text => String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

export const truncate = (text, max) => text.length > max ? `${text.slice(0, max - 1)}…` : text;
export const plain = text => ({ type: 'plain_text', text: truncate(String(text), 150), emoji: true });
export const mrkdwn = text => ({ type: 'mrkdwn', text: truncate(text, 3000) });

export function slackDate(date) {
    const time = new Date(date ?? Date.now());
    return `<!date^${Math.floor(time.getTime() / 1000)}^{date_short_pretty} at {time}|${time.toISOString()}>`;
}

function bullets(label, items) {
    return {
        type: 'section',
        text: mrkdwn(`*${label}:*\n${items.map(item => `• ${escape(item)}`).join('\n')}`)
    };
}

function sourceLinks(research = []) {
    return research
        .filter(item => /^https?:\/\/[^\s<>|]+$/.test(item.url ?? ''))
        .map(item => `<${item.url}|${escape(item.title).replace(/\|/g, '')}>`)
        .join(' · ');
}

export const button = (text, actionId, value, style) => ({
    type: 'button',
    text: plain(text),
    action_id: actionId,
    value: String(value),
    ...(style && { style })
});

// what the team already did with this lead, plus buttons for whatever is left
function reviewBlocks(record) {
    const blocks = [];
    const notes = [];

    if (record.feedback) {
        const verdict = record.feedback === 'qualified' ? '✅ Marked as a good fit' : '👎 Marked as not a fit';
        notes.push(`${verdict} by <@${record.feedbackBy}>`);
    }
    if (record.welcomedAt) notes.push(`👋 Welcome DM sent by <@${record.welcomedBy}>`);
    if (notes.length > 0) blocks.push({ type: 'context', elements: [mrkdwn(notes.join('  ·  '))] });

    const buttons = [];
    if (!record.feedback) {
        buttons.push(button('✅ Good fit', 'analysis_qualify', record.id, 'primary'));
        buttons.push(button('👎 Not a fit', 'analysis_disqualify', record.id));
    }
    if (record.memberId && !record.welcomedAt) buttons.push(button('👋 Send welcome DM', 'analysis_welcome', record.id));
    if (record.memberId) buttons.push(button('🔄 Re-analyze', 'analysis_reanalyze', record.id));

    if (buttons.length > 0) blocks.push({ type: 'actions', block_id: `analysis_${record.id}`, elements: buttons });
    return blocks;
}

export function analysisMessage(record) {
    const tier = tierFor(record.fitScore);
    const member = record.memberId ? `<@${record.memberId}>` : escape(record.name);

    const blocks = [
        { type: 'header', text: plain(`🔍 New Member: ${record.name}`) },
        {
            type: 'section',
            fields: [
                mrkdwn(`*Fit Score:* ${record.fitScore}/100 ${tier.emoji} ${tier.label}`),
                mrkdwn(`*Member:* ${member}`),
                mrkdwn(`*Email:* ${escape(record.email || 'Not provided')}`),
                mrkdwn(`*Title:* ${escape(record.title || 'Not provided')}`),
                mrkdwn(`*Segment:* ${escape(record.segment || 'Unknown')}`),
                mrkdwn(`*Confidence:* ${escape(record.confidence || 'n/a')}`)
            ]
        }
    ];

    if (record.summary) blocks.push({ type: 'section', text: mrkdwn(escape(record.summary)) });
    if (record.insights?.length) blocks.push(bullets('Insights', record.insights));
    if (record.recommendations?.length) blocks.push(bullets('Recommendations', record.recommendations));
    if (record.id) blocks.push(...reviewBlocks(record));

    const context = [`📊 Analyzed ${slackDate(record.analyzedAt)}`];
    if (record.model) context.push(`🧠 ${escape(record.model)}`);
    const sources = sourceLinks(record.research);
    if (sources) context.push(`Sources: ${sources}`);
    blocks.push({ type: 'context', elements: [mrkdwn(context.join('  ·  '))] });

    return {
        text: `New Member Analysis: ${escape(record.name)} (${record.fitScore}/100)`,
        attachments: [{ color: tier.color, blocks }]
    };
}

export function analysisModal(record) {
    // the buttons need a channel message to act on, so the modal is read-only
    const blocks = analysisMessage(record).attachments[0].blocks
        .filter(block => block.type !== 'header' && block.type !== 'actions');

    return {
        type: 'modal',
        title: plain(truncate(record.name || 'Member', 24)),
        close: plain('Close'),
        blocks
    };
}

export function leadList(records) {
    if (records.length === 0) {
        return [{ type: 'context', elements: [mrkdwn('No members analyzed in this period yet.')] }];
    }

    return records.map(record => {
        const tier = tierFor(record.fitScore);
        const who = record.memberId ? `<@${record.memberId}>` : `*${escape(record.name)}*`;
        const details = [record.title, record.segment].filter(Boolean).map(escape).join(' · ');

        return {
            type: 'section',
            text: mrkdwn(`${tier.emoji} *${record.fitScore}*  ${who}${details ? `\n${details}` : ''}`),
            accessory: button('View', 'analysis_view', record.id)
        };
    });
}

// monospace bars render the same on desktop and mobile, unlike images
export function tierChart(counts) {
    const max = Math.max(1, ...tiers.map(tier => counts[tier.name]));
    const lines = tiers.map(tier => {
        const count = counts[tier.name];
        const width = count > 0 ? Math.max(1, Math.round((count / max) * 20)) : 0;
        return `${tier.label.padEnd(5)} ${'█'.repeat(width) || '·'} ${count}`;
    });
    return `\`\`\`\n${lines.join('\n')}\n\`\`\``;
}

export function statsBlocks(stats) {
    const blocks = [
        {
            type: 'section',
            fields: [
                mrkdwn(`*Members analyzed*\n${stats.total}`),
                mrkdwn(`*Average fit score*\n${stats.average}`),
                mrkdwn(`*🔥 Hot leads*\n${stats.tiers.hot}`),
                mrkdwn(`*👋 Welcomed*\n${stats.welcomed}`)
            ]
        },
        { type: 'section', text: mrkdwn(tierChart(stats.tiers)) }
    ];

    if (stats.segments?.length) {
        const segments = stats.segments.map(({ segment, count }) => `${escape(segment)} (${count})`).join(', ');
        blocks.push({ type: 'context', elements: [mrkdwn(`Top segments: ${segments}`)] });
    }

    if (stats.qualified + stats.disqualified > 0) {
        const accuracy = stats.hotReviewed > 0
            ? ` · ${stats.hotQualified} of ${stats.hotReviewed} reviewed hot leads confirmed`
            : '';
        blocks.push({
            type: 'context',
            elements: [mrkdwn(`Team feedback: ${stats.qualified} good fit, ${stats.disqualified} not a fit${accuracy}`)]
        });
    }
    return blocks;
}

export function homeView({ stats, leads, queue = {}, model }) {
    const pending = (queue.queued || 0) + (queue.running || 0);
    const queueText = `${pending} in queue${queue.failed ? `, ${queue.failed} failed` : ''}`;

    return {
        type: 'home',
        blocks: [
            { type: 'header', text: plain('📊 Member intelligence') },
            { type: 'context', elements: [mrkdwn(`Last ${stats.days} days · updated ${slackDate(new Date())}`)] },
            ...statsBlocks(stats),
            { type: 'divider' },
            { type: 'header', text: plain('🔥 Top leads this week') },
            ...leadList(leads),
            { type: 'divider' },
            { type: 'context', elements: [mrkdwn(`🧠 ${escape(model)} · ${queueText}`)] },
            { type: 'actions', elements: [button('🔄 Refresh', 'home_refresh', 'refresh')] }
        ]
    };
}

export function digestMessage({ stats, leads, summary }) {
    const blocks = [{ type: 'header', text: plain('📬 Weekly member digest') }];

    // summary is model output, so it gets escaped like everything else
    if (summary) blocks.push({ type: 'section', text: mrkdwn(escape(summary)) });
    blocks.push(...statsBlocks(stats));
    blocks.push({ type: 'divider' });
    blocks.push({ type: 'section', text: mrkdwn('*Top leads this week*') });
    blocks.push(...leadList(leads));

    return {
        text: `Weekly digest: ${stats.total} new members, ${stats.tiers.hot} hot leads`,
        blocks
    };
}

export function lockedHomeView() {
    return {
        type: 'home',
        blocks: [
            { type: 'header', text: plain('📊 Member intelligence') },
            { type: 'section', text: mrkdwn('This dashboard is only for members of the private leads channel. Ask an admin to add you.') }
        ]
    };
}

export function welcomeModal(record) {
    const firstName = record.name?.split(' ')[0] || 'there';
    const draft = record.welcomeMessage
        || `Hi ${firstName}, welcome to the community! Let us know if there's anything we can help with.`;

    return {
        type: 'modal',
        callback_id: 'welcome_dm',
        private_metadata: JSON.stringify({ analysisId: record.id }),
        title: plain('Welcome message'),
        submit: plain('Send'),
        close: plain('Cancel'),
        blocks: [
            {
                type: 'section',
                text: mrkdwn(`The bot will send this to <@${record.memberId}> as a DM. Edit it as much as you like.`)
            },
            {
                type: 'input',
                block_id: 'message',
                label: plain('Message'),
                element: {
                    type: 'plain_text_input',
                    action_id: 'text',
                    multiline: true,
                    max_length: 3000,
                    initial_value: truncate(draft, 3000)
                }
            }
        ]
    };
}
