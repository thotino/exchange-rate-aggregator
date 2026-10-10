import { resilientClient } from "../infrastructure/resilience";
import { Providers, type Currencies } from "../interfaces/types.js";

export class ProviderA {
    readonly baseUrl: string;
    constructor(readonly url: string) {
        this.baseUrl = url;
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
        const response = await resilientClient.execute(fn);
        return {
            from: sourceCurrency,
            to: targetCurrency,
            rate: response.rate,
            provider: Providers.PROVIDER_A,
        };
    }
}
