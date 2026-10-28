// imported first by tests that load the slack modules, before config.js reads the env
process.env.SLACK_PRIVATE_CHANNEL_ID = 'CLEADS';
process.env.SLACK_COMMAND = '/agent';
process.env.LOG_LEVEL ??= 'silent';
