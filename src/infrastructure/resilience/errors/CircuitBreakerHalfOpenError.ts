import type { ResilienceErrorInterface } from "../types";

export class CircuitBreakerHalfOpenError extends Error implements ResilienceErrorInterface{
    code: string = "ERR_CIRCUIT_BREAKER_HALF_OPEN";
    isRetryable: boolean = false;
    isCircuitBreakerFailure: boolean= false;
    constructor() {
        const message: string =
            "Circuit breaker is half open, waiting for test requests";
        super(message);
    }
}