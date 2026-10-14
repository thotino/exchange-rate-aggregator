import type { Bulkhead } from "./Bulkhead";
import type { CircuitBreaker } from "./CircuitBreaker";
import type { RequestCoalescer } from "./RequestCoalescer";
import type { Retry } from "./Retry";

class ResilientClient {
    constructor(
        readonly circuitBreaker: CircuitBreaker,
        readonly bulkHead: Bulkhead,
        readonly retry: Retry,
        readonly requestCoalescer: RequestCoalescer,
    ) {}
    execute<T>(
        key: string,
        fn: (options: { signal: AbortSignal }) => Promise<T>,
    ) {
        throw new Error("ERR_NOT_IMPLEMENTED");
    }
}

export class LogicalOperationResilientClient extends ResilientClient {
    execute<T>(
        key: string,
        fn: (options: { signal: AbortSignal }) => Promise<T>,
    ) {
        return this.requestCoalescer.get(key, () =>
            this.circuitBreaker.execute(() =>
                this.retry.execute(({ signal }) =>
                    this.bulkHead.execute(() => fn({ signal })),
                ),
            ),
        );
    }
}
export class PerAttemptResilientClient extends ResilientClient {
    execute<T>(
        key: string,
        fn: (options: { signal: AbortSignal }) => Promise<T>,
    ) {
        return this.requestCoalescer.get(key, () =>
            this.retry.execute(({ signal }) =>
                this.circuitBreaker.execute(() =>
                    this.bulkHead.execute(() => fn({ signal })),
                ),
            ),
        );
    }
}
