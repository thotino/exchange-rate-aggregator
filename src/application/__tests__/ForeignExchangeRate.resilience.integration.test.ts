import { afterEach, describe, expect, it, vi } from "vitest";
import { Currencies, Providers } from "../../interfaces/types";
import { PerAttemptResilientClient } from "../../infrastructure/resilience/ResilientClient";
import { JitterStatuses } from "../../infrastructure/resilience/constants";

const PROVIDER_A_URL = "http://provider-a.test";
const PROVIDER_B_URL = "http://provider-b.test";

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status });
}

function rateResponse(rate: unknown, status = 200) {
    return jsonResponse({ rate, pair: "EUR/USD", asOf: Date.now() }, status);
}

function countCallsTo(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, baseUrl: string) {
    return fetchMock.mock.calls.filter(([input]) =>
        String(input).startsWith(baseUrl),
    ).length;
}

async function loadApplication(fetchMock: typeof fetch) {
    // ForeignExchangeRate owns a module-level cache. A fresh module graph keeps
    // each scenario independent without adding test-only cache APIs.
    vi.resetModules();
    vi.stubGlobal("fetch", fetchMock);
    const [{ ForeignExchangeRate }, { ProviderA }, { ProviderB }] =
        await Promise.all([
            import("../ForeignExchangeRate"),
            import("../../connectors/ProviderA"),
            import("../../connectors/ProviderB"),
        ]);
    return { ForeignExchangeRate, ProviderA, ProviderB };
}

type TestClientConfig = ConstructorParameters<
    typeof PerAttemptResilientClient
>[0];

