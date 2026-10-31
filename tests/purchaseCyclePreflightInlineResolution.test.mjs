import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  buildPurchaseCycleRoughStockBatchId,
  buildPurchaseCycleRoughStockEstimateItems,
} from "../src/lib/purchaseCyclePreflightInlineResolution.ts";

const targets = [
  { barcode: " bcc5-2 ", productName: "안경다리 실리콘 1쌍" },
  { barcode: "BAE1-3", productName: "셀프미발망토" },
];

test("all selected rough-stock bands become one normalized atomic batch", () => {
  assert.deepEqual(buildPurchaseCycleRoughStockEstimateItems(targets, {
    "BCC5-2": "LOW",
    "BAE1-3": "OUT",
  }), [
    { barcode: "BCC5-2", stockBand: "LOW" },
    { barcode: "BAE1-3", stockBand: "OUT" },
  ]);
});

test("a missing selection rejects the whole batch before any request", () => {
  assert.throws(
    () => buildPurchaseCycleRoughStockEstimateItems(targets, { "BCC5-2": "NORMAL" }),
    /BAE1-3의 대략재고를 선택/,
  );
});

test("duplicate normalized barcodes reject the whole batch", () => {
  assert.throws(
    () => buildPurchaseCycleRoughStockEstimateItems([
      targets[0],
      { barcode: "BCC5-2", productName: "중복" },
    ], { "BCC5-2": "HIGH" }),
    /중복된 B코드/,
  );
});

test("batch ids are retry-stable for the same cycle and change with the decision", () => {
  const low = [{ barcode: "BCC5-2", stockBand: "LOW" }];
  assert.equal(
    buildPurchaseCycleRoughStockBatchId(" 2026-10-31:new ", low),
    buildPurchaseCycleRoughStockBatchId("2026-10-31:new", low),
  );
  assert.notEqual(
    buildPurchaseCycleRoughStockBatchId("2026-10-31:new", low),
    buildPurchaseCycleRoughStockBatchId("2026-10-31:new", [
      { barcode: "BCC5-2", stockBand: "OUT" },
    ]),
  );
});

test("the preflight page wires inline save to a same-page server refresh", () => {
  const page = fs.readFileSync("src/app/purchase-cycle-preflight/page.tsx", "utf8");
  const component = fs.readFileSync(
    "src/components/purchase-cycle-preflight/InlineRoughStockCorrection.tsx",
    "utf8",
  );

  assert.match(page, /<InlineRoughStockCorrection/);
  assert.match(page, /report\.targetDate/);
  assert.match(component, /\/api\/inventory-stock-control\/unified-batch/);
  assert.match(component, /startRefreshTransition\(\(\) => router\.refresh\(\)\)/);
  assert.doesNotMatch(component, /window\.location\.reload/);
});
