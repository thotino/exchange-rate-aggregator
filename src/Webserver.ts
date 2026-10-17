import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { ForeignExchangeRate } from "./application/ForeignExchangeRate";
import { Currencies } from "./interfaces/types";
import config from "./config";
import {
    RateLimiter,
    RateLimiterAlgorithms,
} from "./infrastructure/resilience/RateLimiter";

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
    response.writeHead(statusCode, {
        "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify(body));
}
class WebserverError extends Error {
    statusCode: number = 500;
    code: string = "ERR_UNEXPECTED_ERROR";
    /**
     *
     */
    constructor(cause: unknown) {
        const message = "An unexpected error occured";
        super(message, { cause });
        this.code = cause.code ?? "ERR_UNEXPECTED_ERROR"
    }
}
export class Webserver {
    #server: Server;
    #rateLimiter: RateLimiter;

    constructor(private readonly exchangeRate: ForeignExchangeRate) {
        this.#server = createServer((request, response) => {
            void this.#handleRequest(request, response);
        });
        this.#rateLimiter = new RateLimiter(
            RateLimiterAlgorithms.SLIDING_WINDOW,
        );
    }

    async start(): Promise<number> {
        this.#rateLimiter.connect();
        await new Promise<void>((resolve, reject) => {
            const onError = (error: Error) => {
                this.#server.off("listening", onListening);
                reject(error);
            };
            const onListening = () => {
                this.#server.off("error", onError);
                resolve();
            };

            this.#server.once("error", onError);
            this.#server.once("listening", onListening);
            this.#server.listen(config.webserver.port, config.webserver.host);
        });

        const address = this.#server.address() as AddressInfo;
        return address.port;
    }

    async stop(): Promise<void> {
        this.#rateLimiter.close();
        if (!this.#server.listening) {
            return;
        }

        await new Promise<void>((resolve, reject) => {
            this.#server.close(error => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
    }

    async #handleRequest(
        request: import("node:http").IncomingMessage,
        response: ServerResponse,
    ) {
        const pathname = new URL(request.url ?? "/", "http://localhost")
            .pathname;
        const routeMatch = /^\/rates\/([^/]+)\/([^/]+)$/.exec(pathname);

        if (null == routeMatch) {
            sendJson(response, 404, { error: "Route not found" });
            return;
        }

        if (request.method !== "GET") {
            response.setHeader("allow", "GET");
            sendJson(response, 405, { error: "Method not allowed" });
            return;
        }
        const ip = request.socket.remoteAddress;
        if (ip == null) {
            sendJson(response, 400, { error: "Unabe to identify user" });
            return;
        }
        const limiterOutcome = this.#rateLimiter.attempt(ip);
        const headers = new Headers({
            "X-RateLimit-Limit": `${this.#rateLimiter.maxRequests}`,
            "X-RateLimit-Remaining": `${limiterOutcome.remaining}`,
        });
        response.setHeaders(headers);
        if (!limiterOutcome.allowed) {
            if (limiterOutcome.retryAfter != null) {
                response.setHeader("Retry-After", limiterOutcome.retryAfter);
            }
            sendJson(response, 429, {
                error: "Too many requests",
            });
            return;
        }

        const sourceCurrency = Webserver.#toCurrency(routeMatch[1]);
        const destCurrency = Webserver.#toCurrency(routeMatch[2]);
        if (sourceCurrency == null || destCurrency == null) {
            sendJson(response, 400, { error: "Unsupported currency code" });
            return;
        }

        try {
            const result = await this.exchangeRate.get(
                sourceCurrency,
                destCurrency,
            );
            sendJson(response, 200, result);
        } catch (error) {
            const webserverError = new WebserverError(error);
            console.error({ webserverError });
            sendJson(response, webserverError.statusCode, {
                message: webserverError.message,
                code: webserverError.code,
                statusCode: webserverError.statusCode,
            });
        }
    }

    static #toCurrency(value: string) {
        const normalized = value.toLowerCase();
        return Object.values(Currencies).find(
            currency => currency === normalized,
        );
    }
}
