import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { reconcileUnshippedLabels } from "../src/shopling-unshipped-reconciliation.mjs";

function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) continue;
    flags[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  return flags;
}

async function readJson(path, label) {
  if (!path) throw new Error(`Missing --${label}.`);
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

const flags = parseArgs(process.argv.slice(2));
const manifest = await readJson(flags.manifest, "manifest");
const observations = await readJson(flags.observations, "observations");
const result = reconcileUnshippedLabels({
  manifestRows: Array.isArray(manifest) ? manifest : manifest.orders,
  observations: Array.isArray(observations) ? observations : observations.images,
});
const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (flags.output) await writeFile(resolve(flags.output), serialized, "utf8");
process.stdout.write(serialized);
