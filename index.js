import { SlackAIAgent } from './src/agent.js';
import { configErrors } from './src/config.js';
import log from './src/logger.js';

const errors = configErrors();
if (errors.length > 0) {
    errors.forEach(error => log.error(error));
    log.error('Fix the config above and restart (see .env.sample)');
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
