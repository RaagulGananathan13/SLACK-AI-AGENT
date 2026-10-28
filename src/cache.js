export class TtlCache {
    constructor({ ttl = 60 * 60 * 1000, max = 500 } = {}) {
        this.ttl = ttl;
        this.max = max;
        this.items = new Map();
        this.pending = new Map();
    }

    get(key) {
        const item = this.items.get(key);
        if (!item) return undefined;
        if (item.expires <= Date.now()) {
            this.items.delete(key);
            return undefined;
        }
        return item.value;
    }

    set(key, value) {
        // re-inserting keeps the Map in least-recently-set order for eviction
        this.items.delete(key);
        this.items.set(key, { value, expires: Date.now() + this.ttl });
        if (this.items.size > this.max) {
            this.items.delete(this.items.keys().next().value);
        }
    }

    delete(key) {
        this.items.delete(key);
    }

    // Concurrent callers for the same key share one in-flight call. Rejections are not
    // cached so a timeout doesn't stick around for the whole ttl.
    wrap(key, fn) {
        const hit = this.get(key);
        if (hit !== undefined) return Promise.resolve(hit);
        if (this.pending.has(key)) return this.pending.get(key);

        const promise = Promise.resolve()
            .then(fn)
            .then(value => {
                this.set(key, value);
                return value;
            })
            .finally(() => this.pending.delete(key));

        this.pending.set(key, promise);
        return promise;
    }
}
