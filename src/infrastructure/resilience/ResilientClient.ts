import type { Bulkhead } from "./Bulkhead";
import type { CircuitBreaker } from "./CircuitBreaker";
import type { Retry } from "./Retry";

class ResilientClient {
    constructor(
        readonly circuitBreaker: CircuitBreaker,
        readonly bulkHead: Bulkhead,
        readonly retry: Retry,
    ) {}
    execute<T>(fn: (options: { signal: AbortSignal }) => Promise<T>) {
        throw new Error("ERR_NOT_IMPLEMENTED");
    }
}

export class LogicalOperationResilientClient extends ResilientClient {
    execute<T>(
        fn: (options: { signal: AbortSignal }) => Promise<T>,
    ): Promise<unknown> {
        return this.circuitBreaker.execute(() =>
            this.retry.execute(({ signal }) =>
                this.bulkHead.execute(() => fn({ signal })),
            ),
        );
    }
}
export class PerAttemptResilientClient extends ResilientClient {
    execute<T>(
        fn: (options: { signal: AbortSignal }) => Promise<T>,
    ): Promise<unknown> {
        return this.retry.execute(({ signal }) =>
            this.circuitBreaker.execute(() =>
                this.bulkHead.execute(() => fn({ signal })),
            ),
        );
    }
}
