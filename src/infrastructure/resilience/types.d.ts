export interface ResilienceErrorInterface {
    readonly isRetryable: boolean;
    readonly isCircuitBreakerFailure: boolean;
}
