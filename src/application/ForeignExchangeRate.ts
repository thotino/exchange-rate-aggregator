import { exchangeRateCache } from "../infrastructure/cache/ExchangeRateCache";
import type { Currencies, Providers } from "../interfaces/types";

type Rate = {
    from: Currencies;
    to: Currencies;
    rate: number;
    provider: Providers;
};
interface RateProvider {
    baseUrl: string;
    getRates: (
        sourceCurrency: Currencies,
        targetCurrency: Currencies,
    ) => Promise<Rate>;
}
function withCache(
    originalMethod: Function,
    _context: ClassMethodDecoratorContext,
) {
    return async function (this: any, ...args: unknown[]) {
        const key = args.join("-");
        if (!exchangeRateCache.has(key)) {
            const result = originalMethod.call(this, ...args);
            await exchangeRateCache.set(key, result);
        }
        return exchangeRateCache.get(key);
    };
}
export class ForeignExchangeRate {
    constructor(
        readonly providerA: RateProvider,
        readonly providerB: RateProvider,
    ) {}
    async get(sourceCurrency: Currencies, targetCurrency: Currencies) {
        const cacheKey = `FXRate::${sourceCurrency}::${targetCurrency}`;
        if (exchangeRateCache.has(cacheKey))
            return exchangeRateCache.get(cacheKey);
        try {
            const ratesA = await this.providerA.getRates(
                sourceCurrency,
                targetCurrency,
            );
            exchangeRateCache.set(cacheKey, ratesA);
            return ratesA;
        } catch (error) {
            console.error({ error });
            try {
                const ratesB = await this.providerB.getRates(
                    sourceCurrency,
                    targetCurrency,
                );
                exchangeRateCache.set(cacheKey, ratesB);
                return ratesB;
            } catch (error) {
                console.error({ error });
                throw error
            }
        }
    }
}
