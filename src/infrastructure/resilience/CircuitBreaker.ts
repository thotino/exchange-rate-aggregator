/**
 * @see https://oneuptime.com/blog/post/2026-01-06-nodejs-retry-exponential-backoff/view#circuit-breaker-pattern
 */

enum CircuitBreakerStates {
    CLOSED = "closed",
    OPEN = "open",
    HALF_OPEN = "half-open",
}
interface CircuitBreakerOptions {
    failureThreshold: number;
    resetTimeout: number;
    halfOpenRequests: number;
}
class CircuitBreakerOpenError extends Error {
    code: string = "ERR_CIRCUIT_BREAKER_OPEN"
    constructor() {
        const message: string = "Circuit breaker is open"
        super(message);
    }
}
class CircuitBreakerHalfOpenError extends Error {
    code: string = "ERR_CIRCUIT_BREAKER_HALF_OPEN"
    constructor() {
        const message: string = "Circuit breaker is half open, waiting for test requests"
        super(message);
    }
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
    constructor(
        options: CircuitBreakerOptions = {
            failureThreshold: 5,
            resetTimeout: 30_000,
            halfOpenRequests: 1,
        },
    ) {
        this.#failureThreshold = options.failureThreshold;
        this.#resetTimeout = options.resetTimeout;
        this.#halfOpenRequests = options.halfOpenRequests;
    }

    async execute<T>(fn: () => Promise<T>) {
        if (this.#state === CircuitBreakerStates.OPEN) {
            if (
                this.#lastFailure !== null &&
                Date.now() - this.#lastFailure > this.#resetTimeout
            ) {
                this.#state = CircuitBreakerStates.HALF_OPEN;
                console.log("Circuit breaker: OPEN -> HALF_OPEN");
                this.#halfOpenAttemps = 0;
            } else {
                throw new CircuitBreakerOpenError();
            }
        }
        if (
            this.#state === CircuitBreakerStates.HALF_OPEN &&
            this.#halfOpenAttemps >= this.#halfOpenRequests
        ) {
            throw new CircuitBreakerHalfOpenError();
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
                console.log("Circuit breaker: HALF_OPEN -> CLOSED");
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
            console.log("Circuit breaker: HALF OPEN -> OPEN");
            this.#successes = 0;
        } else if (this.#failures >= this.#failureThreshold) {
            this.#state = CircuitBreakerStates.OPEN;
            console.log("Circuit breaker: CLOSED -> OPEN");
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
