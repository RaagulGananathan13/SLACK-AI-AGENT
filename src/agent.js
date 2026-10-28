import pkg from '@slack/bolt';
const { App } = pkg;
import express from 'express';

import config from './config.js';
import log from './logger.js';
import {
    initDatabase, saveMemberAnalysis, getAnalysis, markAsSentToSlack, checkDatabase, closeDatabase,
    wasRecentlyAnalyzed, getUnsentAnalysis, enqueueJob, claimJob, completeJob, failJob,
    requeueStaleJobs, getJobCounts
} from './db.js';
import { JobWorker } from './queue.js';
import { researchMember } from './research/index.js';
import { createChatModel } from './ai/llm.js';
import { analyzeMember } from './ai/analyzer.js';
import { analysisMessage, escape } from './slack/blocks.js';
import { ChannelAccess } from './slack/access.js';
import { registerActions } from './slack/actions.js';
import { registerHome } from './slack/home.js';

export class SlackAIAgent {
    constructor() {
        this.app = express()
        this.slack = new App({
            token: config.slack.botToken,
            signingSecret: config.slack.signingSecret,
            socketMode: true,
            appToken: config.slack.appToken
        });
        this.webClient = this.slack.client;
        this.model = createChatModel();
        this.access = new ChannelAccess(this.webClient, config.slack.channelId);

        const jobStore = { claimJob, completeJob, failJob, requeueStaleJobs };
        this.worker = new JobWorker(jobStore, job => this.processJob(job), {
            concurrency: config.analysis.concurrency,
            maxAttempts: config.analysis.maxAttempts,
            onFailure: (job, error) => this.reportFailure(job, error)
        });

        this.setupSlackEvents();
        registerActions(this.slack, this);
        registerHome(this.slack, this);
        this.setupExpress();
    }

    setupSlackEvents() {
        this.slack.event('team_join', async ({ event }) => {
            try {
                if (event.user.is_bot || event.user.deleted) return;
                log.info(`New member joined: ${event.user.real_name ||
                    event.user.name}`)
                await this.queueAnalysis(event.user.id, { reason: 'team_join' });
            } catch (error) {
                log.error('Error processing team_join:', error.message)
            }
        });

        this.slack.event('member_joined_channel', async ({ event, context }) => {
            try {
                if (event.channel === config.slack.channelId) this.access.reset();
                // bolt lets this event through even when the bot itself is the one joining
                if (event.user === context.botUserId) return;
                if (!this.isWatchedChannel(event)) return;

                log.info(`Member ${event.user} joined channel ${event.channel}`)
                await this.queueAnalysis(event.user, { reason: 'channel_join', channel: event.channel });
            } catch (error) {
                log.error('Error processing member_joined_channel:', error.message)
            }
        });

        // someone removed from the leads channel should lose access right away, not in 5 minutes
        this.slack.event('member_left_channel', async ({ event }) => {
            if (event.channel === config.slack.channelId) this.access.reset();
        });
        this.slack.error(async (error) => log.error('Slack error:', error.message))
    }

    setupExpress() {
        this.app.use(express.json());

        this.app.get('/health', async (req, res) => {
            const database = await checkDatabase();
            res.json({
                status: 'healthy',
                database: database ? 'up' : 'down',
                queue: database ? await getJobCounts() : null,
                timestamp: new Date().toISOString()
            });
        })

        if (config.isDev) {
            // runs the pipeline inline so prompt changes can be tried without slack events,
            // send "post": false to skip posting to the channel
            this.app.post('/test/analyze-member', async (req, res) => {
                try {
                    const { memberInfo, post = true } = req.body;
                    if (!memberInfo) return res.status(400).json({ error: 'memberInfo is required' })
                    const analysis = await this.analyzeAndPostMember(memberInfo, { post });
                    res.json({ success: true, analysis, timestamp: new Date().toISOString() });
                } catch (error) {
                    log.error('Test analysis error:', error.message)
                    res.status(500).json({ error: 'Analysis failed', message: error.message })
                }
            });
        }

        this.app.use((err, req, res, next) => {
            log.error('Express error', err.message)
            res.status(500).json({ error: 'Internal server error' })
        })
    }

