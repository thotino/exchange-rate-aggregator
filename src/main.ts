import { ForeignExchangeRate } from "./application/ForeignExchangeRate.js";
import { ProviderA } from "./connectors/ProviderA";
import { ProviderB } from "./connectors/ProviderB";
import * as providers from "./infrastructure/providers";
import { Webserver } from "./Webserver";

const providerAConnector = new ProviderA("http://localhost:3001");
const providerBConnector = new ProviderB("http://localhost:3002");

const exchangeRateGetter = new ForeignExchangeRate(
    providerAConnector,
    providerBConnector,
);
const webserver = new Webserver(exchangeRateGetter);
async function main() {
    for (const connector of Object.values(providers)) {
        await connector.start();
    }
    await providerAConnector.connect();
    await providerBConnector.connect();
    await webserver.start();
}
async function onFinishEvent(error: Error | null) {
    if (Error.isError(error)) {
        console.error(error);
    }
    await providerAConnector.close();
    await providerBConnector.close();
    await webserver.stop();
    for (const connector of Object.values(providers)) {
        await connector.stop();
    }
}
if (process.argv[1] === import.meta.filename) {
    main().catch(onFinishEvent);
    process.on("SIGINT", onFinishEvent);
    process.on("SIGTERM", onFinishEvent);
}
