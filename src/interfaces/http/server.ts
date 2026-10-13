import { createServer, type Server, type ServerResponse } from "node:http";
import { ExchangeRate } from "../../infrastructure/providers/ExchangeRate";
import { type RateServerConfig, SimulationModes } from "../types";

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
    response.writeHead(statusCode, {
        "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify(body));
}

export function createRateServer(config: RateServerConfig): Server {
    return createServer((request, response) => {
        const pathname = new URL(request.url ?? "/", "http://localhost")
            .pathname;
        const routeMatch = /^\/rates\/([^/]+)\/([^/]+)$/.exec(pathname);

        if (!routeMatch) {
            sendJson(response, 404, { error: "Route not found" });
            return;
        }

        if (request.method !== "GET") {
            response.setHeader("allow", "GET");
            sendJson(response, 405, { error: "Method not allowed" });
            return;
        }

        const rate = ExchangeRate.generateExchangeRate(
            routeMatch[1],
            routeMatch[2],
        );

        if (rate == null) {
            sendJson(response, 400, {
                error: "Currency codes must contain three ASCII letters",
            });
            return;
        }

        switch (config.simulationMode) {
            case SimulationModes.NORMAL:
                sendJson(response, 200, { rate });
                return;
            case SimulationModes.SLOW: {
                const timer = setTimeout(
                    () => sendJson(response, 200, { rate }),
                    config.simulationDelayMs,
                );
                response.once("close", () => clearTimeout(timer));
                return;
            }
            case SimulationModes.HTTP_500:
                sendJson(response, 500, {
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
    });
}
