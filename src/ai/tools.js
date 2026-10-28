import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import { getTopLeads, getStats, searchMembers, getAnalysis, getLatestAnalysis } from '../db.js';
import { classifyEmail } from '../research/email.js';
import { tierFor } from '../tiers.js';

const clamp = (value, min, max, fallback) => Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;

// what the model gets to see about a member: no email address, no raw research blobs
export function summarize(record) {
    return {
        analysisId: record.id,
        slackUserId: record.memberId,
        name: record.name,
        title: record.title,
        emailDomain: classifyEmail(record.email).domain,
        fitScore: record.fitScore,
        tier: tierFor(record.fitScore).name,
        segment: record.segment,
        summary: record.summary,
        teamFeedback: record.feedback,
        welcomed: Boolean(record.welcomedAt),
        analyzedAt: record.analyzedAt instanceof Date ? record.analyzedAt.toISOString() : record.analyzedAt
    };
}

async function findMember(store, value) {
    const text = value.trim();
    if (/^[UW][A-Z0-9]{5,}$/.test(text)) return store.getLatestAnalysis(text);
    if (/^\d+$/.test(text)) return store.getAnalysis(Number(text));
    return (await store.searchMembers(text, { limit: 1 }))[0];
}

// everything here is read-only on purpose: tool results contain text members wrote
// themselves, and the worst a prompt injection can do is make the assistant read data
export function createLeadTools(store = { getTopLeads, getStats, searchMembers, getAnalysis, getLatestAnalysis }) {
    return [
        tool(async ({ days, limit, minScore }) => {
            const leads = await store.getTopLeads({
                days: clamp(days, 1, 365, 30),
                limit: clamp(limit, 1, 20, 10),
                minScore: clamp(minScore, 0, 100, 0)
            });
            return JSON.stringify(leads.map(summarize));
        }, {
            name: 'get_top_leads',
            description: 'Highest scoring members analyzed in the last N days, best first.',
            schema: z.object({
                days: z.coerce.number().optional().describe('How many days back to look, default 30'),
                limit: z.coerce.number().optional().describe('Max results, default 10, at most 20'),
                minScore: z.coerce.number().optional().describe('Only include members with at least this fit score (0-100)')
            })
        }),

        tool(async ({ query }) => {
            const members = await store.searchMembers(query);
            return JSON.stringify(members.map(summarize));
        }, {
            name: 'search_members',
            description: 'Find analyzed members by name, job title, company domain, segment or words in their summary.',
            schema: z.object({
                query: z.string().min(2).describe('Text to look for, e.g. "fintech", "CTO" or "acme.com"')
            })
        }),

        tool(async ({ member }) => {
            const record = await findMember(store, member);
            if (!record) return 'No analysis found for that member.';

            return JSON.stringify({
                ...summarize(record),
                confidence: record.confidence,
                insights: record.insights,
                recommendations: record.recommendations,
                sources: record.research.map(item => ({ type: item.type, title: item.title, url: item.url }))
            });
        }, {
            name: 'get_member',
            description: 'Full analysis of one member: insights, recommendations and research sources.',
            schema: z.object({
                member: z.string().describe('A Slack user id like U0123ABC, an analysis id, or a name')
            })
        }),

        tool(async ({ days }) => JSON.stringify(await store.getStats(clamp(days, 1, 365, 30))), {
            name: 'get_stats',
            description: 'Totals for the last N days: members analyzed, average score, members per tier, team feedback and top segments.',
            schema: z.object({
                days: z.coerce.number().optional().describe('How many days back to look, default 30')
            })
        })
    ];
}

// gemini's openai endpoint has rejected these json-schema keys, nobody needs them
export function toFunctionSpec(item) {
    const { $schema, additionalProperties, ...parameters } = z.toJSONSchema(item.schema);
    return {
        type: 'function',
        function: { name: item.name, description: item.description, parameters }
    };
}
