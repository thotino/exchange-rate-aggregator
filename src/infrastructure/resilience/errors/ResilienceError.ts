import type { ResilienceErrorInterface } from "../types";

export class ResilienceError extends Error implements ResilienceErrorInterface {
    isCircuitBreakerFailure: boolean;
    isRetryable: boolean;
    code: string;
    constructor(
        message: string,
        code: string,
        isRetryable: boolean,
        isCircuitBreakerFailure: boolean,
        cause: unknown,
    ) {
        super(message, { cause });
        this.code = code
        this.isRetryable = isRetryable;
        this.isCircuitBreakerFailure = isCircuitBreakerFailure;
    }
}
