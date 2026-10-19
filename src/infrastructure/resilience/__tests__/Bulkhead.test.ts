import { afterEach, describe, expect, it, vi } from "vitest";
import { Bulkhead } from "../Bulkhead";
import { CircuitBreaker } from "../CircuitBreaker";
import { BulkheadRejectedError } from "../errors/BulkheadRejectedError";
import { BulkheadTimeoutError } from "../errors/BulkheadTimeoutError";
import type { BulkheadOptions } from "../types";

const defaultOptions: BulkheadOptions = {
    name: "testBulkhead",
    maxConcurrent: 1,
    maxWaiting: 2,
    timeoutMS: 100,
};

function createBulkhead(options: Partial<BulkheadOptions> = {}) {
    return new Bulkhead({ ...defaultOptions, ...options });
}

describe("Bulkhead", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("never runs more operations concurrently than maxConcurrent", async () => {
        const bulkhead = createBulkhead({ maxConcurrent: 2, maxWaiting: 3 });
        let releaseOperations!: () => void;
        const operationGate = new Promise<void>((resolve) => {
            releaseOperations = resolve;
        });
        let activeOperations = 0;
        let peakActiveOperations = 0;
        const executions = Array.from({ length: 5 }, () =>
            bulkhead.execute(async () => {
                activeOperations++;
                peakActiveOperations = Math.max(
                    peakActiveOperations,
                    activeOperations,
                );
                await operationGate;
                activeOperations--;
            }, { cancelSignal: new AbortController().signal }),
        );

        await Promise.resolve();
        expect(bulkhead.getMetrics().waitingCount).toBe(3);
        expect(peakActiveOperations).toBe(2);

        releaseOperations();
        await Promise.all(executions);

        expect(peakActiveOperations).toBeLessThanOrEqual(2);
        expect(activeOperations).toBe(0);
        expect(bulkhead.getMetrics().availablePermits).toBe(2);
    });

    it("rejects work when maxWaiting is reached", async () => {
        const bulkhead = createBulkhead({ maxWaiting: 2 });
        let releaseRunningOperation!: () => void;
        const runningOperation = new Promise<void>((resolve) => {
            releaseRunningOperation = resolve;
        });
        const running = bulkhead.execute(() => runningOperation, {
            cancelSignal: new AbortController().signal,
        });
        const waiting = Array.from({ length: 2 }, () =>
            bulkhead.execute(async () => undefined, {
                cancelSignal: new AbortController().signal,
            }),
        );

        await expect(
            bulkhead.execute(async () => "should not run", {
                cancelSignal: new AbortController().signal,
            }),
        ).rejects.toBeInstanceOf(BulkheadRejectedError);
        expect(bulkhead.getMetrics().waitingCount).toBe(2);
        expect(bulkhead.getMetrics().rejected).toBe(1);

        releaseRunningOperation();
        await Promise.all([running, ...waiting]);
        expect(bulkhead.getMetrics().waitingCount).toBe(0);
    });

    it("releases a permit after both successful and failed operations", async () => {
        const bulkhead = createBulkhead();
        const cancelSignal = new AbortController().signal;

        await expect(
            bulkhead.execute(async () => "ok", { cancelSignal }),
        ).resolves.toBe("ok");
        expect(bulkhead.getMetrics().availablePermits).toBe(1);

        const failure = new Error("operation failed");
        await expect(
            bulkhead.execute(async () => {
                throw failure;
            }, { cancelSignal }),
        ).rejects.toBe(failure);
        expect(bulkhead.getMetrics().availablePermits).toBe(1);
        expect(bulkhead.getMetrics()).toMatchObject({ completed: 1, failed: 1 });
    });

    it("never runs an operation whose queue wait timed out", async () => {
        vi.useFakeTimers();
        const bulkhead = createBulkhead({ timeoutMS: 10 });
        let releaseRunningOperation!: () => void;
        const runningOperation = new Promise<void>((resolve) => {
            releaseRunningOperation = resolve;
        });
        const running = bulkhead.execute(() => runningOperation, {
            cancelSignal: new AbortController().signal,
        });
        const queuedOperation = vi.fn(async () => "should not run");
        const waiting = bulkhead.execute(queuedOperation, {
            cancelSignal: new AbortController().signal,
        });

        const rejection = expect(waiting).rejects.toBeInstanceOf(
            BulkheadTimeoutError,
        );
        await vi.advanceTimersByTimeAsync(10);
        await rejection;

        releaseRunningOperation();
        await running;

        expect(queuedOperation).not.toHaveBeenCalled();
        expect(bulkhead.getMetrics().timedOut).toBe(1);
    });

    it("does not count bulkhead rejection as a circuit breaker failure", async () => {
        const bulkhead = createBulkhead({ maxWaiting: 0 });
        const circuitBreaker = new CircuitBreaker({
            failureThreshold: 1,
            resetTimeout: 100,
            halfOpenRequests: 1,
        });
        let releaseRunningOperation!: () => void;
        const runningOperation = new Promise<void>((resolve) => {
            releaseRunningOperation = resolve;
        });
        const execute = () =>
            circuitBreaker.execute(() =>
                bulkhead.execute(() => runningOperation, {
                    cancelSignal: new AbortController().signal,
                }),
            );
        const running = execute();

        await expect(execute()).rejects.toBeInstanceOf(BulkheadRejectedError);
        expect(circuitBreaker.getState()).toMatchObject({
            state: "closed",
            failures: 0,
        });

        releaseRunningOperation();
        await running;
    });

    it("keeps the permit while an aborted operation is still running", async () => {
        const bulkhead = createBulkhead({ maxWaiting: 0 });
        const controller = new AbortController();
        let finishBackgroundWork!: () => void;
        const backgroundWork = new Promise<void>((resolve) => {
            finishBackgroundWork = resolve;
        });
        const operation = bulkhead.execute(
            async ({ signal }) => {
                await backgroundWork;
                return signal.aborted;
            },
            { cancelSignal: controller.signal },
        );

        controller.abort(new Error("operation timed out"));
        await Promise.resolve();

        expect(bulkhead.getMetrics().availablePermits).toBe(0);
        await expect(
            bulkhead.execute(async () => "should not run", {
                cancelSignal: new AbortController().signal,
            }),
        ).rejects.toBeInstanceOf(BulkheadRejectedError);

        finishBackgroundWork();
        await expect(operation).resolves.toBe(true);
        expect(bulkhead.getMetrics().availablePermits).toBe(1);
    });
});