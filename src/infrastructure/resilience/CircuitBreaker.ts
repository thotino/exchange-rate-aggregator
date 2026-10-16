/**
 * @see https://oneuptime.com/blog/post/2026-01-06-nodejs-retry-exponential-backoff/view#circuit-breaker-pattern
 */

import { CircuitBreakerHalfOpenError } from "./errors/CircuitBreakerHalfOpenError";
import { CircuitBreakerOpenError } from "./errors/CircuitBreakerOpenError";
import { logger } from "./logger";

const FAILURE_STATUS_CODES = new Set([500, 502, 503, 504]);
const FAILURE_ERRORS = new Set(["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED"]);
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

export class CircuitBreaker {
    #failureThreshold = 1;
    #resetTimeout = 30_000;
    #halfOpenRequests = 1;
    #state = CircuitBreakerStates.CLOSED;
    #failures = 0;
    #successes = 0;
    #lastFailure: number | null = null;
    #halfOpenAttemps = 0;
    #stateInterval: NodeJS.Timeout | null = null;
    constructor(
        options: CircuitBreakerOptions = {
            failureThreshold: 1,
            resetTimeout: 30_000,
            halfOpenRequests: 1,
        },
    ) {
        this.#failureThreshold = options.failureThreshold;
        this.#resetTimeout = options.resetTimeout;
        this.#halfOpenRequests = options.halfOpenRequests;
    }
    async connect() {
        if (this.#stateInterval == null) {
            this.#stateInterval = setInterval(() => {
                logger.debug("[CircuitBreaker]:: Metrics", this.getState());
            }, 10_000);
        }
    }
    async close() {
        if (this.#stateInterval != null) {
            clearInterval(this.#stateInterval);
            this.#stateInterval = null;
        }
    }

    async execute<T>(fn: () => Promise<T>) {
        if (this.#state === CircuitBreakerStates.OPEN) {
            if (
                this.#lastFailure !== null &&
                Date.now() - this.#lastFailure > this.#resetTimeout
            ) {
                this.#state = CircuitBreakerStates.HALF_OPEN;
                logger.debug("[CircuitBreaker]: OPEN -> HALF_OPEN");
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
            logger.error("[CircuitBreaker]", { error });
            if (CircuitBreaker.#isFailure(error)) {
                this.#onFailure();
            }
            throw error;
        }
    }

    #onSuccess() {
        if (this.#state === CircuitBreakerStates.HALF_OPEN) {
            this.#successes++;
            if (this.#successes >= this.#halfOpenRequests) {
                this.#state = CircuitBreakerStates.CLOSED;
                logger.debug("[CircuitBreaker]: HALF_OPEN -> CLOSED");
                this.#failures = 0;
                this.#successes = 0;
            }
        } else {
            this.#failures = 0;
        }
    }
    static #isFailure(error: unknown) {
        if (
            (error.code != null || error.status != null) &&
            (FAILURE_STATUS_CODES.has(error.code ?? error.status) ||
                FAILURE_ERRORS.has(error.code ?? error.status))
        ) {
            return true;
        }
        return false;
    }

    #onFailure() {
        this.#failures++;
        this.#lastFailure = Date.now();
        if (this.#state === CircuitBreakerStates.HALF_OPEN) {
            this.#state = CircuitBreakerStates.OPEN;
            logger.debug("[CircuitBreaker]: HALF OPEN -> OPEN");
            this.#successes = 0;
        } else if (this.#failures >= this.#failureThreshold) {
            this.#state = CircuitBreakerStates.OPEN;
            logger.debug("[CircuitBreaker]: CLOSED -> OPEN");
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
