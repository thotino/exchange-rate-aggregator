export class BulkheadTimeoutError extends Error {
    code: string = "BULKHEAD_TIMED_OUT";
    value: { name: string; timeout: number };
    constructor(name: string, timeout: number) {
        const message = "Bulkhead timed out";
        super(message);
        this.value = { name, timeout };
    }
}