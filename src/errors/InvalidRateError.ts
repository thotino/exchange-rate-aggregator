export class InvalidRateError extends Error {
    /**
     *
     */
    code: string = "ERR_INVALID_RATE_VALUE"
    constructor() {
        super();
        
    }
}