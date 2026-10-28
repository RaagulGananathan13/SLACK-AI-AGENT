import { SlackAIAgent } from './src/agent.js';
import { missingConfig } from './src/config.js';
import log from './src/logger.js';

const missing = missingConfig();
if (missing.length > 0) {
    log.error(`Missing required environment variables: ${missing.join(', ')} (see .env.sample)`);
    process.exit(1);
}

const agent = new SlackAIAgent()

process.on('SIGINT', () => agent.stop());
process.on('SIGTERM', () => agent.stop());

agent.start().catch(error => {
    log.error('Startup failed:', error.message);
    process.exit(1)
})

export default agent
