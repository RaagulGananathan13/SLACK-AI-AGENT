import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const int = (value, fallback) => {
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
}

const config = {
    env: process.env.NODE_ENV || 'development',
    port: int(process.env.PORT, 3000),
    slack: {
        botToken: process.env.SLACK_BOT_TOKEN,
        appToken: process.env.SLACK_APP_TOKEN,
        signingSecret: process.env.SLACK_SIGNING_SECRET,
        channelId: process.env.SLACK_PRIVATE_CHANNEL_ID
    },
    openai: {
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL || 'gpt-6-luna'
    },
    company: {
        name: process.env.COMPANY_NAME || 'Your Company',
        product: process.env.COMPANY_PRODUCT || 'Your Product'
    },
    database: {
        url: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_SSL !== 'false'
    }
};

config.isDev = config.env === 'development';

export function missingConfig() {
    const required = {
        SLACK_BOT_TOKEN: config.slack.botToken,
        SLACK_APP_TOKEN: config.slack.appToken,
        SLACK_PRIVATE_CHANNEL_ID: config.slack.channelId,
        DATABASE_URL: config.database.url
    };
    return Object.keys(required).filter(key => !required[key]);
}

export default config;
