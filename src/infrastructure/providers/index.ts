import config from "../../config";
import { Provider } from "./Provider";

export const providerA = new Provider(config.providers.providerA);
export const providerB = new Provider(config.providers.providerB);
