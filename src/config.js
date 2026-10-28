import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const int = (value, fallback) => {
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
}

const list = value => (value || '').split(',').map(item => item.trim()).filter(Boolean);

// every provider here speaks the openai chat completions protocol
export const providers = {
    groq: {
        baseURL: 'https://api.groq.com/openai/v1',
        model: 'llama-3.3-70b-versatile',
        apiKeyEnv: 'GROQ_API_KEY'
    },
    gemini: {
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        model: 'gemini-3.8-flash',
        apiKeyEnv: 'GEMINI_API_KEY'
    },
    openrouter: {
        baseURL: 'https://openrouter.ai/api/v1',
        model: 'openrouter/free',
        apiKeyEnv: 'OPENROUTER_API_KEY'
    },
    ollama: {
        baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
        model: 'llama3.1'
    },
    openai: {
        model: 'gpt-6-luna',
        apiKeyEnv: 'OPENAI_API_KEY'
    }
};

function detectProvider() {
    const withKey = ['groq', 'gemini', 'openrouter', 'openai'].find(name => process.env[providers[name].apiKeyEnv]);
    return withKey || 'ollama';
}

const provider = (process.env.LLM_PROVIDER || detectProvider()).toLowerCase();
const preset = providers[provider] || {};

const config = {
    env: process.env.NODE_ENV || 'development',
    port: int(process.env.PORT, 3000),
    slack: {
        botToken: process.env.SLACK_BOT_TOKEN,
        appToken: process.env.SLACK_APP_TOKEN,
        signingSecret: process.env.SLACK_SIGNING_SECRET,
        channelId: process.env.SLACK_PRIVATE_CHANNEL_ID,
        // empty means every public channel, like before
        watchChannels: list(process.env.WATCH_CHANNEL_IDS),
        command: process.env.SLACK_COMMAND || '/agent'
    },
    llm: {
        provider,
        model: process.env.LLM_MODEL || preset.model,
        baseURL: process.env.LLM_BASE_URL || preset.baseURL,
        apiKey: process.env.LLM_API_KEY || process.env[preset.apiKeyEnv],
        temperature: Number(process.env.LLM_TEMPERATURE ?? 0.3)
    },
    company: {
        name: process.env.COMPANY_NAME || 'Your Company',
        product: process.env.COMPANY_PRODUCT || 'Your Product',
        idealCustomer: process.env.COMPANY_ICP || ''
    },
    github: {
        token: process.env.GITHUB_TOKEN
    },
    analysis: {
        reanalyzeAfterDays: int(process.env.REANALYZE_AFTER_DAYS, 30),
        concurrency: int(process.env.ANALYSIS_CONCURRENCY, 2),
        maxAttempts: int(process.env.ANALYSIS_MAX_ATTEMPTS, 3)
    },
    digest: {
        enabled: process.env.DIGEST_ENABLED !== 'false',
        day: (process.env.DIGEST_DAY || 'mon').slice(0, 3).toLowerCase(),
        hour: int(process.env.DIGEST_HOUR, 9),
        timezone: process.env.DIGEST_TIMEZONE || 'UTC'
    },
    // 0 keeps analyses forever
    retentionDays: int(process.env.DATA_RETENTION_DAYS, 0),
    database: {
        url: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_SSL !== 'false'
    }
};

config.isDev = config.env === 'development';

export function configErrors() {
    const errors = [];
    const required = {
        SLACK_BOT_TOKEN: config.slack.botToken,
        SLACK_APP_TOKEN: config.slack.appToken,
        SLACK_PRIVATE_CHANNEL_ID: config.slack.channelId,
        DATABASE_URL: config.database.url
    };
    const missing = Object.keys(required).filter(key => !required[key]);
    if (missing.length > 0) errors.push(`Missing ${missing.join(', ')}`);

    if (!providers[provider]) {
        errors.push(`Unknown LLM_PROVIDER "${provider}", expected one of: ${Object.keys(providers).join(', ')}`);
    } else if (provider !== 'ollama' && !config.llm.apiKey) {
        errors.push(`No API key for ${provider}, set ${preset.apiKeyEnv} or LLM_API_KEY`);
    }

    const { day, hour, timezone } = config.digest;
    if (!['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].includes(day)) {
        errors.push(`DIGEST_DAY should be a weekday like "mon", got "${process.env.DIGEST_DAY}"`);
    }
    if (hour < 0 || hour > 23) errors.push('DIGEST_HOUR should be between 0 and 23');
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    } catch {
        errors.push(`DIGEST_TIMEZONE "${timezone}" is not a valid IANA timezone, e.g. Asia/Colombo`);
    }
    return errors;
}

export default config;
