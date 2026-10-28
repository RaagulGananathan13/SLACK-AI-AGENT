import pkg from '@slack/bolt';
const { App } = pkg;
import express from 'express';

import config from './config.js';
import log from './logger.js';
import { initDatabase, saveMemberAnalysis, markAsSentToSlack, closeDatabase } from './db.js';
import { researchMember } from './research/index.js';
import { createChatModel } from './ai/llm.js';
import { analyzeMember } from './ai/analyzer.js';
import { analysisMessage } from './slack/blocks.js';

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

        this.setupSlackEvents();
        this.setupExpress();
    }

    setupSlackEvents() {
        this.slack.event('team_join', async ({ event }) => {
            try {
                if (event.user.is_bot) return;
                log.info(`New member joined: ${event.user.real_name ||
                    event.user.name}`)
                const userInfo = await this.getUserInfo(event.user.id);
                await this.analyzeAndPostMember(userInfo);
            } catch (error) {
                log.error('Error processing team_join:', error.message)
            }
        });

        this.slack.event('member_joined_channel', async ({ event, context }) => {
            try {
                // bolt lets this event through even when the bot itself is the one joining
                if (event.user === context.botUserId) return;
                if (event.channel_type === 'C') {
                    log.info(`Member ${event.user} joined channel ${event.channel}`)
                    const userInfo = await this.getUserInfo(event.user);
                    if (userInfo.isBot) return;
                    await this.analyzeAndPostMember(userInfo)
                }
            } catch (error) {
                log.error('Error processing member_joined_channel:', error.message)
            }
        });
        this.slack.error(async (error) => log.error('Slack error:', error.message))
    }

    setupExpress() {
        this.app.use(express.json());

        this.app.get('/health', (req, res) => {
            res.json({ status: 'healthy', timestamp: new Date().toISOString() });
        })

        if (config.isDev) {
            this.app.post('/test/analyze-member', async (req, res) => {
                try {
                    const { memberInfo } = req.body;
                    if (!memberInfo) return res.status(400).json({ error: 'memberInfo is required' })
                    const analysis = await this.analyzeAndPostMember(memberInfo);
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

    async getUserInfo(userId) {
        const result = await this.webClient.users.info({ user: userId });
        const user = result.user;

        return {
            id: user.id,
            isBot: user.is_bot || user.id === 'USLACKBOT',
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

    async analyzeAndPostMember(memberInfo) {
        let analysisId = null;
        try {
            log.info(`Processing member: ${memberInfo.name}`)
            const researchData = await researchMember(memberInfo);
            const analysis = await analyzeMember(this.model, memberInfo, researchData).catch(error => {
                log.error('AI analysis error:', error.message);
                return {
                    fitScore: 50,
                    insights: ['Unable to complete full analysis'],
                    recommendations: ['Manual review recommended']
                }
            });
            log.info(`Saving analysis to database for ${memberInfo.name}`);
            analysisId = await saveMemberAnalysis(memberInfo, analysis, researchData);
            await this.postAnalysisToChannel(memberInfo, analysis);

            if (analysisId) {
                await markAsSentToSlack(analysisId);
            }
            return { id: analysisId, ...analysis, research: researchData };
        } catch (error) {
            log.error(`Error processing ${memberInfo.name}:`, error.message);
            if (analysisId) {
                log.info(`Analysis ${analysisId} saved to database but not sent to Slack due to error`);
            }
            throw error;
        }
    }

    async postAnalysisToChannel(member, analysis) {
        await this.webClient.chat.postMessage({
            channel: config.slack.channelId,
            ...analysisMessage(member, analysis)
        });

        log.info(`Analysis posted to channel for ${member.name}`)
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
        log.info('Shutting down...')
        try {
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
