import type { Bulkhead } from "./Bulkhead";
import type { CircuitBreaker } from "./CircuitBreaker";
import type { RateLimiter } from "./RateLimiter";
import type { Retry } from "./Retry";

export class ResilientClient {
    constructor(
        readonly circuitBreaker: CircuitBreaker,
        readonly bulkHead: Bulkhead,
        readonly rateLimiter: RateLimiter,
        readonly retry: Retry,
    ) {}
    execute<T>(fn: () => Promise<T>) {
        return this.bulkHead.execute(() =>
            this.circuitBreaker.execute(() => this.retry.execute(fn)),
        );
    }
}
