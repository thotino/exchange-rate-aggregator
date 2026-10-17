import { TTLCache, type TTLCacheOptions } from "@isaacs/ttlcache";

type ExchangeRateCacheoptions = TTLCacheOptions<string, unknown> & {
    staleTtl?: number;
};
type Item = unknown;
export enum ItemState {
    FRESH = "fresh",
    STALE = "stale",
    MISS = "miss"
}
class ExchangeRateCache {
    #cache: TTLCache<string, Item>;
    ttl: number;
    staleTtl: number;
    constructor(options: ExchangeRateCacheoptions) {
        this.#cache = new TTLCache();
        this.ttl = options.ttl ?? 0;
        this.staleTtl = options.staleTtl ?? 0;
    }
    getState(key: string) {
        if (!this.#cache.has(key)) {
            return ItemState.MISS;
        }
        const remaining = this.#cache.getRemainingTTL(key);
        return remaining <= this.staleTtl ? ItemState.STALE : ItemState.FRESH;
    }
    has(key: string) {
        return this.#cache.has(key);
    }
    get(key: string) {
        return this.#cache.get(key);
    }
    set(key: string, value: Item) {
        return this.#cache.set(key, value, { ttl: this.ttl + this.staleTtl });
    }
}
export const exchangeRateCache = new ExchangeRateCache({
    ttl: 5 * 60 * 1000,
    staleTtl: 1 * 60 * 1000,
});
