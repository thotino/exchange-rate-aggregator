import type { BaseConnectorInterface } from "./connector";


export interface RateProvider extends BaseConnectorInterface {
    baseUrl: string;
    getRates: (
        sourceCurrency: Currencies,
        targetCurrency: Currencies,
        options: GetRatesOptions,
    ) => Promise<Rate>;
}