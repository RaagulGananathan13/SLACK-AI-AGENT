import log from './logger.js';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

export function localTime(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        weekday: 'short',
        hour: 'numeric',
        hourCycle: 'h23'
    }).formatToParts(date);

    const part = type => parts.find(item => item.type === type).value;
    return { weekday: part('weekday').toLowerCase(), hour: Number(part('hour')) };
}

export function isDigestDue(date, { day, hour, timezone }) {
    const now = localTime(date, timezone);
    return now.weekday === day && now.hour === hour;
}

// Checks once a minute. Every task is claimed in the database first, so restarts and
// extra instances don't send the digest twice.
export class Scheduler {
    constructor({ store, postDigest, digest, retentionDays = 0, interval = 60 * 1000 }) {
        this.store = store;
        this.postDigest = postDigest;
        this.digest = digest;
        this.retentionDays = retentionDays;
        this.interval = interval;
    }

    start() {
        this.timer = setInterval(() => this.tick(), this.interval);
        this.tick();
    }

    stop() {
        clearInterval(this.timer);
    }

    async tick(now = new Date()) {
        try {
            if (this.digest.enabled && isDigestDue(now, this.digest)) {
                await this.runOnce('weekly_digest', 6 * DAY, this.postDigest);
            }
            await this.runOnce('daily_cleanup', DAY - HOUR, () => this.cleanup());
        } catch (error) {
            log.error('Scheduler tick failed:', error.message);
        }
    }

    async runOnce(name, everySeconds, task) {
        if (!(await this.store.claimSchedule(name, everySeconds))) return false;

        try {
            await task();
            return true;
        } catch (error) {
            // give the claim back so the next tick retries instead of skipping a whole week
            await this.store.releaseSchedule(name);
            log.error(`Scheduled task ${name} failed:`, error.message);
            return false;
        }
    }

    async cleanup() {
        const removed = await this.store.purgeOldData(this.retentionDays);
        if (removed.analyses || removed.jobs) {
            log.info(`Cleanup removed ${removed.analyses} old analyses and ${removed.jobs} finished jobs`);
        }
    }
}