    isWatchedChannel(event) {
        // teammates joining the leads channel are not leads
        if (event.channel === config.slack.channelId) return false;
        const watched = config.slack.watchChannels;
        return watched.length > 0 ? watched.includes(event.channel) : event.channel_type === 'C';
    }

    async queueAnalysis(memberId, { force = false, ...payload } = {}) {
        const days = config.analysis.reanalyzeAfterDays;
        if (!force && await wasRecentlyAnalyzed(memberId, days)) {
            log.info(`Skipping ${memberId}, already analyzed in the last ${days} days`);
            return { queued: false, reason: 'recent' };
        }

        const jobId = await enqueueJob(memberId, payload);
        if (!jobId) return { queued: false, reason: 'pending' };

        log.info(`Queued analysis job ${jobId} for ${memberId}`);
        this.worker.poll();
        return { queued: true, jobId };
    }

    async processJob(job) {
        const unsent = await getUnsentAnalysis(job.member_id, job.id);
        if (unsent) {
            log.info(`Resuming job ${job.id}, analysis ${unsent.id} was saved but never posted`);
            const message = await this.postAnalysisToChannel(unsent);
            await markAsSentToSlack(unsent.id, message);
            return;
        }

        const memberInfo = await this.getUserInfo(job.member_id);
        if (memberInfo.isBot || memberInfo.deleted) return;
        await this.analyzeAndPostMember(memberInfo);
    }

    async reportFailure(job, error) {
        await this.webClient.chat.postMessage({
            channel: config.slack.channelId,
            text: `⚠️ Couldn't analyze <@${job.member_id}> after ${job.attempts} attempts (${escape(error.message)}). Worth a manual look.`
        });
    }

    async getUserInfo(userId) {
        const result = await this.webClient.users.info({ user: userId });
        const user = result.user;

        return {
            id: user.id,
            isBot: user.is_bot || user.id === 'USLACKBOT',
            deleted: user.deleted,
            name: user.real_name || user.name,
            username: user.name,
            email: user.profile?.email,
            title: user.profile?.title,
            timezone: user.tz,
            profile: {
                firstName: user.profile?.first_name,
                lastName: user.profile?.last_name,
                statusText: user.profile?.status_text
            }
        };
    }

    async analyzeAndPostMember(memberInfo, { post = true } = {}) {
        log.info(`Processing member: ${memberInfo.name}`)
        const researchData = await researchMember(memberInfo);
        const analysis = await analyzeMember(this.model, memberInfo, researchData);

        const model = `${config.llm.model} (${config.llm.provider})`;
        const analysisId = await saveMemberAnalysis(memberInfo, { ...analysis, model }, researchData);
        const record = await getAnalysis(analysisId);

        if (post) {
            const message = await this.postAnalysisToChannel(record);
            await markAsSentToSlack(analysisId, message);
        }
        return record;
    }

    async postAnalysisToChannel(record) {
        const result = await this.webClient.chat.postMessage({
            channel: config.slack.channelId,
            ...analysisMessage(record)
        });

        log.info(`Analysis posted to channel for ${record.name}`)
        return { channel: result.channel, ts: result.ts };
    }

    async start() {
        try {
            log.info('🗄️ Initializing database...')
            await initDatabase()

            this.server = this.app.listen(config.port, () => {
                log.info(`🚀 Express server running on port ${config.port}`);
            })

            await this.slack.start();
            log.info('⚡️ Slack bot connected');
            log.info(`🧠 Using ${config.llm.provider} (${config.llm.model})`);

            await this.worker.start();
            log.info('🎉 Slack AI Agent is running!')

            if (config.isDev) {
                log.info(`Test endpoint: POST http://localhost:${config.port}/test/analyze-member`)
            }

        } catch (error) {
            log.error('Failed to start:', error.message)
            process.exit(1)
        }
    }

    async stop() {
        if (this.stopping) return;
        this.stopping = true;

        log.info('Shutting down...')
        try {
            await this.worker.stop();
            await this.slack.stop()
            if (this.server) {
                await new Promise(resolve => this.server.close(resolve));
            }
            await closeDatabase();
            log.info('Stopped successfully')
        } catch (error) {
            log.error('Shutdown error:', error.message)
        }
        process.exit(0)
    }
}
