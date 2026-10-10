import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { GetExchangeRate } from "./application/GetExchangeRate.js";
import { Currencies } from "./interfaces/types.js";
import config from "./config.js";

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
    response.writeHead(statusCode, {
        "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify(body));
}

export class Webserver {
    #server: Server;

    constructor(private readonly getExchangeRate: GetExchangeRate) {
        this.#server = createServer((request, response) => {
            void this.#handleRequest(request, response);
        });
    }

    async start(): Promise<number> {
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

        if (!routeMatch) {
            sendJson(response, 404, { error: "Route not found" });
            return;
        }

        if (request.method !== "GET") {
            response.setHeader("allow", "GET");
            sendJson(response, 405, { error: "Method not allowed" });
            return;
        }

        const sourceCurrency = Webserver.#toCurrency(routeMatch[1]);
        const destCurrency = Webserver.#toCurrency(routeMatch[2]);
        if (!sourceCurrency || !destCurrency) {
            sendJson(response, 400, { error: "Unsupported currency code" });
            return;
        }

        try {
            const result = await this.getExchangeRate.get(
                sourceCurrency,
                destCurrency,
            );
            sendJson(response, 200, result);
        } catch {
            sendJson(response, 502, { error: "Exchange rate unavailable" });
        }
    }

    static #toCurrency(value: string) {
        const normalized = value.toLowerCase();
        return Object.values(Currencies).find(
            currency => currency === normalized,
        );
    }
}
