import { resilientClient } from "../infrastructure/resilience";
import { Providers, type Currencies } from "../interfaces/types.js";

export class ProviderB {
    readonly baseUrl: string;
    constructor(readonly url: string) {
        this.baseUrl = url;
    }
    async getRates(sourceCurrency: Currencies, targetCurrency: Currencies) {
        const fn = () =>
            fetch(`${this.baseUrl}/rates/${sourceCurrency}/${targetCurrency}`);
        const rates = await resilientClient.execute(fn);
        return {
            from: sourceCurrency,
            to: targetCurrency,
            rate: rates.rate,
            provider: Providers.PROVIDER_B,
        };
    }
}
