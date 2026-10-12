/**
 * @see https://oneuptime.com/blog/post/2026-01-06-nodejs-retry-exponential-backoff/view
 */

const RETRYABLE_ERRORS = new Set([
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "EPIPE",
    "ENOTFOUND",
    "ENETUNREACH",
    "EAI_AGAIN",
]);
const RETRYABLE_STATUS_CODES = new Set<number>([408, 429, 500, 502, 503, 504]);
enum JitterStatuses {
    FULL = "full",
    EQUAL = "equal",
    NONE = "none",
    DECORRELATE = "decorrelate",
}
type HTTPError = Error & {
    code: string;
    response: {
        status: number;
        headers: Headers;
    };
};
interface RetryOptions {
    maxAttempts: number;
    initialDelay: number;
    maxDelay: number;
    factor: number;
    jitter: JitterStatuses;
    timeout: number;
}
export class Retry {
    #maxAttempts: number = 5;
    #initialDelay: number = 1000;
    #maxDelay: number = 30000;
    #factor: number = 2;
    #jitter: JitterStatuses = JitterStatuses.FULL;
    #timeout: number = 30000;
    constructor(
        options: RetryOptions = {
            maxAttempts: 3,
            initialDelay: 1000,
            maxDelay: 30_000,
            factor: 2,
            jitter: JitterStatuses.FULL,
            timeout: 30_000,
        },
    ) {
        this.#maxAttempts = options.maxAttempts;
        this.#initialDelay = options.initialDelay;
        this.#maxDelay = options.maxDelay;
        this.#factor = options.factor;
        this.#jitter = options.jitter;
        this.#timeout = options.timeout;
    }
    #getHeader(headers: Headers, name: string) {
        if (headers == null) return null;
        return headers.get(name) ?? null;
    }
    #getRetryAfter(error: HTTPError) {
        const retryAfter = this.#getHeader(
            error.response.headers,
            "retry-after",
        );
        if (retryAfter == null) return null;
        const seconds = Number(retryAfter);
        if (Number.isInteger(seconds) && seconds >= 0) {
            return seconds * 1000;
        }

        const date = new Date(retryAfter);
        if (!Number.isNaN(date.getTime())) {
            return Math.max(0, date.getTime() - Date.now());
        }
        return null;
    }
    #calculateDelay(attempt: number, error: HTTPError) {
        const retryAfter = this.#getRetryAfter(error);
        if (retryAfter !== null) {
            return Math.min(retryAfter, this.#maxDelay);
        }
        const delay: number = Math.min(
            this.#initialDelay * Math.pow(this.#factor, attempt - 1),
            this.#maxDelay,
        );
        if (this.#jitter === JitterStatuses.FULL) {
            return Math.random() * delay;
        }
        if (this.#jitter === JitterStatuses.EQUAL) {
            return delay / 2 + (Math.random() * delay) / 2;
        }
        return delay;
    }
    #isRetryable(error: HTTPError) {
        if (RETRYABLE_ERRORS.has(error.code)) {
            return true;
        }
        if (
            error.response &&
            RETRYABLE_STATUS_CODES.has(error.response.status)
        ) {
            return true;
        }
        if (this.#getHeader(error.response?.headers, "retry-after")) {
            return true;
        }
        return false;
    }
    async execute<T>(
        fn: (options: { attempt: number; signal: AbortSignal }) => Promise<T>,
    ) {
        let lastError: HTTPError;
        for (let attempt = 1; attempt <= this.#maxAttempts; attempt++) {
            const controller = new AbortController();
            try {
                const timeoutId = setTimeout(
                    () => controller.abort(),
                    this.#timeout,
                );
                try {
                    const result = await fn({
                        attempt,
                        signal: controller.signal,
                    });
                    clearTimeout(timeoutId);
                    return result;
                } finally {
                    clearTimeout(timeoutId);
                }
            } catch (error) {
                lastError = error;
                if (error.name === "AbortError") {
                    throw new Error("ERR_TIMED_OUT");
                }
                if (
                    attempt === this.#maxAttempts ||
                    !this.#isRetryable(error)
                ) {
                    throw error;
                }
                const delay = this.#calculateDelay(attempt, error);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        throw lastError;
    }
}