function resilientClientConfig(
    overrides: Partial<TestClientConfig> = {},
): TestClientConfig {
    return {
        retryOptions: {
            maxAttempts: 1,
            initialDelay: 1,
            maxDelay: 10,
            factor: 1,
            jitter: JitterStatuses.NONE,
            timeout: 1_000,
            retryableErrors: [],
            retryableStatusCodes: [],
        },
        bulkheadOptions: {
            name: "provider-a-test",
            maxConcurrent: 1,
            maxWaiting: 1,
            timeoutMS: 1_000,
        },
        circuitBreakerOptions: {
            failureThreshold: 5,
            resetTimeout: 100,
            halfOpenRequests: 1,
        },
        ...overrides,
    };
}

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("ForeignExchangeRate resilience integration", () => {
    it("1. returns the rate from provider A when A responds normally", async () => {
        const fetchMock = vi.fn<typeof fetch>().mockImplementation(async input =>
            String(input).startsWith(PROVIDER_A_URL)
                ? rateResponse(1.234)
                : rateResponse(9.876),
        );
        const { ForeignExchangeRate, ProviderA, ProviderB } =
            await loadApplication(fetchMock);
        const exchange = new ForeignExchangeRate(
            new ProviderA(PROVIDER_A_URL),
            new ProviderB(PROVIDER_B_URL),
        );

        const result = await exchange.get(Currencies.EUR, Currencies.USD);

        expect(result).toMatchObject({
            provider: Providers.PROVIDER_A,
            rate: 1.234,
        });
        expect(countCallsTo(fetchMock, PROVIDER_A_URL)).toBe(1);
        expect(countCallsTo(fetchMock, PROVIDER_B_URL)).toBe(0);
    });

    it("2. retries a temporary provider-A failure and returns A's recovered rate", async () => {
        let attempts = 0;
        const fetchMock = vi.fn<typeof fetch>().mockImplementation(async input => {
            if (String(input).startsWith(PROVIDER_A_URL)) {
                attempts++;
                return attempts === 1
                    ? jsonResponse({ error: "temporary" }, 503)
                    : rateResponse(1.75);
            }
            return rateResponse(8.25);
        });
        const { ForeignExchangeRate, ProviderA, ProviderB } =
            await loadApplication(fetchMock);
        const exchange = new ForeignExchangeRate(
            new ProviderA(PROVIDER_A_URL),
            new ProviderB(PROVIDER_B_URL),
        );

        const result = await exchange.get(Currencies.EUR, Currencies.GBP);

        expect(result).toMatchObject({
            provider: Providers.PROVIDER_A,
            rate: 1.75,
        });
        expect(countCallsTo(fetchMock, PROVIDER_A_URL)).toBe(2);
        expect(countCallsTo(fetchMock, PROVIDER_B_URL)).toBe(0);
    });

    it("3. aborts a timed-out attempt and releases its bulkhead permit for reuse", async () => {
        const client = new PerAttemptResilientClient(
            resilientClientConfig({
                retryOptions: {
                    maxAttempts: 1,
                    initialDelay: 1,
                    maxDelay: 10,
                    factor: 1,
                    jitter: JitterStatuses.NONE,
                    timeout: 15,
                    retryableErrors: [],
                    retryableStatusCodes: [],
                },
            }),
        );
        let attemptSignal: AbortSignal | undefined;
        const timedOperation = vi.fn(
            ({ signal }: { signal: AbortSignal }) =>
                new Promise<never>((_resolve, reject) => {
                    attemptSignal = signal;
                    signal.addEventListener(
                        "abort",
                        () => reject(signal.reason),
                        { once: true },
                    );
                }),
        );

        await expect(
            client.execute("timeout", timedOperation, {
                cancelSignal: new AbortController().signal,
            }),
        ).rejects.toThrow();

        expect(timedOperation).toHaveBeenCalledOnce();
        expect(attemptSignal?.aborted).toBe(true);
        expect(client.bulkhead.getMetrics()).toMatchObject({
            availablePermits: 10,
            failed: 1,
        });

        const nextOperation = vi.fn(async () => "permit reused");
        await expect(
            client.execute("after-timeout", nextOperation, {
                cancelSignal: new AbortController().signal,
            }),
        ).resolves.toBe("permit reused");
        expect(nextOperation).toHaveBeenCalledOnce();
        expect(client.bulkhead.getMetrics().availablePermits).toBe(10);
    });

    it("4. opens provider A's circuit after its retry attempts accumulate failures", async () => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
            jsonResponse({ error: "down" }, 503),
        );
        const { ProviderA } = await loadApplication(fetchMock);
        const providerA = new ProviderA(PROVIDER_A_URL);
        const options = { cancelSignal: new AbortController().signal };

        await expect(
            providerA.getRates(Currencies.USD, Currencies.EUR, options),
        ).rejects.toThrow();
        expect(countCallsTo(fetchMock, PROVIDER_A_URL)).toBe(3);

        await expect(
            providerA.getRates(Currencies.USD, Currencies.EUR, options),
        ).rejects.toThrow();
        expect(countCallsTo(fetchMock, PROVIDER_A_URL)).toBe(3);
    });

    it("5. does not call provider A again while its circuit remains open", async () => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
            jsonResponse({ error: "down" }, 503),
        );
        const { ProviderA } = await loadApplication(fetchMock);
        const providerA = new ProviderA(PROVIDER_A_URL);
        const options = { cancelSignal: new AbortController().signal };

        await expect(
            providerA.getRates(Currencies.USD, Currencies.GBP, options),
        ).rejects.toThrow();
        const callsAtOpen = countCallsTo(fetchMock, PROVIDER_A_URL);
        await expect(
            providerA.getRates(Currencies.USD, Currencies.GBP, options),
        ).rejects.toThrow();

        expect(callsAtOpen).toBe(3);
        expect(countCallsTo(fetchMock, PROVIDER_A_URL)).toBe(callsAtOpen);
    });

    it("6. falls back to B when A is unavailable", async () => {
        const fetchMock = vi.fn<typeof fetch>().mockImplementation(async input => {
            if (String(input).startsWith(PROVIDER_A_URL)) {
                throw new TypeError("provider A unavailable");
            }
            return rateResponse(2.5);
        });
        const { ForeignExchangeRate, ProviderA, ProviderB } =
            await loadApplication(fetchMock);
        const exchange = new ForeignExchangeRate(
            new ProviderA(PROVIDER_A_URL),
            new ProviderB(PROVIDER_B_URL),
        );

        const result = await exchange.get(Currencies.GBP, Currencies.USD);

        expect(result).toMatchObject({
            rate: 2.5,
        });
        expect(countCallsTo(fetchMock, PROVIDER_A_URL)).toBe(1);
        expect(countCallsTo(fetchMock, PROVIDER_B_URL)).toBe(1);
    });

    it("7. serves the cached rate without calling either provider when both are down", async () => {
        let providerDown = false;
        const fetchMock = vi.fn<typeof fetch>().mockImplementation(async input => {
            if (providerDown) throw new TypeError("provider unavailable");
            return String(input).startsWith(PROVIDER_A_URL)
                ? rateResponse(3.125)
                : rateResponse(7.875);
        });
        const { ForeignExchangeRate, ProviderA, ProviderB } =
            await loadApplication(fetchMock);
        const exchange = new ForeignExchangeRate(
            new ProviderA(PROVIDER_A_URL),
            new ProviderB(PROVIDER_B_URL),
        );
        const initial = await exchange.get(Currencies.GBP, Currencies.EUR);
        providerDown = true;
        fetchMock.mockClear();

        const cached = await exchange.get(Currencies.GBP, Currencies.EUR);

        expect(initial).toMatchObject({
            provider: Providers.PROVIDER_A,
            rate: 3.125,
        });
        expect(cached).toMatchObject({
            provider: Providers.PROVIDER_A,
            rate: 3.125,
            source: "FRESH_CACHE",
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("8. currently serves stale cache instead of returning an explicit error when both providers are down", async () => {
        const fetchMock = vi.fn<typeof fetch>().mockImplementation(async input => {
            if (providerDown) throw new TypeError("provider unavailable");
            return String(input).startsWith(PROVIDER_A_URL)
                ? rateResponse(4.125)
                : rateResponse(6.875);
        });
        let providerDown = false;
        const { ForeignExchangeRate, ProviderA, ProviderB } =
            await loadApplication(fetchMock);
        const exchange = new ForeignExchangeRate(
            new ProviderA(PROVIDER_A_URL),
            new ProviderB(PROVIDER_B_URL),
        );
        await exchange.get(Currencies.GBP, Currencies.USD);
        providerDown = true;
        fetchMock.mockClear();
        const cacheClock = performance.now();
        vi.spyOn(performance, "now").mockReturnValue(cacheClock + 5 * 60 * 1000 + 1);

        await expect(
            exchange.get(Currencies.GBP, Currencies.USD),
        ).resolves.toMatchObject({
            provider: Providers.PROVIDER_A,
            rate: 4.125,
            source: "STALE_CACHE",
        });
        await vi.waitFor(() => {
            expect(countCallsTo(fetchMock, PROVIDER_A_URL)).toBe(1);
            expect(countCallsTo(fetchMock, PROVIDER_B_URL)).toBe(1);
        });
    });

    it("9. redirects to B when provider A's bulkhead is saturated", async () => {
        let releaseProviderA!: (response: Response) => void;
        const providerAResponse = new Promise<Response>(resolve => {
            releaseProviderA = resolve;
        });
        const fetchMock = vi.fn<typeof fetch>().mockImplementation(input =>
            String(input).startsWith(PROVIDER_A_URL)
                ? providerAResponse
                : Promise.resolve(rateResponse(5.5)),
        );
        const { ForeignExchangeRate, ProviderA, ProviderB } =
            await loadApplication(fetchMock);
        const exchange = new ForeignExchangeRate(
            new ProviderA(PROVIDER_A_URL),
            new ProviderB(PROVIDER_B_URL),
        );
        const pairs = Array.from({ length: 31 }, (_, index) => [
            `source-${index}`,
            `target-${index}`,
        ] as const);
        const firstThirty = pairs.slice(0, 30).map(([from, to]) =>
            exchange.get(from as Currencies, to as Currencies),
        );

        await vi.waitFor(() => {
            expect(countCallsTo(fetchMock, PROVIDER_A_URL)).toBe(10);
        });
        const overflow = exchange.get(
            pairs[30][0] as Currencies,
            pairs[30][1] as Currencies,
        );

        await expect(overflow).resolves.toMatchObject({
            rate: 5.5,
        });
        expect(countCallsTo(fetchMock, PROVIDER_A_URL)).toBe(10);
        expect(countCallsTo(fetchMock, PROVIDER_B_URL)).toBe(1);

        releaseProviderA(rateResponse(1.5));
        await expect(Promise.all(firstThirty)).resolves.toHaveLength(30);
        expect(countCallsTo(fetchMock, PROVIDER_A_URL)).toBe(30);
    });

    it("10. rejects an invalid A response and applies the B fallback", async () => {
        const fetchMock = vi.fn<typeof fetch>().mockImplementation(async input =>
            String(input).startsWith(PROVIDER_A_URL)
                ? rateResponse("not-a-number")
                : rateResponse(6.25),
        );
        const { ForeignExchangeRate, ProviderA, ProviderB } =
            await loadApplication(fetchMock);
        const exchange = new ForeignExchangeRate(
            new ProviderA(PROVIDER_A_URL),
            new ProviderB(PROVIDER_B_URL),
        );

        const result = await exchange.get(Currencies.USD, Currencies.USD);

        expect(result).toMatchObject({
            rate: 6.25,
        });
        expect(countCallsTo(fetchMock, PROVIDER_A_URL)).toBe(1);
        expect(countCallsTo(fetchMock, PROVIDER_B_URL)).toBe(1);
    });

    it("11. probes A in half-open state after recovery and closes the circuit", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(10_000);
        const client = new PerAttemptResilientClient(
            resilientClientConfig({
                circuitBreakerOptions: {
                    failureThreshold: 1,
                    resetTimeout: 100,
                    halfOpenRequests: 1,
                },
            }),
        );
        const failure = new Error("provider A unavailable", {
            cause: { status: 503 },
        });
        const failedProbe = vi.fn(async () => {
            throw failure;
        });
        const cancelSignal = new AbortController().signal;

        await expect(
            client.execute("initial-failure", failedProbe, { cancelSignal }),
        ).rejects.toThrow();
        expect(client.circuitBreaker.getState().state).toBe("open");

        const whileOpen = vi.fn(async () => "must not run");
        await expect(
            client.execute("while-open", whileOpen, { cancelSignal }),
        ).rejects.toThrow();
        expect(whileOpen).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(101);
        const recoveryProbe = vi.fn(async () => "recovered");
        await expect(
            client.execute("recovery-probe", recoveryProbe, { cancelSignal }),
        ).resolves.toBe("recovered");
        expect(recoveryProbe).toHaveBeenCalledOnce();
        expect(client.circuitBreaker.getState().state).toBe("closed");
        expect(client.circuitBreaker.getState().failures).toBe(0);
    });
});
