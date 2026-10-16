export class CircuitBreakerHalfOpenError extends Error {
    code: string = "ERR_CIRCUIT_BREAKER_HALF_OPEN";
    constructor() {
        const message: string =
            "Circuit breaker is half open, waiting for test requests";
        super(message);
    }
}