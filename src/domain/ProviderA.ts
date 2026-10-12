import { Bulkhead } from "../infrastructure/resilience/Bulkhead.js";
import { CircuitBreaker } from "../infrastructure/resilience/CircuitBreaker.js";
import { ResilientClient } from "../infrastructure/resilience/ResilientClient.js";
import { Retry } from "../infrastructure/resilience/Retry.js";
import { Providers, type Currencies } from "../interfaces/types.js";

export class ProviderA {
    readonly baseUrl: string;
    #client: ResilientClient;
    constructor(readonly url: string) {
        this.baseUrl = url;
        this.#client = new ResilientClient(
            new CircuitBreaker(),
            new Bulkhead(this.constructor.name),
            new Retry(),
        );
    }
    async getRates(sourceCurrency: Currencies, targetCurrency: Currencies) {
        const timeOut = AbortSignal.timeout(20);
        const fn = async () => {
            const response = await fetch(
                `${this.baseUrl}/rates/${sourceCurrency}/${targetCurrency}`,
                { signal: timeOut },
            );
            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}`);
                error.response = response;
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
