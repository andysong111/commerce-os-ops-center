import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveShipmentManifestBCodes } from "../src/shopling-bcode-resolution.mjs";

function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith("--") && argv[index + 1]) {
      flags[argv[index].slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  return flags;
}

async function readJson(path, label) {
  if (!path) throw new Error(`Missing --${label}.`);
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

const flags = parseArgs(process.argv.slice(2));
const manifest = await readJson(flags.manifest, "manifest");
const orderSource = await readJson(flags.orders, "orders");
const productSource = await readJson(flags.products, "products");
const result = resolveShipmentManifestBCodes({
  manifest,
  orderRows: Array.isArray(orderSource) ? orderSource : orderSource.rows,
  productRows: Array.isArray(productSource) ? productSource : productSource.rows,
});
const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (flags.output) await writeFile(resolve(flags.output), serialized, "utf8");
process.stdout.write(serialized);
