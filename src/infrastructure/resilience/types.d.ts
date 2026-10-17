export interface ResilienceErrorInterface {
    readonly isRetryable: boolean;
    readonly isCircuitBreakerFailure: boolean;
    readonly code: string;
    readonly message: string;
}
