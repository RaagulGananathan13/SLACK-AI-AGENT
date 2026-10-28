import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ChannelAccess } from '../src/slack/access.js';

function fakeClient(pages) {
    const client = {
        calls: 0,
        paginate(method, options) {
            client.calls++;
            assert.equal(method, 'conversations.members');
            assert.equal(options.channel, 'CLEADS');
            return (async function* () {
                for (const members of pages) yield { members };
            })();
        }
    };
    return client;
}

test('allows members of the leads channel across pages', async () => {
    const access = new ChannelAccess(fakeClient([['U1', 'U2'], ['U3']]), 'CLEADS');

    assert.equal(await access.isAllowed('U1'), true);
    assert.equal(await access.isAllowed('U3'), true);
    assert.equal(await access.isAllowed('U9'), false);
});

test('loads the member list once and reloads after reset', async () => {
    const client = fakeClient([['U1']]);
    const access = new ChannelAccess(client, 'CLEADS');

    await Promise.all([access.isAllowed('U1'), access.isAllowed('U2'), access.isAllowed('U1')]);
    assert.equal(client.calls, 1);

    access.reset();
    await access.isAllowed('U1');
    assert.equal(client.calls, 2);
});

test('denies everyone when slack cannot be reached', async () => {
    const client = {
        paginate() {
            return (async function* () {
                throw new Error('missing_scope');
            })();
        }
    };
    const access = new ChannelAccess(client, 'CLEADS');

    assert.equal(await access.isAllowed('U1'), false);
});
