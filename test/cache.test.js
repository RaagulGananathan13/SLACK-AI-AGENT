import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TtlCache } from '../src/cache.js';

test('entries expire after the ttl', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 0 });
    const cache = new TtlCache({ ttl: 1000 });

    cache.set('a', 1);
    t.mock.timers.tick(999);
    assert.equal(cache.get('a'), 1);
    t.mock.timers.tick(1);
    assert.equal(cache.get('a'), undefined);
});

test('evicts the oldest entry when full', () => {
    const cache = new TtlCache({ max: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 3);
    cache.set('c', 4);

    assert.equal(cache.get('b'), undefined);
    assert.equal(cache.get('a'), 3);
    assert.equal(cache.get('c'), 4);
});

test('wrap shares one call between concurrent callers', async () => {
    const cache = new TtlCache();
    let calls = 0;
    const slow = () => new Promise(resolve => setTimeout(() => resolve(++calls), 10));

    const [first, second] = await Promise.all([cache.wrap('k', slow), cache.wrap('k', slow)]);
    assert.equal(first, 1);
    assert.equal(second, 1);
    assert.equal(await cache.wrap('k', slow), 1);
    assert.equal(calls, 1);
});

test('wrap caches null but not failures', async () => {
    const cache = new TtlCache();
    let calls = 0;

    await assert.rejects(cache.wrap('k', async () => { calls++; throw new Error('timeout'); }));
    assert.equal(await cache.wrap('k', async () => { calls++; return null; }), null);
    assert.equal(await cache.wrap('k', async () => { calls++; return 'later'; }), null);
    assert.equal(calls, 2);
});
