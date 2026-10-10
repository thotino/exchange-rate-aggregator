import type { Currencies, Providers } from "../interfaces/types.js";

type Rate = {
    from: Currencies;
    to: Currencies;
    rate: number;
    provider: Providers;
};
interface RateProvider {
    baseUrl: string;
    getRates: (
        sourceCurrency: Currencies,
        targetCurrency: Currencies,
    ) => Promise<Rate>;
}
export class GetExchangeRate {
    constructor(
        readonly providerA: RateProvider,
        readonly providerB: RateProvider,
    ) {}
    async get(sourceCurrency: Currencies, targetCurrency: Currencies) {
        const ratesA = await this.providerA.getRates(
            sourceCurrency,
            targetCurrency,
        );
        // const ratesB = await this.providerB.getRates(
        //     sourceCurrency,
        //     targetCurrency,
        // );
        console.log({ ratesA });
    }
}
