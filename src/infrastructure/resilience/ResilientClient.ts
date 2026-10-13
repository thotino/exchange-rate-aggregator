import type { Bulkhead } from "./Bulkhead";
import type { CircuitBreaker } from "./CircuitBreaker";
import type { Retry } from "./Retry";

class ResilientClient {
    constructor(
        readonly circuitBreaker: CircuitBreaker,
        readonly bulkHead: Bulkhead,
        readonly retry: Retry,
    ) {}
    execute<T>(fn: () => Promise<T>) {
        throw new Error("ERR_NOT_IMPLEMENTED");
    }
}

export class LogicalOperationResilientClient extends ResilientClient {
    execute<T>(fn: () => Promise<T>): Promise<unknown> {
        return this.circuitBreaker.execute(() =>
            this.retry.execute(() => this.bulkHead.execute(() => fn())),
        );
    }
}
export class PerAttemptResilientClient extends ResilientClient {
    execute<T>(fn: () => Promise<T>): Promise<unknown> {
        return this.retry.execute(() =>
            this.circuitBreaker.execute(() =>
                this.bulkHead.execute(() => fn()),
            ),
        );
    }
}
