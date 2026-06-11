import pkg from '@slack/bolt';
const { App } = pkg;
import { WebClient } from '@slack/web-api';
import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const log = {
    info: (msg, ...args) => console.log(`[INFO] ${msg}`, ...args),
    error: (msg, ...args) => console.log(`[ERROR] ${msg}`, ...args),
    debug: (msg, ...args) => process.env.NODE_ENV === "development" && console.log(`[DEBUG] ${msg}`, ...args)
}

class SlackAIAgent {
    constructor() {
        this.app = express()
        this.slack = new App({
            token: process.env.SLACK_BOT_TOKEN,
            signingSecret: process.env.SLACK_SIGNING_SECRET,
            socketMode: true,
            appToken: process.env.SLACK_APP_TOKEN
        });
        this.webClient = new WebClient(process.env.SLACK_BOT_TOKEN);
        this.openai = new ChatOpenAI({
            model: "gpt-4",
            temperature: 0.3,
            apiKey: process.env.OPENAI_API_KEY
        });

        this.setupSlackEvents();
        this.setupExpress();
    }

    setupSlackEvents() {
        this.slack.event('team_join', async ({ event }) => {
            try {
                log.info(`New member joined: ${event.user.real_name ||
                    event.user.name}`)
                const userInfo = await this.getUserInfo(event.user.id);
                await this.analyzeAndPostMember(userInfo);
            } catch (error) {
                log.error('Error processing team_join:', error.message)
            }
        });

        this.slack.event('member_joined_channel', async ({ event }) => {
            try {
                if (event.channel_type === 'C') {
                    log.info(`Member ${event.user} joined channel ${event.channel}`)
                    const userInfo = await this.getUserInfo(event.user);
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

        if (process.env.NODE_ENV === 'development') {
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

    

}

