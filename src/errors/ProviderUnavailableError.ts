export class ProviderUnavailableError extends Error {
    readonly code: string = "PROVIDER_UNAVAILABLE";
    constructor(response: Response) {
        const message: string = response.statusText;
        super(message, { cause: response });
    }
}
