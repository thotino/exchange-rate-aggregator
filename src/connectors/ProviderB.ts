import { Bulkhead } from "../infrastructure/resilience/Bulkhead";
import { CircuitBreaker } from "../infrastructure/resilience/CircuitBreaker";
import { LogicalOperationResilientClient } from "../infrastructure/resilience/ResilientClient";
import { Retry } from "../infrastructure/resilience/Retry";
import { Providers, type Currencies } from "../interfaces/types";

export class ProviderB {
    readonly baseUrl: string;
    #client: LogicalOperationResilientClient;
    constructor(readonly url: string) {
        this.baseUrl = url;
        this.#client = new LogicalOperationResilientClient(
            new CircuitBreaker(),
            new Bulkhead(this.constructor.name),
            new Retry(),
        );
    }
    async getRates(sourceCurrency: Currencies, targetCurrency: Currencies) {
        const timeOut = AbortSignal.timeout(30_000);
        const fn = async () => {
            const response = await fetch(
                `${this.baseUrl}/rates/${sourceCurrency}/${targetCurrency}`,
                { signal: timeOut },
            );
            return response.json();
        };
        const rates = await this.#client.execute(fn);
        return {
            from: sourceCurrency,
            to: targetCurrency,
            rate: rates.rate,
            provider: Providers.PROVIDER_B,
        };
    }
}
