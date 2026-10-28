import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const int = (value, fallback) => {
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
}

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
        channelId: process.env.SLACK_PRIVATE_CHANNEL_ID
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
        product: process.env.COMPANY_PRODUCT || 'Your Product'
    },
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
    return errors;
}

export default config;
