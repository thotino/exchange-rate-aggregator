import { describe, expect, it, vi } from "vitest";
import { LogicalOperationResilientClient } from "../ResilientClient";
import { RequestCoalescer } from "../RequestCoalescer";
import { JitterStatuses } from "../constants";
import { ResilienceError } from "../errors/ResilienceError";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function createClient() {
    return new LogicalOperationResilientClient({
        retryOptions: {
            maxAttempts: 1,
            initialDelay: 1,
            maxDelay: 1,
            factor: 2,
            jitter: JitterStatuses.NONE,
            timeout: 10_000,
            retryableErrors: [],
            retryableStatusCodes: [],
        },
        circuitBreakerOptions: {
            failureThreshold: 3,
            resetTimeout: 1_000,
            halfOpenRequests: 1,
        },
        bulkheadOptions: {
            name: "request-coalescer-test",
            maxConcurrent: 2,
            maxWaiting: 2,
            timeoutMS: 1_000,
        },
    });
}

describe("RequestCoalescer", () => {
    it("runs one operation for concurrent requests with the same key and shares its result", async () => {
        const coalescer = new RequestCoalescer();
        const gate = deferred<{ rate: number }>();
        const operation = vi.fn(() => gate.promise);

        const first = coalescer.get("same-key", operation);
        const second = coalescer.get("same-key", operation);

        expect(operation).toHaveBeenCalledTimes(1);

        const result = { rate: 1.25 };
        gate.resolve(result);
        const [firstResult, secondResult] = await Promise.all([first, second]);

        expect(firstResult).toBe(result);
        expect(secondResult).toBe(result);
        expect(operation).toHaveBeenCalledTimes(1);
    });

    it("does not apply a later coalesced request's cancellation signal to the shared operation", async () => {
        const client = createClient();
        const gate = deferred<{ rate: number }>();
        const firstController = new AbortController();
        const laterController = new AbortController();
        const operationStarted = deferred<void>();
        let operationSignal!: AbortSignal;
        const operation = vi.fn(({ signal }: { signal: AbortSignal }) => {
            operationSignal = signal;
            operationStarted.resolve(undefined);
            return gate.promise;
        });
        const laterOperation = vi.fn(async () => ({ rate: 99 }));

        const first = client.execute("same-key", operation, {
            cancelSignal: firstController.signal,
        });
        const later = client.execute("same-key", laterOperation, {
            cancelSignal: laterController.signal,
        });
        await operationStarted.promise;
        laterController.abort();

        expect(operation).toHaveBeenCalledTimes(1);
        expect(laterOperation).not.toHaveBeenCalled();
        expect(operationSignal.aborted).toBe(false);

        const result = { rate: 1.25 };
        gate.resolve(result);
        const [firstResult, laterResult] = await Promise.all([first, later]);

        expect(firstResult).toBe(result);
        expect(laterResult).toBe(result);
    });

    it("shares cancellation of the initiating request, then permits a new request for that key", async () => {
        const client = createClient();
        const initiatingController = new AbortController();
        const otherController = new AbortController();
        const operationStarted = deferred<void>();
        const abortedOperation = vi.fn(
            ({ signal }: { signal: AbortSignal }) =>
                new Promise<never>((_resolve, reject) => {
                    operationStarted.resolve(undefined);
                    const rejectForAbort = () =>
                        reject(
                            new Error("underlying operation aborted", {
                                cause: { code: "ABORTED" },
                            }),
                        );
                    signal.addEventListener("abort", rejectForAbort, {
                        once: true,
                    });
                    if (signal.aborted) rejectForAbort();
                }),
        );

        const initiatingRequest = client.execute(
            "same-key",
            abortedOperation,
            { cancelSignal: initiatingController.signal },
        );
        const otherRequest = client.execute("same-key", abortedOperation, {
            cancelSignal: otherController.signal,
        });

        await operationStarted.promise;
        initiatingController.abort();
        const [initiatingError, otherError] = await Promise.all([
            initiatingRequest.catch((error: unknown) => error),
            otherRequest.catch((error: unknown) => error),
        ]);

        expect(initiatingError).toBeInstanceOf(ResilienceError);
        expect(otherError).toBe(initiatingError);
        expect(abortedOperation).toHaveBeenCalledTimes(1);

        const nextOperation = vi.fn(async () => "next result");
        await expect(
            client.execute("same-key", nextOperation, {
                cancelSignal: new AbortController().signal,
            }),
        ).resolves.toBe("next result");
        expect(nextOperation).toHaveBeenCalledTimes(1);
    });
});
