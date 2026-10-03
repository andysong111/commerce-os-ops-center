import { loadConfig } from "../src/config.mjs";
import { runReturnPickupPreflight } from "../src/shopling-return-pickup-preflight.mjs";

const config = loadConfig();
const result = await runReturnPickupPreflight(config, {
  expectedAccount: process.env.SHOPLING_EXPECTED_ACCOUNT || "andy801",
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
