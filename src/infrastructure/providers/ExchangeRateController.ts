import type { IncomingMessage, ServerResponse } from "http";
import type { config } from "process";
import { Currencies, SimulationModes } from "../../interfaces/types";
import { ExchangeRate } from "./ExchangeRate";

export class ExchangeRateController {
    static #toCurrency(value: string) {
        const normalized = value.toLowerCase();
        return Object.values(Currencies).find(
            currency => currency === normalized,
        );
    }
    static #sendJson(
        response: ServerResponse,
        statusCode: number,
        body: unknown,
    ) {
        response.writeHead(statusCode, {
            "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(body));
    }
    static generateExchangeRate(
        request: IncomingMessage,
        response: ServerResponse,
    ) {
        const pathname = new URL(request.url ?? "/", "http://localhost")
            .pathname;
        const routeMatch = /^\/rates\/([^/]+)\/([^/]+)$/.exec(pathname);

        if (!routeMatch) {
            ExchangeRateController.#sendJson(response, 404, {
                error: "Route not found",
            });
            return;
        }

        if (request.method !== "GET") {
            response.setHeader("allow", "GET");
            ExchangeRateController.#sendJson(response, 405, {
                error: "Method not allowed",
            });
            return;
        }
        const sourceCurrency = ExchangeRateController.#toCurrency(routeMatch[1])
        const targetCurrency = ExchangeRateController.#toCurrency(routeMatch[2])
        if (sourceCurrency == null || targetCurrency == null) {
            return ExchangeRateController.#sendJson(response, 400, {"Unsupported currency code"})
        }
        const rate = ExchangeRate.generateExchangeRate(
            sourceCurrency,
            targetCurrency,
        );

        if (rate == null) {
            ExchangeRateController.#sendJson(response, 400, {
                error: "Currency codes must contain three ASCII letters",
            });
            return;
        }

        switch (config.simulationMode) {
            case SimulationModes.NORMAL:
                ExchangeRateController.#sendJson(response, 200, { rate });
                return;
            case SimulationModes.SLOW: {
                const timer = setTimeout(
                    () =>
                        ExchangeRateController.#sendJson(response, 200, {
                            rate,
                        }),
                    config.simulationDelayMs,
                );
                response.once("close", () => clearTimeout(timer));
                return;
            }
            case SimulationModes.HTTP_500:
                ExchangeRateController.#sendJson(response, 500, {
                    error: "Simulated provider failure",
                });
                return;
            case SimulationModes.UNAVAILABLE:
                response.destroy();
                return;
            case SimulationModes.TIMEOUT:
                return;
            case SimulationModes.INVALID:
                response.writeHead(200, {
                    "content-type": "application/json; charset=utf-8",
                });
                response.end("{invalid json");
                return;
        }
    }
}
