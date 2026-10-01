import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPurchaseWholesaleCostEstimates,
  WHOLESALE_COST_ESTIMATE_SOURCE,
} from "../src/lib/purchaseWholesaleCostEstimate.ts";

function currentPrices(rows) {
  return {
    generatedAt: "2026-10-02T00:00:00.000Z",
    state: "PARTIAL",
    productCount: rows.length,
    readyCount: rows.length,
    missingCount: 0,
    conflictCount: 0,
    queriedGoodsKeyCount: 3,
    sourceRowCount: 3,
    writesEnabled: false,
    rows,
  };
}

test("active wholesale sale prices are inverted conservatively without using Shopling original cost", () => {
  const products = [{
    skuId: "sku-1", barcode: "BAA1-1", productName: "fixture", skuActive: true,
    listings: [
      { goodsKey: "101", optionId: "A", unitsPerOrder: 2, active: true },
      { goodsKey: "102", optionId: "B", unitsPerOrder: 1, active: true },
      { goodsKey: "103", optionId: "C", unitsPerOrder: 1, active: true },
    ],
  }];
  const snapshot = currentPrices([{
    barcode: "BAA1-1", state: "READY", priceMode: "GROUPED", currentSalePrice: 0,
    goodsKeys: ["101", "102", "103"], mappedListingCount: 3,
    unresolvedListingCount: 0, conflictListingCount: 0, distinctPrices: [12000, 14000, 99000],
    listings: [
      { goodsKey: "101", optionId: "A", ptnGoodsCd: "BAA1-1a", productGroup: "도매1", baseSalePrice: 12000, optionAmount: 0, effectiveSalePrice: 12000, originalCost: 1, listPrice: 0, saleStatus: "B" },
      { goodsKey: "102", optionId: "B", ptnGoodsCd: "BAA1-1b", productGroup: "도매2", baseSalePrice: 14000, optionAmount: 0, effectiveSalePrice: 14000, originalCost: 999999, listPrice: 0, saleStatus: "B" },
      { goodsKey: "103", optionId: "C", ptnGoodsCd: "BAA1-1d", productGroup: "도매4", baseSalePrice: 99000, optionAmount: 0, effectiveSalePrice: 99000, originalCost: 999999, listPrice: 0, saleStatus: "S" },
    ],
  }]);
  const report = buildPurchaseWholesaleCostEstimates({
    products,
    planningContentFingerprint: `sha256:${"a".repeat(64)}`,
    currentPrices: snapshot,
  });
  assert.equal(report.rows[0].state, "ESTIMATED");
  assert.equal(report.rows[0].estimatedUnitCostKrw, Math.ceil(14000 / 2.3));
  assert.equal(report.rows[0].source, WHOLESALE_COST_ESTIMATE_SOURCE);
  assert.equal(report.rows[0].evidence.length, 2);
  assert.equal(report.writesEnabled, false);
});

test("missing or inactive wholesale evidence stays explicit instead of inventing a cost", () => {
  const products = [{
    skuId: "sku-2", barcode: "BAA2-1", productName: "fixture", skuActive: true,
    listings: [{ goodsKey: "201", optionId: "A", unitsPerOrder: 1, active: true }],
  }];
  const report = buildPurchaseWholesaleCostEstimates({
    products,
    planningContentFingerprint: `sha256:${"b".repeat(64)}`,
    currentPrices: currentPrices([{
      barcode: "BAA2-1", state: "READY", priceMode: "UNIFORM", currentSalePrice: 10000,
      goodsKeys: ["201"], mappedListingCount: 1, unresolvedListingCount: 0,
      conflictListingCount: 0, distinctPrices: [10000],
      listings: [{ goodsKey: "201", optionId: "A", ptnGoodsCd: "BAA2-1a", productGroup: "도매1", baseSalePrice: 10000, optionAmount: 0, effectiveSalePrice: 10000, originalCost: 5000, listPrice: 0, saleStatus: "S" }],
    }]),
  });
  assert.equal(report.state, "BLOCKED");
  assert.equal(report.rows[0].state, "MISSING");
  assert.equal(report.rows[0].estimatedUnitCostKrw, 0);
  assert.equal(report.rows[0].reason, "ACTIVE_WHOLESALE_PRICE_UNAVAILABLE");
});
