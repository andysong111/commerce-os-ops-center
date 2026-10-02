import { loadConfig } from "../src/config.mjs";
import { runShoplingFulfillmentPreflight } from "../src/shopling-fulfillment-preflight.mjs";

const config = loadConfig();
const result = await runShoplingFulfillmentPreflight(config);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
