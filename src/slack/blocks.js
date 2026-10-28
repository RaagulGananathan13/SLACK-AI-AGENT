export function scoreColor(score) {
    return score >= 80 ? '#36a64f'
        : score >= 60 ? '#ffb84d'
            : score >= 40 ? '#ff9500' : '#ff4444';
}

export function analysisMessage(member, analysis) {
    const blocks = [
        {
            type: 'header',
            text: { type: 'plain_text', text: `🔍 New Member: ${member.name}` }
        },
        {
            type: 'section',
            fields: [
                { type: 'mrkdwn', text: `*Fit Score:* ${analysis.fitScore}/100` },
                { type: 'mrkdwn', text: `*Email:* ${member.email || 'Not provided'}` },
                { type: 'mrkdwn', text: `*Title:* ${member.title || 'Not provided'}` },
            ]
        }
    ];

    if (analysis.insights.length > 0) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*Insights:*\n${analysis.insights.map(i =>
                    `• ${i}`).join('\n')}`
            }
        })
    }

    if (analysis.recommendations.length > 0) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*Recommendations:*\n${analysis.recommendations.map(i =>
                    `• ${i}`).join('\n')}`
            }
        });
    }

    blocks.push({
        type: 'context',
        elements: [
            {
                type: 'mrkdwn',
                text: `📊 Analyzed: ${new Date().toISOString()}`
            }
        ]
    });

    return {
        text: `New Member Analysis: ${member.name} (${analysis.fitScore}/100)`,
        attachments: [
            {
                color: scoreColor(analysis.fitScore),
                blocks: blocks
            }
        ]
    };
}
