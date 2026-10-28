import { tierFor } from '../tiers.js';

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
