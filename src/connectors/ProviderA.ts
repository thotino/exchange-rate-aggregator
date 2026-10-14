import { ProviderTimeoutError } from "../errors/ProviderTimeoutError";
import { ProviderUnavailableError } from "../errors/ProviderUnavailableError";
import { Bulkhead } from "../infrastructure/resilience/Bulkhead";
import { CircuitBreaker } from "../infrastructure/resilience/CircuitBreaker";
import { LogicalOperationResilientClient } from "../infrastructure/resilience/ResilientClient";
import { Retry,  } from "../infrastructure/resilience/Retry";
import { Providers, type Currencies } from "../interfaces/types";
class ProviderError extends Error {
    code;
    response;
    constructor(response: Response) {
        const message: string = response.statusText 
        super(message)
        this.response = response
        this.code = response.status;
    }
}
export class ProviderA {
    readonly baseUrl: string;
    // TODO: implement the inversion of dependencies here
    #client: LogicalOperationResilientClient;
    constructor(readonly url: string) {
        this.baseUrl = url;
        this.#client = new LogicalOperationResilientClient(
            new CircuitBreaker(),
            new Bulkhead(this.constructor.name),
            new Retry({
                maxAttempts: 3,
                retryableErrors: new Set([
                    "PROVIDER_TIMEOUT",
                    "PROVIDER_UNAVAILABLE",
                ]),
            }),
        );
    }
    async getRates(sourceCurrency: Currencies, targetCurrency: Currencies) {
        const fn = async ({ signal }: { signal: AbortSignal }) => {
            const response = await fetch(
                `${this.baseUrl}/rates/${sourceCurrency}/${targetCurrency}`,
                { signal },
            );
            if (!response.ok) {
                if (response.status === 500) {
                    throw new ProviderUnavailableError();
                }
                if (response.status === 504) {
                    throw new ProviderTimeoutError();
                }
                const error = new ProviderError(response)
                throw error;
            }
            return response.json();
        };
        const response = await this.#client.execute(fn);
        return {
            from: sourceCurrency,
            to: targetCurrency,
            rate: response.rate,
            provider: Providers.PROVIDER_A,
        };
    }
}
