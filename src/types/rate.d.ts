export type RawRate = {
    rate: number;
    asOf: number;
    pair: string
};


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