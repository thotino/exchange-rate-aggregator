import { TTLCache } from "@isaacs/ttlcache";

class ExchangeRateCache extends TTLCache {}
export const exchangeRateCache = new ExchangeRateCache({ ttl: 5 * 60 * 1000 });
