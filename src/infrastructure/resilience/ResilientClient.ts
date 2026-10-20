import { Bulkhead } from "./Bulkhead";
import { CircuitBreaker } from "./CircuitBreaker";
import { RequestCoalescer } from "./RequestCoalescer";
import { Retry } from "./Retry";
import type { ResilienceClientConfig } from "./types";

export abstract class ResilientClient {
    readonly retry: Retry
    readonly bulkhead: Bulkhead
    readonly circuitBreaker: CircuitBreaker
    readonly requestCoalescer: RequestCoalescer
    constructor(
        options: ResilienceClientConfig
    ) {
        this.retry = new Retry(options.retryOptions)
        this.bulkhead = new Bulkhead(options.bulkheadOptions)
        this.circuitBreaker = new CircuitBreaker(options.circuitBreakerOptions)
        this.requestCoalescer = new RequestCoalescer()
    }
    async connect() {
        await Promise.all([
            this.bulkhead.connect(),
            this.circuitBreaker.connect(),
        ]);
    }
    async close() {
        await Promise.all([this.circuitBreaker.close(), this.bulkhead.close()]);
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
                        return this.bulkhead.execute(() => fn({ signal }), {
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
                        this.bulkhead.execute(() => fn({ signal }), {
                            cancelSignal: options.cancelSignal,
                        }),
                    );
                },
                { cancelSignal: options.cancelSignal },
            ),
        );
    }
}
