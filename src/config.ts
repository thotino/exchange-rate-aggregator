import conf from "config";
import type { RateServerConfig } from "./interfaces/types.js";
type WebserverConfig = {
    host: string;
    port: number;
};
type ProvidersConfig = {
    providerA: RateServerConfig;
    providerB: RateServerConfig;
};
const config = {
    webserver: conf.get("webserver") as WebserverConfig,
    providers: conf.get("providers") as ProvidersConfig,
};
export default config;
