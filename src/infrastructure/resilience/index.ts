import { Bulkhead } from "./Bulkhead.js";
import { CircuitBreaker } from "./CircuitBreaker.js";
import { RateLimiter } from "./RateLimiter.js";
import { ResilientClient } from "./ResilientClient.js";
import { Retry } from "./Retry.js";
const circuitBreaker = new CircuitBreaker();
const bulkHead = new Bulkhead("foo", {});
const rateLimiter = new RateLimiter();
const retry = new Retry({});
const resilientClient = new ResilientClient(
    circuitBreaker,
    bulkHead,
    rateLimiter,
    retry,
);
export { resilientClient };
