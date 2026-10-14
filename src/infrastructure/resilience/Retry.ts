/**
 * @see https://oneuptime.com/blog/post/2026-01-06-nodejs-retry-exponential-backoff/view
 */

import { CustomTimeoutError } from "./errors/CustomTimeoutError";
import { InvalidRetryOptionError } from "./errors/InvalidRetryOptionError";

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
    code?: string;
    response?: {
        status: number;
        headers?: Headers;
    };
};


export interface RetryOptions {
    maxAttempts: number;
    initialDelay: number;
    maxDelay: number;
    factor: number;
    jitter: JitterStatuses;
    timeout: number;
    retryableErrors: Set<string>;
    retryableStatusCodes: Set<number>;
}
const DEFAULT_OPTIONS: RetryOptions = {
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 30_000,
    factor: 2,
    jitter: JitterStatuses.FULL,
    timeout: 3_000,
    retryableErrors: new Set(),
    retryableStatusCodes: new Set<number>(),
};
export class Retry {
    #maxAttempts: number = 5;
    #initialDelay: number = 1000;
    #maxDelay: number = 30000;
    #factor: number = 2;
    #jitter: JitterStatuses = JitterStatuses.FULL;
    #timeout: number = 30000;
    #retryableErrors: Set<string> = RETRYABLE_ERRORS;
    #retryableStatusCodes: Set<number> = RETRYABLE_STATUS_CODES;
    constructor(options: Partial<RetryOptions>) {
        const resolvedOptions = { ...DEFAULT_OPTIONS, ...options };
        if (
            !Number.isInteger(resolvedOptions.maxAttempts) ||
            resolvedOptions.maxAttempts < 1 ||
            !Number.isFinite(resolvedOptions.factor) ||
            resolvedOptions.factor <= 0 ||
            !Number.isFinite(resolvedOptions.timeout) ||
            resolvedOptions.timeout <= 0 ||
            !Number.isFinite(resolvedOptions.initialDelay) ||
            resolvedOptions.initialDelay <= 0 ||
            !Number.isFinite(resolvedOptions.maxDelay) ||
            resolvedOptions.maxDelay <= 0
        ) {
            throw new InvalidRetryOptionError();
        }
        this.#maxAttempts = resolvedOptions.maxAttempts;
        this.#initialDelay = resolvedOptions.initialDelay;
        this.#maxDelay = resolvedOptions.maxDelay;
        this.#factor = resolvedOptions.factor;
        this.#jitter = resolvedOptions.jitter;
        this.#timeout = resolvedOptions.timeout;
        this.#retryableErrors = new Set([
            ...RETRYABLE_ERRORS,
            ...(options.retryableErrors ?? []),
        ]);
        this.#retryableStatusCodes = new Set([
            ...RETRYABLE_STATUS_CODES,
            ...(options.retryableStatusCodes ?? []),
        ]);
    }
    #getHeader(headers: Headers, name: string) {
        if (headers == null) return null;
        return headers.get(name) ?? null;
    }
    #getRetryAfter(error: HTTPError) {
        const headers = error.response?.headers;
        if (headers == null) {
            return null;
        }
        const retryAfter = this.#getHeader(headers, "retry-after");
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
    #calculateDelayWithJitter(
        baseDelay: number,
        prevDelay: number,
        attempt: number,
    ) {
        const delay = Math.min(
            baseDelay * Math.pow(this.#factor, attempt - 1),
            this.#maxDelay,
        );
        switch (this.#jitter) {
            case JitterStatuses.NONE:
                return delay;
            case JitterStatuses.FULL:
                return Math.random() * delay;
            case JitterStatuses.EQUAL:
                return delay / 2 + (Math.random() * delay) / 2;
            case JitterStatuses.DECORRELATE:
                const upperBound = Math.max(baseDelay, prevDelay * 3);
                return Math.min(
                    this.#maxDelay,
                    baseDelay + Math.random() * (upperBound - baseDelay),
                );
            default:
                return delay;
        }
    }
    #calculateDelay(
        initialDelay: number,
        prevDelay: number,
        attempt: number,
        error: HTTPError,
    ) {
        const retryAfter = this.#getRetryAfter(error);
        if (retryAfter != null) {
            if (retryAfter > this.#maxDelay) {
                return null;
            }
            return retryAfter;
        }
        return this.#calculateDelayWithJitter(initialDelay, prevDelay, attempt);
    }
    #isRetryable(error: HTTPError) {
        if (error.code != null && this.#retryableErrors.has(error.code)) {
            return true;
        }
        if (
            error.response != null &&
            this.#retryableStatusCodes.has(error.response.status)
        ) {
            return true;
        }
        if (
            error.response?.status === 503 &&
            error.response?.headers != null &&
            this.#getHeader(error.response?.headers, "retry-after")
        ) {
            return true;
        }
        return false;
    }
    async execute<T>(fn: (options: { signal: AbortSignal }) => Promise<T>) {
        let lastError;
        let prevDelay = this.#initialDelay;
        for (let attempt = 1; attempt <= this.#maxAttempts; attempt++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(new CustomTimeoutError()), this.#timeout);
            try {
                try {
                    return await fn({ signal: controller.signal });
                } finally {
                    clearTimeout(timer);
                }
            } catch (err) {
                let error = Retry.#ensureError(err);
                lastError = error;
                if (
                    attempt === this.#maxAttempts ||
                    !this.#isRetryable(error)
                ) {
                    throw error;
                }
                const delay = this.#calculateDelay(
                    this.#initialDelay,
                    prevDelay,
                    attempt,
                    error,
                );
                if (delay == null) {
                    throw error;
                }
                prevDelay = delay;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        throw lastError;
    }
    static #ensureError(value: unknown) {
        if (value instanceof Error) return value;
        let stringifiedValue = "";
        try {
            stringifiedValue = JSON.stringify(value);
        } catch (error) {}
        const error = new Error(stringifiedValue);
        return error;
    }
}
