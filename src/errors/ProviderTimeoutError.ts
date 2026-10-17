export class ProviderTimeoutError extends Error {
    readonly code: string = "PROVIDER_TIMEOUT";
    constructor(response: Response) {
        const message: string = response.statusText;
        super(message, { cause: response });
    }
}
