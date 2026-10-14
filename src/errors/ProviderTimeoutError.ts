export class ProviderTimeoutError extends Error {
    readonly status: string = "PROVIDER_TIMEOUT";
    code: number;
    response: Response;
    constructor(response: Response) {
        const message: string = response.statusText;
        super(message);
        this.response = response;
        this.code = response.status;
    }
}
