import { resilientClient } from "../infrastructure/resilience";
import { Providers, type Currencies } from "../interfaces/types.js";

export class ProviderB {
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
            return response.json();
        };
        const rates = await resilientClient.execute(fn);
        return {
            from: sourceCurrency,
            to: targetCurrency,
            rate: rates.rate,
            provider: Providers.PROVIDER_B,
        };
    }
}
