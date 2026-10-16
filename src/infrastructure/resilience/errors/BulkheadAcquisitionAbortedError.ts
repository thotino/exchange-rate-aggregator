export class BulkheadAcquisitionAbortedError extends Error {
    readonly code: string = "BULKHEAD_ACQUISITION_ABORTED";
    /**
     *
     */
    constructor() {
        const message: string = "Bulkhead acquisition aborted";
        super(message);
    }
}