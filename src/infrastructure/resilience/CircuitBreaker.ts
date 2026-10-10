enum CircuitBreakerStates {
    CLOSED = "closed",
    OPEN = "open",
    HALF_OPEN = "half-open",
}

export class CircuitBreaker {
    #failureThreshold = 1;
    #resetTimeout = 30_000;
    #halfOpenRequests = 1;
    #state = CircuitBreakerStates.CLOSED;
    #failures = 0;
    #successes = 0;
    #lastFailure: number | null = null;
    #halfOpenAttemps = 0;
    constructor() {}

    async execute<T>(fn: () => Promise<T>) {
        if (this.#state === CircuitBreakerStates.OPEN) {
            if (
                this.#lastFailure !== null &&
                Date.now() - this.#lastFailure > this.#resetTimeout
            ) {
                this.#state = CircuitBreakerStates.HALF_OPEN;
                console.log('Circuit breaker: OPEN -> HALF_OPEN');
                this.#halfOpenAttemps = 0;
            } else {
                throw new Error("ERR_CIRCUIT_BREAKER_OPEN");
            }
        }
        if (
            this.#state === CircuitBreakerStates.HALF_OPEN &&
            this.#halfOpenAttemps >= this.#halfOpenRequests
        ) {
            throw new Error("ERR_CIRCUIT_BREAKER_HALF_OPEN");
        }
        try {
            if (this.#state === CircuitBreakerStates.HALF_OPEN) {
                this.#halfOpenAttemps++;
            }
            const result = await fn();
            this.#onSuccess();
            return result;
        } catch (error) {
            this.#onFailure();
            throw error;
        }
    }

    #onSuccess() {
        if (this.#state === CircuitBreakerStates.HALF_OPEN) {
            this.#successes++;
            if (this.#successes >= this.#halfOpenRequests) {
                this.#state = CircuitBreakerStates.CLOSED;
                console.log('Circuit breaker: HALF_OPEN -> CLOSED');
                this.#failures = 0;
                this.#successes = 0;
            }
        } else {
            this.#failures = 0;
        }
    }

    #onFailure() {
        this.#failures++;
        this.#lastFailure = Date.now();
        if (this.#state === CircuitBreakerStates.HALF_OPEN) {
            this.#state = CircuitBreakerStates.OPEN;
            console.log('Circuit breaker: HALF OPEN -> OPEN');
            this.#successes = 0;
        } else if (this.#failures >= this.#failureThreshold) {
            this.#state = CircuitBreakerStates.OPEN;
            console.log('Circuit breaker: CLOSED -> OPEN');
        }
    }

    getState() {
        return {
            state: this.#state,
            failures: this.#failures,
            lastFailure: this.#lastFailure,
        };
    }
}
