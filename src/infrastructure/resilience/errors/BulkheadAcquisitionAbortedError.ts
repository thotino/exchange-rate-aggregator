import type { ResilienceErrorInterface } from "../types";

export class BulkheadAcquisitionAbortedError
    extends Error
    implements ResilienceErrorInterface
{
    readonly code: string = "BULKHEAD_ACQUISITION_ABORTED";
    readonly isRetryable: boolean = false;
    readonly isCircuitBreakerFailure: boolean = false;
    constructor(cause: unknown) {
        const message: string = "Bulkhead acquisition aborted";
        super(message, { cause });
    }
}
