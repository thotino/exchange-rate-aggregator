import type { ErrorClassification, ResilienceErrorInterface } from "../types";

export class ResilienceError extends Error implements ResilienceErrorInterface {
    isCircuitBreakerFailure: boolean;
    isRetryable: boolean;
    code: string;
    message: string;
    constructor(
        message: string,
        code: string,
        isRetryable: boolean,
        isCircuitBreakerFailure: boolean,
        cause: unknown,
    ) {
        super(message, { cause });
        this.message = message;
        this.code = code;
        this.isRetryable = isRetryable;
        this.isCircuitBreakerFailure = isCircuitBreakerFailure;
    }

    static from(
        error: Error,
        options: ErrorClassification,
    ) {
        if (error instanceof ResilienceError) return error;
        const code = error.cause instanceof Response ? error.cause.statusText : "ERR_UNEXPECTED_ERROR"
        return new ResilienceError(
            error.message,
            code,
            options.isRetryable,
            options.isCircuitBreakerFailure,
            error,
        );
    }
}
