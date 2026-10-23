import assert from "node:assert/strict";
import test from "node:test";

const { normalizePurchaseDraftStockBandUpdates } = await import(
  new URL("../src/lib/purchaseDraftStockBandsCore.ts", import.meta.url)
);

test("draft stock buttons normalize model-option B-codes and four supported bands", () => {
  assert.deepEqual(
    normalizePurchaseDraftStockBandUpdates([
      { barcode: " bba2-1 ", stockBand: "high" },
      { barcode: "BBC1-3", stockBand: "OUT" },
    ]),
    [
      { barcode: "BBA2-1", stockBand: "HIGH" },
      { barcode: "BBC1-3", stockBand: "OUT" },
    ],
  );
});

test("draft stock buttons reject duplicate B-codes and unknown bands before any write", () => {
  assert.throws(
    () => normalizePurchaseDraftStockBandUpdates([
      { barcode: "BBA2-1", stockBand: "LOW" },
      { barcode: "BBA2-1", stockBand: "OUT" },
    ]),
    /PURCHASE_DRAFT_STOCK_BANDS_INVALID/,
  );
  assert.throws(
    () => normalizePurchaseDraftStockBandUpdates([{ barcode: "BBA2-1", stockBand: "MANY" }]),
    /PURCHASE_DRAFT_STOCK_BANDS_INVALID/,
  );
});
