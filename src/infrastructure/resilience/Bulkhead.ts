/**
 * @see https://oneuptime.com/blog/post/2026-01-24-bulkhead-pattern-nodejs/view
 */

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
export class Bulkhead {
    #name: string;
    #maxConcurrent: number = 10;
    #permits: number = 1;
    #maxWaiting: number = 20;
    #timeoutMS: number = 10_000;
    #waitQueue: {
        resolve: () => void;
        reject: (error: Error) => void;
        timer: NodeJS.Timeout;
    }[] = [];
    #metrics: BulkheadMetrics = {
        acquired: 0,
        rejected: 0,
        timedOut: 0,
        completed: 0,
        failed: 0,
    };
    constructor(
        name: string,
        config: BulkheadOptions = {
            maxConcurrent: 10,
            maxWaiting: 20,
            timeoutMS: 10_000,
        },
    ) {
        this.#name = name;
        this.#maxConcurrent = config.maxConcurrent ?? 10;
        this.#permits = config.maxConcurrent ?? 1;
        this.#maxWaiting = config.maxWaiting ?? 20;
        this.#timeoutMS = config.timeoutMS ?? 10_000;
    }

    async #acquire() {
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
            const timer = setTimeout(() => {
                const index = this.#waitQueue.findIndex(
                    wait => wait.timer === timer,
                );
                if (index !== -1) {
                    this.#waitQueue.splice(index, 1);
                }
                this.#metrics.timedOut++;
                reject(new BulkheadTimeoutError(this.#name, this.#timeoutMS));
            }, this.#timeoutMS);
            this.#waitQueue.push({ resolve, reject, timer });
        });
    }
    #release(success: boolean = true) {
        if (success) {
            this.#metrics.completed++;
        } else {
            this.#metrics.failed++;
        }
        if (this.#waitQueue.length > 0) {
            const next = this.#waitQueue.shift()!;
            clearTimeout(next.timer);
            this.#metrics.acquired++;
            next.resolve();
        } else {
            this.#permits++;
        }
    }
    async execute<T>(fn: () => Promise<T>) {
        await this.#acquire();
        let success = true;
        try {
            return await fn();
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
        this.#bulheads.clear();
    }
}
