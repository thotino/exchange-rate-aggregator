export enum Providers {
    PROVIDER_A = "provider-a",
    PROVIDER_B = "provider-b",
}

export enum SimulationModes {
    NORMAL = "normal",
    SLOW = "slow",
    HTTP_500 = "http-500",
    UNAVAILABLE = "unavailable",
    TIMEOUT = "timeout",
    INVALID = "invalid",
}

export enum Currencies {
    EUR = "eur",
    USD = "usd",
    GBP = "gbp",
}

export interface RateServerConfig {
    host: string;
    port: number;
    simulationMode: SimulationModes;
    simulationDelayMs: number;
}
