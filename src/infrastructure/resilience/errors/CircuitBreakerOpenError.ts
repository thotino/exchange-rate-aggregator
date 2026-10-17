import type { ResilienceErrorInterface } from "../types";

export class CircuitBreakerOpenError extends Error implements ResilienceErrorInterface{
    isRetryable: boolean = false;
    isCircuitBreakerFailure: boolean = false
    code: string = "ERR_CIRCUIT_BREAKER_OPEN";
    constructor() {
        const message: string = "Circuit breaker is open";
        super(message);
    }
}