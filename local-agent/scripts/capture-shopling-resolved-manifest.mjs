import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../src/config.mjs";
import { shoplingIdentityConfigFromEnv, readShoplingIdentitySources } from "../src/shopling-api-identity-source.mjs";
import { resolveShipmentManifestBCodes } from "../src/shopling-bcode-resolution.mjs";
import { captureShoplingShipmentManifest } from "../src/shopling-shipment-manifest.mjs";

function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--selected-only") flags.selectedOnly = true;
    else if (key.startsWith("--") && argv[index + 1]) {
      flags[key.slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  return flags;
}

const flags = parseArgs(process.argv.slice(2));
const localConfig = loadConfig();
const manifest = await captureShoplingShipmentManifest(localConfig, {
  status: flags.status || "A04",
  selectedOnly: flags.selectedOnly === true,
});
const startDate = manifest.filters?.startDate;
const endDate = manifest.filters?.endDate;
const sources = await readShoplingIdentitySources({
  config: shoplingIdentityConfigFromEnv(process.env),
  startDate,
  endDate,
  shoplingOrderNos: manifest.orders.map((row) => row.shoplingOrderNo),
});
const result = resolveShipmentManifestBCodes({ manifest, ...sources });
const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (flags.output) await writeFile(resolve(flags.output), serialized, "utf8");
process.stdout.write(serialized);
