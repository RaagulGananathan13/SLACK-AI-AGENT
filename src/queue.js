import log from './logger.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms).unref());

// 30s, 2m, 8m, ...
export const backoff = (attempt, base = 30) => base * 4 ** (attempt - 1);

// Pulls jobs from the store (postgres in production) and runs them with a concurrency
// limit, so a burst of joins doesn't fire twenty LLM calls at once.
export class JobWorker {
    constructor(store, handler, { concurrency = 2, pollInterval = 5000, maxAttempts = 3, onFailure } = {}) {
        this.store = store;
        this.handler = handler;
        this.concurrency = concurrency;
        this.pollInterval = pollInterval;
        this.maxAttempts = maxAttempts;
        this.onFailure = onFailure;
        this.active = new Set();
        this.running = false;
        this.polling = false;
    }

    async start() {
        this.running = true;
        const recovered = await this.store.requeueStaleJobs();
        if (recovered > 0) log.warn(`Requeued ${recovered} job(s) left running by a previous process`);

        this.timer = setInterval(() => this.poll(), this.pollInterval);
        this.poll();
    }

    async poll() {
        if (!this.running || this.polling) return;
        this.polling = true;
        try {
            while (this.running && this.active.size < this.concurrency) {
                const job = await this.store.claimJob();
                if (!job) break;

                const task = this.run(job).finally(() => {
                    this.active.delete(task);
                    this.poll();
                });
                this.active.add(task);
            }
        } catch (error) {
            log.error('Failed to poll for jobs:', error.message);
        } finally {
            this.polling = false;
        }
    }

    async run(job) {
        try {
            await this.handler(job);
            await this.store.completeJob(job.id);
        } catch (error) {
            const final = job.attempts >= this.maxAttempts;
            log.error(`Job ${job.id} failed (attempt ${job.attempts}/${this.maxAttempts}):`, error.message);
            try {
                await this.store.failJob(job.id, error.message, final ? null : backoff(job.attempts));
                if (final && this.onFailure) await this.onFailure(job, error);
            } catch (inner) {
                log.error(`Could not record failure of job ${job.id}:`, inner.message);
            }
        }
    }

    async stop(timeout = 15000) {
        this.running = false;
        clearInterval(this.timer);
        if (this.active.size === 0) return;

        log.info(`Waiting for ${this.active.size} running job(s) to finish...`);
        await Promise.race([Promise.allSettled([...this.active]), sleep(timeout)]);
    }
}
