export class CustomTimeoutError extends Error {
    readonly code: string = "ETIMEDOUT";
    constructor() {
        super();
    }
}
