export type Rate = {
    from: Currencies;
    to: Currencies;
    rate: number;
    provider: Providers;
    fetchedAt: number;
    receivedAt: number;
    expiresAt: number;
};
export interface RateProvider {
    baseUrl: string;
    getRates: (
        sourceCurrency: Currencies,
        targetCurrency: Currencies,
        options: GetRatesOptions,
    ) => Promise<Rate>;
}