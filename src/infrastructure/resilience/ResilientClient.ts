import type { Bulkhead } from "./Bulkhead";
import type { CircuitBreaker } from "./CircuitBreaker";
import type { RequestCoalescer } from "./RequestCoalescer";
import type { Retry } from "./Retry";

abstract class ResilientClient {
    constructor(
        readonly circuitBreaker: CircuitBreaker,
        readonly bulkHead: Bulkhead,
        readonly retry: Retry,
        readonly requestCoalescer: RequestCoalescer,
    ) {}
    async connect() {
        await Promise.all([
            this.bulkHead.connect(),
            this.circuitBreaker.connect(),
        ]);
    }
    async close() {
        await Promise.all([this.circuitBreaker.close(), this.bulkHead.close()]);
    }
    abstract execute<T>(
        key: string,
        fn: (options: { signal: AbortSignal }) => Promise<T>,
        options: { cancelSignal: AbortSignal },
    ): Promise<T>;
}

export class LogicalOperationResilientClient extends ResilientClient {
    execute<T>(
        key: string,
        fn: (options: { signal: AbortSignal }) => Promise<T>,
        options: { cancelSignal: AbortSignal },
    ) {
        return this.requestCoalescer.get(key, () =>
            this.circuitBreaker.execute(() =>
                this.retry.execute(
                    ({ signal }) => {
                        return this.bulkHead.execute(() => fn({ signal }), {
                            cancelSignal: options.cancelSignal,
                        });
                    },
                    { cancelSignal: options.cancelSignal },
                ),
            ),
        );
    }
}
export class PerAttemptResilientClient extends ResilientClient {
    execute<T>(
        key: string,
        fn: (options: { signal: AbortSignal }) => Promise<T>,
        options: { cancelSignal: AbortSignal },
    ) {
        return this.requestCoalescer.get(key, () =>
            this.retry.execute(
                ({ signal }) => {
                    return this.circuitBreaker.execute(() =>
                        this.bulkHead.execute(() => fn({ signal }), {
                            cancelSignal: options.cancelSignal,
                        }),
                    );
                },
                { cancelSignal: options.cancelSignal },
            ),
        );
    }
}
