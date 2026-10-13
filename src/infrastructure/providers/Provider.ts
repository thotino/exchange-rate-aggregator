import { createRateServer } from "../../interfaces/http/server";
import { type RateServerConfig } from "../../interfaces/types";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

export class Provider {
    #config: RateServerConfig;
    #server: Server<typeof IncomingMessage, typeof ServerResponse>;
    constructor(serverConfig: RateServerConfig) {
        this.#config = serverConfig;
        this.#server = createRateServer(this.#config);
    }
    async start() {
        this.#server.on("error", (error: Error) => {
            console.error("Rate simulator server error:", error.message);
        });

        this.#server.listen(this.#config.port, this.#config.host, () => {
            const address = this.#server.address();
            if (address != null && typeof address !== "string") {
                console.log(
                    `Rate simulator listening on http://${this.#config.host}:${address.port} (${this.#config.simulationMode})`,
                );
            }
        });
    }
    async stop() {
        await this.#server.close();
        await this.#server.closeAllConnections();
    }
}
