export class ProviderUnavailableError extends Error {
    readonly status: string = "PROVIDER_UNAVAILABLE"
    code: number;
    response: Response;
    constructor(response: Response) {
        const message: string = response.statusText;
        super(message);
        this.response = response;
        this.code = response.status;
    }
}