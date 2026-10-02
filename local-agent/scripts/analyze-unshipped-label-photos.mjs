import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createLabelObservationFromImage } from "../src/shopling-label-ocr.mjs";
import { reconcileUnshippedLabels } from "../src/shopling-unshipped-reconciliation.mjs";

function parseArgs(argv) {
  const flags = { images: [], stockoutBCodes: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--image" && value) flags.images.push(value);
    else if (key === "--stockout-bcode" && value) flags.stockoutBCodes.push(value);
    else if (key.startsWith("--") && value) flags[key.slice(2)] = value;
    else continue;
    index += 1;
  }
  return flags;
}

const flags = parseArgs(process.argv.slice(2));
if (!flags.manifest) throw new Error("Missing --manifest.");
if (!flags.images.length) throw new Error("At least one --image is required.");

const manifest = JSON.parse(await readFile(resolve(flags.manifest), "utf8"));
const observations = [];
for (const imagePath of flags.images) {
  observations.push(await createLabelObservationFromImage(imagePath, {
    expectedLabelCount: Number(flags["expected-labels"] || 1),
    reason: flags.reason || "UNSPECIFIED",
    stockoutBCodes: flags.stockoutBCodes,
  }));
}

const result = reconcileUnshippedLabels({
  manifestRows: Array.isArray(manifest) ? manifest : manifest.orders,
  observations,
});
const sanitized = {
  ...result,
  imageResults: result.imageResults.map((image) => ({
    ...image,
    ocrEngine: "LOCAL_TESSERACT",
  })),
};
const serialized = `${JSON.stringify(sanitized, null, 2)}\n`;
if (flags.output) await writeFile(resolve(flags.output), serialized, "utf8");
process.stdout.write(serialized);
