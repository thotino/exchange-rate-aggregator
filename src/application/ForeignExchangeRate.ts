import {
    exchangeRateCache,
    ItemState,
} from "../infrastructure/cache/ExchangeRateCache";
import { GlobalTimeoutError } from "../infrastructure/resilience/errors/GlobalTimeoutError";
import { InvalidBulkheadOptionError } from "../infrastructure/resilience/errors/InvalidBulkheadOptionError";
import { InvalidCircuitBreakerOptionError } from "../infrastructure/resilience/errors/InvalidCircuitBreakerOptionError";
import { InvalidRetryOptionError } from "../infrastructure/resilience/errors/InvalidRetryOptionError";
import { ResilienceError } from "../infrastructure/resilience/errors/ResilienceError";
import type { Currencies } from "../interfaces/types";
import type { RateProvider } from "../types/provider";

export class ForeignExchangeRate {
    static getRateOperationTimeout: number = 20_000;
    constructor(
        readonly providerA: RateProvider,
        readonly providerB: RateProvider,
    ) {}

    async connect() {
        await Promise.all([this.providerA.connect(), this.providerB.connect()]);
    }
    async close() {
        await Promise.all([this.providerA.close(), this.providerB.close()]);
    }

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
            if (
                error instanceof InvalidBulkheadOptionError ||
                error instanceof InvalidCircuitBreakerOptionError ||
                error instanceof InvalidRetryOptionError
            ) {
                throw error;
            }
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
                const freshRates = exchangeRateCache.get(cacheKey);
                return { ...freshRates, source: "FRESH_CACHE" };
            case ItemState.STALE:
                const staleRates = exchangeRateCache.get(cacheKey);
                this.#refreshCacheWithFreshRates(
                    cacheKey,
                    sourceCurrency,
                    targetCurrency,
                ).catch(err => {
                    console.error(err);
                });
                return { ...staleRates, source: "STALE_CACHE" };
        }
    }
}
