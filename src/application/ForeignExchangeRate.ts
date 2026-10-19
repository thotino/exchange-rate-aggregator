import {
    exchangeRateCache,
    ItemState,
} from "../infrastructure/cache/ExchangeRateCache";
import { GlobalTimeoutError } from "../infrastructure/resilience/errors/GlobalTimeoutError";
import type { Currencies } from "../interfaces/types";
import type { RateProvider } from "../types/provider";

export class ForeignExchangeRate {
    static getRateOperationTimeout: number = 20_000;
    constructor(
        readonly providerA: RateProvider,
        readonly providerB: RateProvider,
    ) {}

    async #processWithProviders(
        sourceCurrency: Currencies,
        targetCurrency: Currencies,
    ) {
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
            return ratesA;
        } catch (error) {
            console.error({ error });
            if (globalController.signal.aborted) {
                throw globalController.signal.reason ?? error;
            }
            try {
                const ratesB = await this.providerB.getRates(
                    sourceCurrency,
                    targetCurrency,
                    { cancelSignal: globalController.signal },
                );
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
    async #refreshCacheWithFreshRates(
        cacheKey: string,
        sourceCurrency: Currencies,
        targetCurrency: Currencies,
    ) {
        const rates = await this.#processWithProviders(
            sourceCurrency,
            targetCurrency,
        );
        exchangeRateCache.set(cacheKey, rates);
    }

    async get(sourceCurrency: Currencies, targetCurrency: Currencies) {
        const cacheKey = `FXRate::${sourceCurrency}::${targetCurrency}`;
        const state = exchangeRateCache.getState(cacheKey);
        switch (state) {
            case ItemState.MISS:
                const rates = await this.#processWithProviders(
                    sourceCurrency,
                    targetCurrency,
                );
                exchangeRateCache.set(cacheKey, rates);
                return rates;
            case ItemState.FRESH:
                return exchangeRateCache.get(cacheKey);
            case ItemState.STALE:
                const staleRates = exchangeRateCache.get(cacheKey);
                this.#refreshCacheWithFreshRates(
                    cacheKey,
                    sourceCurrency,
                    targetCurrency,
                ).catch(err => {
                    console.error(err);
                });
                return staleRates;
        }
    }
}
