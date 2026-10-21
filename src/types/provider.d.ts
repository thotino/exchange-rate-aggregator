import type { BaseConnectorInterface } from "./connector";

export type Rate = {
    from: Currencies;
    to: Currencies;
    rate: number;
    provider: Providers;
    requestedAt: number;
    receivedAt: number;
    expiresAt: number;
    providerUpdatedAt?: number
};
export interface RateProvider extends BaseConnectorInterface {
    baseUrl: string;
    getRates: (
        sourceCurrency: Currencies,
        targetCurrency: Currencies,
        options: GetRatesOptions,
    ) => Promise<Rate>;
}