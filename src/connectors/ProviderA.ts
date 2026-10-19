import { ProviderError } from "../errors/ProviderError";
import { ProviderTimeoutError } from "../errors/ProviderTimeoutError";
import { ProviderUnavailableError } from "../errors/ProviderUnavailableError";
import { Bulkhead } from "../infrastructure/resilience/Bulkhead";
import { CircuitBreaker } from "../infrastructure/resilience/CircuitBreaker";
import { JitterStatuses } from "../infrastructure/resilience/constants";
import { RequestCoalescer } from "../infrastructure/resilience/RequestCoalescer";
import { LogicalOperationResilientClient } from "../infrastructure/resilience/ResilientClient";
import { Retry } from "../infrastructure/resilience/Retry";
import { Providers, type Currencies } from "../interfaces/types";
import type {
    BaseConnectorInterface,
    GetRatesOptions,
} from "../types/connector";
import type { RateProvider } from "../types/provider";

export class ProviderA implements RateProvider {
    readonly baseUrl: string;
    // TODO: implement the inversion of dependencies here
    #client: LogicalOperationResilientClient;
    constructor(readonly url: string) {
        this.baseUrl = url;
        this.#client = new LogicalOperationResilientClient(
            // new CircuitBreaker(),
            // new Bulkhead(this.constructor.name),
            // new Retry({
            //     maxAttempts: 3,
            //     retryableErrors: new Set([
            //         "PROVIDER_TIMEOUT",
            //         "PROVIDER_UNAVAILABLE",
            //     ]),
            // }),
            // new RequestCoalescer(),
            {
                bulkheadOptions: {
                    name: "ProviderA",
                    maxConcurrent: 2,
                    maxWaiting: 5,
                    timeoutMS: 1000,
                },
                circuitBreakerOptions: {
                    failureThreshold: 3,
                    halfOpenRequests: 2,
                    resetTimeout: 1000,
                },
                retryOptions: {
                    maxAttempts: 3,
                    factor: 1,
                    initialDelay: 100,
                    maxDelay: 50,
                    timeout: 100,
                    jitter: JitterStatuses.FULL,
                    retryableErrors: [],
                    retryableStatusCodes: [],
                },
            },
        );
    }
    async connect() {
        await this.#client.connect();
    }
    async close() {
        await this.#client.close();
    }
    async getRates(
        sourceCurrency: Currencies,
        targetCurrency: Currencies,
        options: GetRatesOptions,
    ) {
        const fn = async ({ signal }: { signal: AbortSignal }) => {
            const response = await fetch(
                `${this.baseUrl}/rates/${sourceCurrency}/${targetCurrency}`,
                { signal: AbortSignal.any([signal, options.cancelSignal]) },
            );
            if (!response.ok) {
                // if (response.status === 500) {
                //     throw new ProviderUnavailableError(response);
                // }
                // if (response.status === 504) {
                //     throw new ProviderTimeoutError(response);
                // }
                const error = new ProviderError(response);
                throw error;
            }
            return response.json();
        };
        const fetchedAt = Date.now();
        const coalescerKey = `GetRates::${Providers.PROVIDER_A}-${sourceCurrency}-${targetCurrency}`;
        const rates = await this.#client.execute(coalescerKey, fn, {
            cancelSignal: options.cancelSignal,
        });
        const receivedAt = Date.now();
        const expiresAt = receivedAt + 5 * 60 * 1000;
        return {
            from: sourceCurrency,
            to: targetCurrency,
            rate: rates.rate,
            provider: Providers.PROVIDER_A,
            fetchedAt,
            receivedAt,
            expiresAt,
        };
    }
}
