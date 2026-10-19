export class ProviderError extends Error {
    code: string = "PROVIDER_ERROR";
    constructor(response: Response) {
        const message: string = response.statusText;
        super(message, { cause: response });
    }
}
