export class CustomTimeoutError extends Error {
    readonly code: string = "ERR_ATTEMPT_TIMEOUT";
    readonly retryable: boolean = true;
    readonly circuitBreakerFailure: boolean = true;
    constructor() {
        super();
    }
}
