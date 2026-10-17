import type { GetRatesOptions } from "../connectors/connector";
import { exchangeRateCache } from "../infrastructure/cache/ExchangeRateCache";
import { GlobalTimeoutError } from "../infrastructure/resilience/errors/GlobalTimeoutError";
import type { Currencies, Providers } from "../interfaces/types";

type Rate = {
    from: Currencies;
    to: Currencies;
    rate: number;
    provider: Providers;
    fetchedAt: Date;
};
interface RateProvider {
    baseUrl: string;
    getRates: (
        sourceCurrency: Currencies,
        targetCurrency: Currencies,
        options: GetRatesOptions,
    ) => Promise<Rate>;
}

export class ForeignExchangeRate {
    static getRateOperationTimeout: number = 20_000;
    constructor(
        readonly providerA: RateProvider,
        readonly providerB: RateProvider,
    ) {}
    async get(sourceCurrency: Currencies, targetCurrency: Currencies) {
        const cacheKey = `FXRate::${sourceCurrency}::${targetCurrency}`;
        if (exchangeRateCache.has(cacheKey)) {
            return exchangeRateCache.get(cacheKey);
        }
        const globalController = new AbortController();
        const globalTimer = setTimeout(() => {
            globalController.abort(new GlobalTimeoutError());
        }, ForeignExchangeRate.getRateOperationTimeout);
        try {
            const ratesA = await this.providerA.getRates(
                sourceCurrency,
                targetCurrency,
                { cancelSignal: globalController.signal },
            );
            exchangeRateCache.set(cacheKey, ratesA);
            return ratesA;
        } catch (error) {
            console.error({ error });
            if (globalController.signal.aborted) {
                throw globalController.signal.reason ?? error
            }
            try {
                const ratesB = await this.providerB.getRates(
                    sourceCurrency,
                    targetCurrency,
                    { cancelSignal: globalController.signal },
                );
                exchangeRateCache.set(cacheKey, ratesB);
                return ratesB;
            } catch (error) {
                console.error({ error });
                throw error;
            }
        } finally {
            if (globalTimer != null) {
                clearTimeout(globalTimer);
            }
        }
    }
}
