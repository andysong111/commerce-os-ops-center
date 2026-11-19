import assert from "node:assert/strict";
import test from "node:test";
import { saveFreightBundleUnitLedgerUpdates } from "../src/lib/freightBundleUnitLedger.ts";

const UPDATED_AT = "2026-11-19T04:00:00.000Z";

function update(barcode, bundleUnit) {
  return { barcode, bundleUnit, updatedAt: UPDATED_AT };
}

test("one stale B-code does not block valid bundle-unit ledger writes", async () => {
  const calls = [];
  const result = await saveFreightBundleUnitLedgerUpdates(
    [update("BAA1-1", 10), update("BAA3-1", 20), update("BAA4-1", 30)],
    async (batch) => {
      calls.push(batch.map((row) => row.barcode));
      if (batch.some((row) => row.barcode === "BAA3-1")) {
        throw new Error("SKU_BUNDLE_UNIT_BARCODE_NOT_FOUND:BAA3-1");
      }
      return batch;
    },
  );

  assert.deepEqual(result.updates, [update("BAA1-1", 10), update("BAA4-1", 30)]);
  assert.deepEqual(result.skipped, [
    { barcode: "BAA3-1", reason: "BARCODE_NOT_FOUND" },
  ]);
  assert.ok(calls.length > 1);
});

test("non-not-found ledger failures still fail closed", async () => {
  await assert.rejects(
    saveFreightBundleUnitLedgerUpdates([update("BAA1-1", 10)], async () => {
      throw new Error("PRODUCT_MASTER_UNAVAILABLE");
    }),
    /PRODUCT_MASTER_UNAVAILABLE/,
  );
});
