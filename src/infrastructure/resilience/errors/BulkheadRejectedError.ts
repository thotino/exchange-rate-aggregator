export class BulkheadRejectedError extends Error {
    code = "BULKHEAD_REJECTED";
    value: { name: string; maxConcurrent: number; waitLength: number };
    constructor(name: string, maxConcurrent: number, waitLength: number) {
        const message = "Bulkhead is full";
        super(message);
        this.value = { name, maxConcurrent, waitLength };
    }
}