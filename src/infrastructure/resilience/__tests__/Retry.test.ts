import { afterEach, describe, expect, it, vi } from "vitest";
import { InvalidRetryOptionError } from "../errors/InvalidRetryOptionError";
import { ResilienceError } from "../errors/ResilienceError";
import { JitterStatuses } from "../constants";
import type { RetryOptions } from "../types";
import { Retry } from "../Retry";

const defaultOptions: RetryOptions = {
    maxAttempts: 3,
    initialDelay: 1,
    maxDelay: 100,
    factor: 2,
    jitter: JitterStatuses.NONE,
    timeout: 100,
    retryableErrors: [],
    retryableStatusCodes: [],
};

function createRetry(options: Partial<RetryOptions> = {}) {
    return new Retry({ ...defaultOptions, ...options });
}

function retryableError(message: string) {
    return new Error(message, { cause: { code: "ECONNRESET" } });
}

describe("Retry", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it.each([
        { option: "maxAttempts", value: 0 },
        { option: "maxAttempts", value: 1.5 },
        { option: "initialDelay", value: 0 },
        { option: "maxDelay", value: 0 },
        { option: "factor", value: 0 },
        { option: "timeout", value: 0 },
    ])("rejects invalid options ($option)", ({ option, value }) => {
        expect(() => createRetry({ [option]: value })).toThrow(
            InvalidRetryOptionError,
        );
        expect(() => createRetry({ [option]: value })).toThrow(
            "One or several options are invalid",
        );
    });

    it("returns the first successful result without retrying", async () => {
        const retry = createRetry();
        const operation = vi.fn(async () => "ok");

        await expect(
            retry.execute(operation, {
                cancelSignal: new AbortController().signal,
            }),
        ).resolves.toBe("ok");
        expect(operation).toHaveBeenCalledTimes(1);
    });

    it("retries once after a transient error and then succeeds", async () => {
        vi.useFakeTimers();
        const retry = createRetry();
        const operation = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce(retryableError("temporary failure"))
            .mockResolvedValueOnce("ok");

        const execution = retry.execute(operation, {
            cancelSignal: new AbortController().signal,
        });
        await vi.advanceTimersByTimeAsync(10);

        await expect(execution).resolves.toBe("ok");
        expect(operation).toHaveBeenCalledTimes(2);
    });

    it("wraps a non-retryable error and stops immediately", async () => {
        const retry = createRetry();
        const error = new Error("invalid request");
        const operation = vi.fn(async () => {
            throw error;
        });

        await expect(
            retry.execute(operation, {
                cancelSignal: new AbortController().signal,
            }),
        ).rejects.toMatchObject({
            message: "invalid request",
            isRetryable: false,
            isCircuitBreakerFailure: false,
        });
        expect(operation).toHaveBeenCalledTimes(1);
    });

    it("propagates the last classified error when all attempts fail", async () => {
        vi.useFakeTimers();
        const retry = createRetry({ maxAttempts: 3 });
        const lastError = retryableError("third failure");
        const operation = vi
            .fn<() => Promise<never>>()
            .mockRejectedValueOnce(retryableError("first failure"))
            .mockRejectedValueOnce(retryableError("second failure"))
            .mockRejectedValueOnce(lastError);

        const execution = retry.execute(operation, {
            cancelSignal: new AbortController().signal,
        });
        await vi.advanceTimersByTimeAsync(10);

        await expect(execution).rejects.toMatchObject({
            message: "third failure",
            isRetryable: true,
            isCircuitBreakerFailure: true,
            cause: lastError.cause,
        });
        expect(operation).toHaveBeenCalledTimes(3);
    });

    it("classifies a local timeout as a non-retryable ResilienceError", async () => {
        vi.useFakeTimers();
        const retry = createRetry({ timeout: 10 });
        const operation = vi.fn(
            ({ signal }: { signal: AbortSignal }) =>
                new Promise<never>((_resolve, reject) => {
                    signal.addEventListener(
                        "abort",
                        () => reject(signal.reason),
                        { once: true },
                    );
                }),
        );

        const execution = retry.execute(operation, {
            cancelSignal: new AbortController().signal,
        });
        const rejection = execution.catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(10);

        const error = await rejection;
        expect(error).toBeInstanceOf(ResilienceError);
        expect(error).toMatchObject({
            isRetryable: false,
            isCircuitBreakerFailure: false,
        });
        expect(operation).toHaveBeenCalledTimes(1);
    });

    it("does not start another attempt when cancellation occurs during backoff", async () => {
        vi.useFakeTimers();
        const retry = createRetry({ initialDelay: 50 });
        const cancelController = new AbortController();
        const operation = vi
            .fn<() => Promise<never>>()
            .mockRejectedValue(retryableError("temporary failure"));

        const execution = retry.execute(operation, {
            cancelSignal: cancelController.signal,
        });
        await Promise.resolve();
        await Promise.resolve();
        cancelController.abort();

        await expect(execution).rejects.toMatchObject({ name: "AbortError" });
        expect(operation).toHaveBeenCalledTimes(1);
    });

    it("uses the configured backoff when classification drops the Retry-After header", async () => {
        vi.useFakeTimers();
        const retry = createRetry({ maxDelay: 500 });
        const error = Object.assign(
            retryableError("service unavailable"),
            {
                response: {
                    status: 503,
                    headers: new Headers({ "retry-after": "1" }),
                },
            },
        );
        const operation = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce(error)
            .mockResolvedValueOnce("ok");

        const execution = retry.execute(operation, {
            cancelSignal: new AbortController().signal,
        });
        await vi.advanceTimersByTimeAsync(10);

        await expect(execution).resolves.toBe("ok");
        expect(operation).toHaveBeenCalledTimes(2);
    });
});