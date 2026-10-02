import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../src/config.mjs";
import { captureShoplingShipmentManifest } from "../src/shopling-shipment-manifest.mjs";

function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--selected-only") {
      flags.selectedOnly = true;
      continue;
    }
    if (key.startsWith("--") && argv[index + 1]) {
      flags[key.slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  return flags;
}

const flags = parseArgs(process.argv.slice(2));
const manifest = await captureShoplingShipmentManifest(loadConfig(), {
  status: flags.status || "A04",
  selectedOnly: flags.selectedOnly === true,
});
const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
if (flags.output) await writeFile(resolve(flags.output), serialized, "utf8");
process.stdout.write(serialized);
