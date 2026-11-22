'use strict';

// Tiny in-process TTL cache with request coalescing: when many requests ask for the
// same key at once, only one loader runs and everyone shares its result. This is what
// keeps hot paths (session lookups, roles, settings) from hammering Supabase.

class TtlCache {
    constructor({ ttlMs, max } = {}) {
        this.ttlMs = ttlMs || 15000;
        this.max = max || 5000;
        this.map = new Map();
        this.inflight = new Map();
    }

    get(key) {
        const hit = this.map.get(key);
        if (!hit) return undefined;
        if (hit.expiresAt <= Date.now()) { this.map.delete(key); return undefined; }
        return hit.value;
    }

    set(key, value, ttlMs) {
        if (this.map.size >= this.max) {
            // Drop the oldest entry (Map keeps insertion order).
            const oldest = this.map.keys().next().value;
            if (oldest !== undefined) this.map.delete(oldest);
        }
        this.map.set(key, { value, expiresAt: Date.now() + (ttlMs || this.ttlMs) });
        return value;
    }

    delete(key) {
        this.map.delete(key);
        this.inflight.delete(key);
    }

    deleteWhere(predicate) {
        for (const [key, hit] of this.map) if (predicate(key, hit.value)) this.map.delete(key);
    }

    clear() {
        this.map.clear();
        this.inflight.clear();
    }

    // Returns the cached value or runs `loader` once (shared by concurrent callers).
    async wrap(key, loader, ttlMs) {
        const cached = this.get(key);
        if (cached !== undefined) return cached;
        if (this.inflight.has(key)) return this.inflight.get(key);
        const p = (async () => {
            try {
                const value = await loader();
                if (value !== undefined) this.set(key, value, ttlMs);
                return value;
            } finally {
                this.inflight.delete(key);
            }
        })();
        this.inflight.set(key, p);
        return p;
    }
}

module.exports = { TtlCache };
