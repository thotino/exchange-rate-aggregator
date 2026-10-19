export interface BaseConnectorInterface {
    connect: () => Promise<void>;
    close: () => Promise<void>;
}
export interface GetRatesOptions {
    cancelSignal: AbortSignal
}