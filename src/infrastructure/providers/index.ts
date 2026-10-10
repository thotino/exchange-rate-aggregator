import config from "../../config.js";
import { Provider } from "./Provider.js";

export const providerA = new Provider(config.providers.providerA);
export const providerB = new Provider(config.providers.providerB);
