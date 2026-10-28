import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Scheduler, isDigestDue, localTime } from '../src/scheduler.js';

// 03:30 UTC is 09:00 on Monday in Colombo (+05:30) and still Sunday evening in Los Angeles
const mondayNineInColombo = new Date('2026-10-26T03:30:00Z');
const digest = { enabled: true, day: 'mon', hour: 9, timezone: 'Asia/Colombo' };

class FakeStore {
    constructor() {
        this.claimed = new Set();
        this.released = [];
        this.purged = [];
    }

    async claimSchedule(name) {
        if (this.claimed.has(name)) return false;
        this.claimed.add(name);
        return true;
    }

    async releaseSchedule(name) {
        this.claimed.delete(name);
        this.released.push(name);
    }

    async purgeOldData(days) {
        this.purged.push(days);
        return { analyses: 0, jobs: 0 };
    }
}

test('localTime follows the timezone, half hour offsets included', () => {
    assert.deepEqual(localTime(mondayNineInColombo, 'Asia/Colombo'), { weekday: 'mon', hour: 9 });
    assert.deepEqual(localTime(mondayNineInColombo, 'America/Los_Angeles'), { weekday: 'sun', hour: 20 });
});

test('the digest is only due during its hour', () => {
    assert.equal(isDigestDue(mondayNineInColombo, digest), true);
    assert.equal(isDigestDue(new Date('2026-10-26T02:59:00Z'), digest), false);
    assert.equal(isDigestDue(mondayNineInColombo, { ...digest, timezone: 'UTC' }), false);
});

test('posts the digest once per period and runs cleanup', async () => {
    const store = new FakeStore();
    let posted = 0;
    const scheduler = new Scheduler({ store, postDigest: async () => posted++, digest, retentionDays: 90 });

    await scheduler.tick(mondayNineInColombo);
    await scheduler.tick(mondayNineInColombo);

    assert.equal(posted, 1);
    assert.deepEqual(store.purged, [90]);
});

test('no digest outside its hour or when turned off', async () => {
    let posted = 0;
    const postDigest = async () => posted++;

    await new Scheduler({ store: new FakeStore(), postDigest, digest }).tick(new Date('2026-10-26T05:00:00Z'));
    await new Scheduler({ store: new FakeStore(), postDigest, digest: { ...digest, enabled: false } }).tick(mondayNineInColombo);

    assert.equal(posted, 0);
});

test('a failed digest gives its claim back so the next tick retries', async () => {
    const store = new FakeStore();
    let attempts = 0;
    const scheduler = new Scheduler({
        store,
        digest,
        postDigest: async () => {
            if (++attempts === 1) throw new Error('slack is down');
        }
    });

    await scheduler.tick(mondayNineInColombo);
    await scheduler.tick(mondayNineInColombo);

    assert.equal(attempts, 2);
    assert.deepEqual(store.released, ['weekly_digest']);
});
