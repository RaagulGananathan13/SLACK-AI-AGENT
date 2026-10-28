import http from 'node:http';
import pkg from '@slack/bolt';
const { App } = pkg;

// Stands in for slack.com/api. Records every call and answers roughly like Slack would,
// so the real Bolt middleware and our listeners can run without a workspace.
export async function startFakeSlack({ members = ['UTEAM'], users = {} } = {}) {
    const calls = [];
    const responses = [];
    let ts = 1000;

    const reply = (method, args) => {
        switch (method) {
            case 'auth.test':
                return { ok: true, user_id: 'UBOT', bot_id: 'BBOT', team_id: 'T1' };
            case 'conversations.members':
                return { ok: true, members, response_metadata: { next_cursor: '' } };
            case 'chat.postMessage':
                return { ok: true, channel: args.channel, ts: `${++ts}.000100` };
            case 'conversations.open':
                return { ok: true, channel: { id: `D${args.users}` } };
            case 'conversations.replies':
            case 'conversations.history':
                return { ok: true, messages: [] };
            case 'users.info':
                return users[args.user]
                    ? { ok: true, user: users[args.user] }
                    : { ok: false, error: 'user_not_found' };
            default:
                return { ok: true };
        }
    };

    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
            const body = parseBody(req.headers['content-type'], raw);
            res.setHeader('Content-Type', 'application/json');

            if (req.url === '/respond') {
                responses.push(body);
                return res.end(JSON.stringify({ ok: true }));
            }
            const method = req.url.replace(/^\/api\//, '').split('?')[0];
            calls.push({ method, args: body });
            res.end(JSON.stringify(reply(method, body)));
        });
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    return {
        baseUrl,
        apiUrl: `${baseUrl}/api/`,
        calls,
        responses,
        callsTo: method => calls.filter(call => call.method === method).map(call => call.args),
        reset() {
            calls.length = 0;
            responses.length = 0;
        },
        close: () => new Promise(resolve => server.close(resolve))
    };
}

function parseBody(type = '', raw) {
    if (type.includes('application/json')) return JSON.parse(raw || '{}');

    // the web client form-encodes arguments and JSON-encodes nested ones (blocks, views)
    const args = Object.fromEntries(new URLSearchParams(raw));
    for (const [key, value] of Object.entries(args)) {
        if (/^[[{]/.test(value)) {
            try {
                args[key] = JSON.parse(value);
            } catch {
                // plain text that happens to start with a bracket
            }
        }
    }
    return args;
}

export function createTestApp(slack) {
    return new App({
        token: 'xoxb-test',
        signingSecret: 'test-secret',
        tokenVerificationEnabled: false,
        clientOptions: { slackApiUrl: slack.apiUrl, retryConfig: { retries: 0 } },
        receiver: { init() {}, start: async () => {}, stop: async () => {} },
        logLevel: 'error'
    });
}

// runs a payload through bolt the same way the socket mode receiver would
export async function dispatch(app, body) {
    const acks = [];
    await app.processEvent({ body, ack: async response => { acks.push(response ?? null); } });
    return acks;
}

export const eventBody = event => ({
    type: 'event_callback',
    team_id: 'T1',
    api_app_id: 'A1',
    event_id: `Ev${Math.random().toString(36).slice(2)}`,
    event_time: Math.floor(Date.now() / 1000),
    event
});

export const actionBody = (actionId, value, extra = {}) => ({
    type: 'block_actions',
    team: { id: 'T1' },
    user: { id: 'UTEAM' },
    api_app_id: 'A1',
    trigger_id: 'trigger-1',
    channel: { id: 'CLEADS' },
    message: { ts: '1.000100' },
    actions: [{ type: 'button', action_id: actionId, block_id: 'b1', value: String(value), action_ts: '1' }],
    ...extra
});

export const commandBody = (slack, text, extra = {}) => ({
    command: '/agent',
    text,
    user_id: 'UTEAM',
    channel_id: 'CLEADS',
    team_id: 'T1',
    trigger_id: 'trigger-1',
    response_url: `${slack.baseUrl}/respond`,
    ...extra
});

export const viewBody = (callbackId, privateMetadata, values) => ({
    type: 'view_submission',
    team: { id: 'T1' },
    user: { id: 'UTEAM' },
    api_app_id: 'A1',
    view: {
        id: 'V1',
        type: 'modal',
        callback_id: callbackId,
        private_metadata: JSON.stringify(privateMetadata),
        state: { values }
    }
});

export async function waitFor(check, timeout = 5000) {
    const started = Date.now();
    while (!(await check())) {
        if (Date.now() - started > timeout) throw new Error('timed out waiting');
        await new Promise(resolve => setTimeout(resolve, 20));
    }
}

export class ScriptedModel {
    constructor(responses = []) {
        this.responses = responses;
        this.calls = [];
    }

    bindTools() {
        return this;
    }

    async invoke(messages) {
        this.calls.push([...messages]);
        if (this.responses.length === 0) throw new Error('ScriptedModel ran out of responses');
        return this.responses.shift();
    }
}
