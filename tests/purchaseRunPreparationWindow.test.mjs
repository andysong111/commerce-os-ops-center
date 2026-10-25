import assert from "node:assert/strict";
import test from "node:test";

const { PURCHASE_RUN_PREPARATION_RESUME_MAX_AGE_MS } = await import(
  new URL("../src/lib/purchaseRunPreparationPolicy.ts", import.meta.url)
);

test("one-click purchase preparation keeps its frozen inputs beyond both collectors", () => {
  assert.equal(PURCHASE_RUN_PREPARATION_RESUME_MAX_AGE_MS, 60 * 60 * 1000);
});
