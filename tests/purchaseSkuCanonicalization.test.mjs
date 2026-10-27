import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalPurchaseBarcode,
  collapseCanonicalPurchaseRows,
  purchaseBarcodeMetadataCandidates,
} from "../src/lib/purchaseSkuCanonicalization.ts";
import { internalChinaStockInputMode } from "../src/lib/internalChinaStockInputPolicy.ts";

test("verified legacy warehouse alias becomes one canonical purchase row", () => {
  const rows = [
    { barcode: "BBD4-2", skuId: "sku-primary", recommendedQty: 85 },
    { barcode: "BBD4-3", skuId: "sku-legacy", recommendedQty: 5 },
  ];
  const collapsed = collapseCanonicalPurchaseRows(
    rows,
    (left, right) => right.recommendedQty - left.recommendedQty,
  );

  assert.equal(canonicalPurchaseBarcode("bbd4-3"), "BBD4-2");
  assert.deepEqual(purchaseBarcodeMetadataCandidates("BBD4-2"), ["BBD4-2", "BBD4-3"]);
  assert.deepEqual(collapsed, [
    { barcode: "BBD4-2", skuId: "sku-primary", recommendedQty: 85 },
  ]);
});

test("rows sharing a real Product Master skuId become one purchase row", () => {
  const collapsed = collapseCanonicalPurchaseRows(
    [
      { barcode: "BAA1-1", skuId: "sku-shared", recommendedQty: 10 },
      { barcode: "BAA1-2", skuId: "sku-shared", recommendedQty: 20 },
    ],
    (left, right) => right.recommendedQty - left.recommendedQty,
  );
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].barcode, "BAA1-2");
  assert.equal(collapsed[0].recommendedQty, 20);
});

test("confirmed zero and new sourcing skip repetitive rough-stock input", () => {
  assert.equal(
    internalChinaStockInputMode({ sourcingConfirmed: true }),
    "AUTO_NEW_SOURCING",
  );
  assert.equal(
    internalChinaStockInputMode({
      inventoryConfirmed: true,
      inventoryVerified: true,
      inventoryRequiresReview: false,
      inventoryBaselineKind: "SOLD_OUT_RESET",
      inventoryBaselineQuantity: 0,
    }),
    "AUTO_SOLD_OUT",
  );
  assert.equal(
    internalChinaStockInputMode({
      inventoryConfirmed: false,
      inventoryVerified: false,
      inventoryBaselineKind: "SOLD_OUT_RESET",
      inventoryBaselineQuantity: 0,
    }),
    "MANUAL",
  );
});
