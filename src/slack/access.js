import log from '../logger.js';
import { TtlCache } from '../cache.js';

// Lead data (emails, scores, notes) is meant for people who can already see the private
// leads channel, so membership of that channel is the permission check everywhere.
export class ChannelAccess {
    constructor(client, channelId, { ttl = 5 * 60 * 1000 } = {}) {
        this.client = client;
        this.channelId = channelId;
        this.cache = new TtlCache({ ttl, max: 1 });
    }

    members() {
        return this.cache.wrap('members', async () => {
            const members = new Set();
            const pages = this.client.paginate('conversations.members', { channel: this.channelId, limit: 200 });
            for await (const page of pages) {
                page.members.forEach(id => members.add(id));
            }
            return members;
        });
    }

    async isAllowed(userId) {
        try {
            return (await this.members()).has(userId);
        } catch (error) {
            log.error('Could not load leads channel members:', error.message);
            return false;
        }
    }

    reset() {
        this.cache.delete('members');
    }
}
