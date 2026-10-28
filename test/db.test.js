import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

import * as db from '../src/db.js';

// needs a real postgres, CI starts one. Locally:
// TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test
const url = process.env.TEST_DATABASE_URL;

const member = (id, extra = {}) => ({ id, name: `Member ${id}`, email: `${id.toLowerCase()}@acme.com`, title: 'CTO', ...extra });

const analysis = (fitScore, extra = {}) => ({
    fitScore,
    insights: ['Runs the platform team'],
    recommendations: ['Offer a demo'],
    confidence: 'high',
    segment: 'Engineering leader',
    summary: 'Platform lead at Acme',
    welcomeMessage: 'Welcome!',
    model: 'test-model (test)',
    ...extra
});

describe('database', { skip: !url && 'TEST_DATABASE_URL not set' }, () => {
    let pool;

    before(async () => {
        pool = new pg.Pool({ connectionString: url });
        await pool.query('DROP TABLE IF EXISTS member_analyses, analysis_jobs, app_state CASCADE');
        await db.initDatabase(pool);
        // the schema runs on every boot, so a second pass has to be harmless
        await db.initDatabase(pool);
    });

    after(() => db.closeDatabase());

    beforeEach(() => pool.query('TRUNCATE member_analyses, analysis_jobs RESTART IDENTITY'));

    test('saves an analysis and reads it back', async () => {
        const id = await db.saveMemberAnalysis(member('U1'), analysis(88), [{ type: 'github', url: 'https://github.com/x', title: 'GitHub: x' }]);
        const record = await db.getAnalysis(id);

        assert.equal(record.fitScore, 88);
        assert.equal(record.memberId, 'U1');
        assert.equal(record.segment, 'Engineering leader');
        assert.deepEqual(record.insights, ['Runs the platform team']);
        assert.equal(record.research[0].type, 'github');
        assert.ok(Math.abs(record.analyzedAt - Date.now()) < 60_000, 'timestamps come back as utc');
    });

    test('remembers where the slack message went', async () => {
        const id = await db.saveMemberAnalysis(member('U1'), analysis(50), []);
        await db.markAsSentToSlack(id, { channel: 'C1', ts: '1730000000.000100' });

        const record = await db.getAnalysis(id);
        assert.equal(record.slackChannel, 'C1');
        assert.equal(record.slackTs, '1730000000.000100');
    });

    test('records feedback and welcome DMs', async () => {
        const id = await db.saveMemberAnalysis(member('U1'), analysis(90), []);
        await db.recordFeedback(id, 'qualified', 'U9');
        await db.markWelcomed(id, 'U8');

        const record = await db.getAnalysis(id);
        assert.equal(record.feedback, 'qualified');
        assert.equal(record.feedbackBy, 'U9');
        assert.equal(record.welcomedBy, 'U8');
        assert.ok(record.welcomedAt instanceof Date);
    });

    test('knows who was analyzed recently', async () => {
        await db.saveMemberAnalysis(member('U1'), analysis(50), []);

        assert.equal(await db.wasRecentlyAnalyzed('U1', 30), true);
        assert.equal(await db.wasRecentlyAnalyzed('U2', 30), false);

        await pool.query(`UPDATE member_analyses SET analyzed_at = NOW() - INTERVAL '40 days'`);
        assert.equal(await db.wasRecentlyAnalyzed('U1', 30), false);
    });

    describe('reporting', () => {
        beforeEach(async () => {
            await db.saveMemberAnalysis(member('U1'), analysis(40, { segment: 'Student' }), []);
            // re-analysis of U1, only this one should count
            const latest = await db.saveMemberAnalysis(member('U1'), analysis(92, { segment: 'Founder' }), []);
            await db.recordFeedback(latest, 'qualified', 'U9');

            await db.saveMemberAnalysis(member('U2'), analysis(65, { segment: 'Founder' }), []);
            const cold = await db.saveMemberAnalysis(member('U3'), analysis(15, { segment: 'Student' }), []);
            await db.recordFeedback(cold, 'disqualified', 'U9');

            await db.saveMemberAnalysis(member('U4'), analysis(99), []);
            await pool.query(`UPDATE member_analyses SET analyzed_at = NOW() - INTERVAL '60 days' WHERE member_id = 'U4'`);
        });

        test('top leads use the latest analysis per member', async () => {
            const leads = await db.getTopLeads({ days: 30 });
            assert.deepEqual(leads.map(lead => [lead.memberId, lead.fitScore]), [['U1', 92], ['U2', 65], ['U3', 15]]);

            const strong = await db.getTopLeads({ days: 30, minScore: 60, limit: 1 });
            assert.deepEqual(strong.map(lead => lead.memberId), ['U1']);
        });

        test('stats count tiers, feedback and segments', async () => {
            const stats = await db.getStats(30);

            assert.equal(stats.total, 3);
            assert.equal(stats.average, 57);
            assert.deepEqual(stats.tiers, { hot: 1, warm: 1, cool: 0, cold: 1 });
            assert.equal(stats.qualified, 1);
            assert.equal(stats.disqualified, 1);
            assert.equal(stats.hotReviewed, 1);
            assert.equal(stats.hotQualified, 1);
            assert.deepEqual(stats.segments, [{ segment: 'Founder', count: 2 }, { segment: 'Student', count: 1 }]);
        });

        test('stats for an empty window are zeros, not nulls', async () => {
            await pool.query('TRUNCATE member_analyses');
            const stats = await db.getStats(7);

            assert.equal(stats.total, 0);
            assert.equal(stats.average, 0);
            assert.deepEqual(stats.segments, []);
        });
    });

    describe('jobs', () => {
        test('only one live job per member', async () => {
            assert.ok(await db.enqueueJob('U1', { reason: 'team_join' }));
            assert.equal(await db.enqueueJob('U1', { reason: 'channel_join' }), null);
            assert.ok(await db.enqueueJob('U2'));
        });

        test('a claimed job is not handed out again', async () => {
            await db.enqueueJob('U1', { reason: 'team_join' });

            const job = await db.claimJob();
            assert.equal(job.member_id, 'U1');
            assert.equal(job.attempts, 1);
            assert.deepEqual(job.payload, { reason: 'team_join' });
            assert.equal(await db.claimJob(), null);

            await db.completeJob(job.id);
            assert.ok(await db.enqueueJob('U1'), 'a finished job frees the member up');
        });

        test('failed jobs wait for their retry delay', async () => {
            await db.enqueueJob('U1');
            const job = await db.claimJob();

            await db.failJob(job.id, 'llm down', 3600);
            assert.equal(await db.claimJob(), null);

            await pool.query(`UPDATE analysis_jobs SET run_after = NOW() - INTERVAL '1 second'`);
            const retry = await db.claimJob();
            assert.equal(retry.attempts, 2);

            await db.failJob(retry.id, 'still down');
            assert.deepEqual(await db.getJobCounts(), { failed: 1 });
        });

        test('parallel claims never get the same job', async () => {
            for (const id of ['U1', 'U2', 'U3']) await db.enqueueJob(id);

            const claimed = await Promise.all([1, 2, 3, 4, 5].map(() => db.claimJob()));
            const ids = claimed.filter(Boolean).map(job => job.id);

            assert.equal(ids.length, 3);
            assert.equal(new Set(ids).size, 3);
        });

        test('requeues jobs a crashed worker left running', async () => {
            await db.enqueueJob('U1');
            await db.claimJob();
            assert.equal(await db.requeueStaleJobs(10), 0);

            await pool.query(`UPDATE analysis_jobs SET updated_at = NOW() - INTERVAL '11 minutes'`);
            assert.equal(await db.requeueStaleJobs(10), 1);
            assert.ok(await db.claimJob());
        });

        test('finds an analysis that was saved but never posted', async () => {
            const jobId = await db.enqueueJob('U1');
            const id = await db.saveMemberAnalysis(member('U1'), analysis(70), []);

            assert.equal((await db.getUnsentAnalysis('U1', jobId)).id, id);

            await db.markAsSentToSlack(id, { channel: 'C1', ts: '1' });
            assert.equal(await db.getUnsentAnalysis('U1', jobId), null);
        });
    });
});
