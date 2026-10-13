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
function withCache(originalMethod: Function, _context: ClassMethodDecoratorContext) {
    return async function (this: any, ...args: unknown[]) {
        const key = args.join("-");
        if (!exchangeRateCache.has(key)) {
            const result = originalMethod.call(this, ...args);
            await exchangeRateCache.set(key, result)
        }
        return exchangeRateCache.get(key);
    };
}
export class ForeignExchangeRate {
    constructor(
        readonly providerA: RateProvider,
        readonly providerB: RateProvider,
    ) {}
    @withCache
    async get(sourceCurrency: Currencies, targetCurrency: Currencies) {
        try {
            const ratesA = await this.providerA.getRates(
                sourceCurrency,
                targetCurrency,
            );
            exchangeRateCache.set(
                `${sourceCurrency}/${targetCurrency}`,
                ratesA,
            );
            return ratesA;
        } catch (error) {
            console.error({ error });
            const ratesB = await this.providerB.getRates(
                sourceCurrency,
                targetCurrency,
            );
            return ratesB;
        }
    }
}
