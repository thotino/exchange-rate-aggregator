interface BulkheadOptions {
    readonly maxConcurrent: number;
    readonly maxWaiting: number;
    readonly timeoutMS: number;
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
    #metrics: {
        acquired: number;
        rejected: number;
        timedOut: number;
        completed: number;
        failed: number;
    } = { acquired: 0, rejected: 0, timedOut: 0, completed: 0, failed: 0 };
    constructor(name: string, config: BulkheadOptions = {}) {
        this.#name = name;
    }

    async #acquire() {
        if (this.#permits > 0) {
            this.#permits--;
            this.#metrics.acquired++;
            return;
        }
        if (this.#waitQueue.length >= this.#maxWaiting) {
            this.#metrics.rejected++;
            throw new BulkheadRejectedError();
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
                reject(new BulkheadTimeoutError());
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
    constructor() {
        super();
    }
}
class BulkheadTimeoutError extends Error {
    constructor() {
        super();
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
        return this.#bulheads.get(name)!;
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
