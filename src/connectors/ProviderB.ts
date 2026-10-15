import { ProviderError } from "../errors/ProviderError";
import { ProviderTimeoutError } from "../errors/ProviderTimeoutError";
import { ProviderUnavailableError } from "../errors/ProviderUnavailableError";
import { Bulkhead } from "../infrastructure/resilience/Bulkhead";
import { CircuitBreaker } from "../infrastructure/resilience/CircuitBreaker";
import { RequestCoalescer } from "../infrastructure/resilience/RequestCoalescer";
import { LogicalOperationResilientClient } from "../infrastructure/resilience/ResilientClient";
import { Retry } from "../infrastructure/resilience/Retry";
import { Providers, type Currencies } from "../interfaces/types";
import type { BaseConnectorInterface } from "./connector";

export class ProviderB implements BaseConnectorInterface {
    readonly baseUrl: string;
    #client: LogicalOperationResilientClient;
    constructor(readonly url: string) {
        this.baseUrl = url;
        this.#client = new LogicalOperationResilientClient(
            new CircuitBreaker(),
            new Bulkhead(this.constructor.name),
            new Retry({
                retryableErrors: new Set([
                    "PROVIDER_TIMEOUT",
                    "PROVIDER_UNAVAILABLE",
                ]),
            }),
            new RequestCoalescer(),
        );
    }
    async connect() {}
    async close() {}
    async getRates(sourceCurrency: Currencies, targetCurrency: Currencies) {
        const fn = async ({ signal }: { signal: AbortSignal }) => {
            const response = await fetch(
                `${this.baseUrl}/rates/${sourceCurrency}/${targetCurrency}`,
                { signal },
            );
            if (!response.ok) {
                if (response.status === 500) {
                    throw new ProviderUnavailableError(response);
                }
                if (response.status === 504) {
                    throw new ProviderTimeoutError(response);
                }
                const error = new ProviderError(response);
                throw error;
            }
            return response.json();
        };
        const coalescerKey = `GetRates::${Providers.PROVIDER_B}-${sourceCurrency}-${targetCurrency}`;
        const rates = await this.#client.execute(coalescerKey, fn);
        return {
            from: sourceCurrency,
            to: targetCurrency,
            rate: rates.rate,
            provider: Providers.PROVIDER_B,
            fetchedAt: new Date(),
        };
    }
}
