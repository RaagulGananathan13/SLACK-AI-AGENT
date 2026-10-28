import { test } from 'node:test';
import assert from 'node:assert/strict';

import { JobWorker, backoff } from '../src/queue.js';

// same contract as the postgres functions in db.js, but retries are due immediately
class MemoryStore {
    constructor(count) {
        this.jobs = Array.from({ length: count }, (_, i) => ({ id: i + 1, member_id: `U${i + 1}`, attempts: 0, status: 'queued' }));
        this.failures = [];
    }

    async requeueStaleJobs() {
        return 0;
    }

    async claimJob() {
        const job = this.jobs.find(item => item.status === 'queued');
        if (!job) return null;
        job.status = 'running';
        job.attempts++;
        return { ...job };
    }

    async completeJob(id) {
        this.byId(id).status = 'done';
    }

    async failJob(id, error, retryIn) {
        this.failures.push({ id, error, retryIn });
        this.byId(id).status = retryIn === null ? 'failed' : 'queued';
    }

    byId(id) {
        return this.jobs.find(job => job.id === id);
    }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(check, timeout = 2000) {
    const started = Date.now();
    while (!check()) {
        if (Date.now() - started > timeout) throw new Error('timed out');
        await sleep(5);
    }
}

test('runs every job without going over the concurrency limit', async () => {
    const store = new MemoryStore(6);
    let running = 0;
    let peak = 0;

    const worker = new JobWorker(store, async () => {
        running++;
        peak = Math.max(peak, running);
        await sleep(20);
        running--;
    }, { concurrency: 2, pollInterval: 10 });

    await worker.start();
    await waitFor(() => store.jobs.every(job => job.status === 'done'));
    await worker.stop();

    assert.equal(peak, 2);
});

test('retries with backoff, then reports the failure once', async () => {
    const store = new MemoryStore(1);
    const reported = [];

    const worker = new JobWorker(store, async () => {
        throw new Error('llm down');
    }, {
        maxAttempts: 3,
        pollInterval: 10,
        onFailure: (job, error) => reported.push([job.id, job.attempts, error.message])
    });

    await worker.start();
    await waitFor(() => store.jobs[0].status === 'failed');
    await worker.stop();

    assert.deepEqual(store.failures.map(failure => failure.retryIn), [30, 120, null]);
    assert.deepEqual(reported, [[1, 3, 'llm down']]);
});

test('stop waits for jobs that already started', async () => {
    const store = new MemoryStore(1);
    let finished = false;

    const worker = new JobWorker(store, async () => {
        await sleep(50);
        finished = true;
    }, { pollInterval: 10 });

    await worker.start();
    await waitFor(() => store.jobs[0].status === 'running');
    await worker.stop();

    assert.equal(finished, true);
    assert.equal(store.jobs[0].status, 'done');
});

test('a failing store is logged, not thrown', async () => {
    const store = {
        requeueStaleJobs: async () => 0,
        claimJob: async () => { throw new Error('db down'); }
    };
    const worker = new JobWorker(store, async () => {}, { pollInterval: 10 });

    await worker.start();
    await sleep(30);
    await worker.stop();
});

test('backoff grows 4x per attempt', () => {
    assert.deepEqual([1, 2, 3].map(attempt => backoff(attempt)), [30, 120, 480]);
});
