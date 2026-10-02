import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { shoplingIdentityConfigFromEnv } from "../src/shopling-api-identity-source.mjs";
import { loadConfig } from "../src/config.mjs";
import { createShoplingUnshippedReview } from "../src/shopling-unshipped-review.mjs";

function parseArgs(argv) {
  const flags = { images: [], stockoutBCodes: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--selected-only") {
      flags.selectedOnly = true;
      continue;
    }
    if (key === "--image" && value) flags.images.push(value);
    else if (key === "--stockout-bcode" && value) flags.stockoutBCodes.push(value);
    else if (key.startsWith("--") && value) flags[key.slice(2)] = value;
    else continue;
    index += 1;
  }
  return flags;
}

const flags = parseArgs(process.argv.slice(2));
const localConfig = loadConfig();
const result = await createShoplingUnshippedReview({
  localConfig,
  apiConfig: shoplingIdentityConfigFromEnv(process.env),
  imagePaths: flags.images,
  reason: flags.reason || "UNSPECIFIED",
  expectedLabelCount: Number(flags["expected-labels"] || 1),
  stockoutBCodes: flags.stockoutBCodes,
  status: flags.status || "A04",
  selectedOnly: flags.selectedOnly === true,
});
const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (flags.output) await writeFile(resolve(flags.output), serialized, "utf8");
process.stdout.write(serialized);
