import { resilientClient } from "../infrastructure/resilience";
import { Providers, type Currencies } from "../interfaces/types.js";

export class ProviderA {
    readonly baseUrl: string;
    constructor(readonly url: string) {
        this.baseUrl = url;
    }
    async getRates(sourceCurrency: Currencies, targetCurrency: Currencies) {
        const fn = async () => {
            const response = await fetch(
                `${this.baseUrl}/rates/${sourceCurrency}/${targetCurrency}`,
            );
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
