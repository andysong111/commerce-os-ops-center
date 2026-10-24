import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/lib/productLaunchTrackerNormalizedStore.ts", import.meta.url),
  "utf8",
);

test("normalized list summaries use the latest normalized option rows", () => {
  assert.match(
    source,
    /select: "item_id,model_number,item_payload,summary_payload,updated_at,updated_by"/,
  );
  assert.match(source, /async function summarizeNormalizedPageRows/);
  assert.match(source, /hydrateNormalizedItems\(rows, optionResponse\.body\)/);
  assert.match(source, /summarizeProductLaunchTrackerItem\(item\)/);
});
