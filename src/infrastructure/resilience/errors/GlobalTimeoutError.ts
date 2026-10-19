import type { ResilienceErrorInterface } from "../types";
import { ResilienceError } from "./ResilienceError";

export class GlobalTimeoutError
    extends Error
    implements ResilienceErrorInterface
{
    readonly code: string = "ERR_OPERATION_TIMEOUT";
    isRetryable: boolean = false;
    isCircuitBreakerFailure: boolean = false;
    constructor() {
        super();
    }
}
