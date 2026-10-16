/**
 * @see https://oneuptime.com/blog/post/2026-01-24-bulkhead-pattern-nodejs/view
 */

import { BulkheadAcquisitionAbortedError } from "./errors/BulkheadAcquisitionAbortedError";
import { InvalidBulkheadOptionsError } from "./errors/InvalidBulkheadOptionsError";
import { logger } from "./logger";

interface BulkheadOptions {
    readonly maxConcurrent: number;
    readonly maxWaiting: number;
    readonly timeoutMS: number;
}
interface BulkheadMetrics {
    acquired: number;
    rejected: number;
    timedOut: number;
    completed: number;
    failed: number;
}

type Waiter = {
    resolve: () => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
    cancelSignal: AbortSignal;
    onAbort: () => void;
};
export class Bulkhead {
    #name: string;
    #maxConcurrent: number = 10;
    #permits: number = 1;
    #maxWaiting: number = 20;
    #waitTimeoutMS: number = 10_000;
    #waitQueue: Waiter[] = [];
    #metrics: BulkheadMetrics = {
        acquired: 0,
        rejected: 0,
        timedOut: 0,
        completed: 0,
        failed: 0,
    };
    #metricsInterval: NodeJS.Timeout | null = null;
    constructor(
        name: string,
        config: BulkheadOptions = {
            maxConcurrent: 10,
            maxWaiting: 20,
            timeoutMS: 10_000,
        },
    ) {
        this.#name = name;
        if (
            !Number.isInteger(config.maxConcurrent) ||
            config.maxConcurrent <= 0 ||
            !Number.isInteger(config.maxWaiting) ||
            config.maxWaiting < 0 ||
            !Number.isFinite(config.timeoutMS) ||
            config.timeoutMS <= 0
        ) {
            throw new InvalidBulkheadOptionsError();
        }
        this.#maxConcurrent = config.maxConcurrent;
        this.#permits = config.maxConcurrent;
        this.#maxWaiting = config.maxWaiting;
        this.#waitTimeoutMS = config.timeoutMS;
    }

    async #acquire({ cancelSignal }: { cancelSignal: AbortSignal }) {
        if (this.#permits > 0) {
            this.#permits--;
            this.#metrics.acquired++;
            return;
        }
        if (this.#waitQueue.length >= this.#maxWaiting) {
            this.#metrics.rejected++;
            throw new BulkheadRejectedError(
                this.#name,
                this.#maxConcurrent,
                this.#waitQueue.length,
            );
        }
        return new Promise<void>((resolve, reject) => {
            let waiter: Waiter;
            const onAbort = () => {
                if (!this.#removeWaiter(waiter)) return;
                this.#cleanupWaiter(waiter);
                const reason = cancelSignal.reason;
                reject(
                    reason instanceof Error
                        ? reason
                        : new BulkheadAcquisitionAbortedError(),
                );
            };
            const timer = setTimeout(() => {
                if (!this.#removeWaiter(waiter)) return;
                this.#cleanupWaiter(waiter);
                this.#metrics.timedOut++;
                reject(
                    new BulkheadTimeoutError(this.#name, this.#waitTimeoutMS),
                );
            }, this.#waitTimeoutMS);
            waiter = { resolve, reject, timer, cancelSignal, onAbort };
            this.#waitQueue.push(waiter);
            cancelSignal.addEventListener("abort", onAbort, { once: true });
        });
    }
    #removeWaiter(waiter: Waiter) {
        const index = this.#waitQueue.indexOf(waiter);
        if (index === -1) return false;
        this.#waitQueue.splice(index, 1);
        return true;
    }
    #cleanupWaiter(waiter: Waiter) {
        clearTimeout(waiter.timer);
        waiter.cancelSignal.removeEventListener("abort", waiter.onAbort);
    }
    #release(success: boolean = true) {
        if (success) {
            this.#metrics.completed++;
        } else {
            this.#metrics.failed++;
        }
        if (this.#waitQueue.length > 0) {
            const next = this.#waitQueue.shift()!;
            this.#cleanupWaiter(next);
            this.#metrics.acquired++;
            next.resolve();
        } else {
            this.#permits++;
        }
    }
    async connect() {
        if (this.#metricsInterval == null) {
            this.#metricsInterval = setInterval(() => {
                logger.debug("[BulkHead]:: Metrics", this.getMetrics());
            }, 10_000);
        }
    }
    async close() {
        if (this.#metricsInterval != null) {
            clearInterval(this.#metricsInterval);
            this.#metricsInterval = null;
        }
    }
    async execute<T>(
        fn: (options: { signal: AbortSignal }) => Promise<T>,
        options: { cancelSignal: AbortSignal },
    ) {
        if (options.cancelSignal.aborted) {
            throw new Error("ERR_GET_RATES_OPERATION_TIMED_OUT");
        }
        await this.#acquire({ cancelSignal: options.cancelSignal });
        let success = true;
        try {
            return await fn({ signal: options.cancelSignal });
        } catch (error) {
            success = false;
            throw error;
        } finally {
            this.#release(success);
        }
    }
    getMetrics() {
        return {
            name: this.#name,
            availablePermits: this.#permits,
            waitingCount: this.#waitQueue.length,
            ...this.#metrics,
        };
    }
}
class BulkheadRejectedError extends Error {
    code = "BULKHEAD_REJECTED";
    value: { name: string; maxConcurrent: number; waitLength: number };
    constructor(name: string, maxConcurrent: number, waitLength: number) {
        const message = "Bulkhead is full";
        super(message);
        this.value = { name, maxConcurrent, waitLength };
    }
}
class BulkheadTimeoutError extends Error {
    code: string = "BULKHEAD_TIMED_OUT";
    value: { name: string; timeout: number };
    constructor(name: string, timeout: number) {
        const message = "Bulkhead timed out";
        super(message);
        this.value = { name, timeout };
    }
}

export class BulkheadRegistry {
    #bulheads: Map<string, Bulkhead> = new Map();
    register(name: string, config: BulkheadOptions) {
        if (this.#bulheads.has(name)) {
            throw new Error("ERR_BULKHEAD_ALREADY_REGISTERED");
        }
        const bulkhead = new Bulkhead(name, config);
        bulkhead.connect();
        this.#bulheads.set(name, bulkhead);
        return bulkhead;
    }
    get(name: string) {
        if (!this.#bulheads.has(name)) {
            throw new Error("ERR_BULKHEAD_NOT_REGISTERED");
        }
        return this.#bulheads.get(name);
    }
    getAllMetrics() {
        const metrics: Record<string, object> = {};
        for (const [name, bulkhead] of this.#bulheads) {
            metrics[name] = bulkhead.getMetrics();
        }
        return metrics;
    }
    reset() {
        for (const [name, bulkhead] of this.#bulheads) {
            bulkhead.close();
        }
        this.#bulheads.clear();
    }
}
