export class CircuitBreakerOpenError extends Error {
    code: string = "ERR_CIRCUIT_BREAKER_OPEN";
    constructor() {
        const message: string = "Circuit breaker is open";
        super(message);
    }
}