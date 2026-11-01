import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const {
  countMissingPurchaseDraftStockBands,
  normalizePurchaseDraftStockBandUpdates,
} = await import(
  new URL("../src/lib/purchaseDraftStockBandsCore.ts", import.meta.url)
);

test("단종예정 대기 상품은 대략 재고 미선택 차단에서 제외한다", () => {
  const lines = [
    { barcode: "BDA7-1", stockInputMode: "MANUAL" },
    { barcode: "BBA4-3", stockInputMode: "MANUAL" },
    { barcode: "BDB6-3", stockInputMode: "AUTO_NEW_SOURCING" },
  ];

  assert.equal(countMissingPurchaseDraftStockBands({
    lines,
    stagedStockBands: {},
    initialStockBands: {},
    stagedDiscontinuations: {},
  }), 2);
  assert.equal(countMissingPurchaseDraftStockBands({
    lines,
    stagedStockBands: {},
    initialStockBands: {},
    stagedDiscontinuations: { "BDA7-1": true },
  }), 1);
  assert.equal(countMissingPurchaseDraftStockBands({
    lines,
    stagedStockBands: { "BBA4-3": "NORMAL" },
    initialStockBands: {},
    stagedDiscontinuations: { "BDA7-1": true },
  }), 0);
});

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

test("draft stock buttons accept a full review Draft and collapse verified location aliases", () => {
  const bulk = Array.from({ length: 95 }, (_, index) => ({
    barcode: `BAA${index + 1}-1`,
    stockBand: index % 2 ? "NORMAL" : "HIGH",
  }));
  assert.equal(normalizePurchaseDraftStockBandUpdates(bulk).length, 95);
  assert.deepEqual(
    normalizePurchaseDraftStockBandUpdates([
      { barcode: "BBD4-2", stockBand: "HIGH" },
      { barcode: "BBD4-3", stockBand: "HIGH" },
    ]),
    [{ barcode: "BBD4-2", stockBand: "HIGH" }],
  );
  assert.throws(
    () => normalizePurchaseDraftStockBandUpdates([
      { barcode: "BBD4-2", stockBand: "HIGH" },
      { barcode: "BBD4-3", stockBand: "LOW" },
    ]),
    /PURCHASE_DRAFT_STOCK_BANDS_INVALID/,
  );
});

test("large rough-stock saves are chunked for Product Master and the inventory ledger", async () => {
  const source = await readFile("src/lib/purchaseDraftStockBands.ts", "utf8");
  assert.match(source, /index \+= 100/);
  assert.match(source, /index \+= 50/);
  assert.match(source, /Promise\.all\(identityBatches\.map\(loadProductMasterInventoryIdentities\)\)/);
});
