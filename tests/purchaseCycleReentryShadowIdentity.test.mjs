import assert from "node:assert/strict";
import test from "node:test";
import { loadPurchaseCycleModule as load } from "./helpers/purchaseCycleHarness.mjs";
const engine = load("src/lib/productDecisionEngine/purchaseV2.ts");
const core = load("src/lib/purchaseCycleReentryShadowCore.ts", { "./productDecisionEngine/purchaseV2": engine });
const now = "2026-09-13T15:00:00Z", earlier = "2026-09-13T14:00:00Z", barcode = "BAB3-1";
const hasIssue = (row, code) => row.issues.some((issue) => issue.code === code);
function fixture() {
  return {
    now, targetCycleMonth: "2026-10", readStartedAt: now,
    planning: { generatedAt: now, products: [{ skuId: "sku-1", barcode, productName: "fixture", latestCostKrw: 1000 }] },
    audit: { ready: true, analysisAsOf: earlier, snapshot: { analysisAsOf: earlier, classificationComplete: true, bucketCount: 12, bucketDays: 30, orphanEventCount: 0, managedActiveSkuCount: 1, rows: [{ skuId: "sku-1", barcode, monthlyUnits: Array(12).fill(100), monthlyRevenue: Array(12).fill(300000) }] } },
    stock: { generatedAt: now, state: "READY", blockers: [], rows: [{ barcode, resetAt: earlier, resetEventId: "baseline-1", exactInventoryQuantity: 20, salesCoverageReady: true, recent30StockoutDays: 0, desiredStatus: "ON_SALE", syncNeeded: false, syncBlocked: false, latestSyncOutcome: "SUCCEEDED" }] },
    ledger: { commitments: [], invalidEventCount: 0 },
  };
}
test("review regression: one normalized SKU ID under two B-codes cannot double the candidates", () => {
  const input = fixture();
  input.planning.products.push({ ...input.planning.products[0], barcode: "BBB8-1", skuId: " sku-1 " });
  input.audit.snapshot.rows.push({ ...input.audit.snapshot.rows[0], barcode: "BBB8-1", skuId: " sku-1 " });
  input.audit.snapshot.managedActiveSkuCount = 2;
  input.stock.rows.push({ ...input.stock.rows[0], barcode: "BBB8-1", resetEventId: "baseline-2" });
  const report = core.buildPurchaseCycleReentryShadow(input);
  assert.equal(report.summary.candidateCount, 0);
  assert.ok(report.rows.every((row) => row.candidateQuantity === null && hasIssue(row, "SKU_IDENTITY_CONFLICT")));
});
test("cross-source SKU aliases are blocked without poisoning a different healthy SKU", () => {
  const input = fixture();
  input.planning.products.push({ ...input.planning.products[0], barcode: "BBB8-1", skuId: "sku-2" });
  input.audit.snapshot.rows.push({ ...input.audit.snapshot.rows[0], barcode: "BBB8-1", skuId: "sku-1" });
  input.stock.rows.push({ ...input.stock.rows[0], barcode: "BBB8-1", resetEventId: "baseline-2" });
  input.planning.products.push({ ...input.planning.products[0], barcode: "BCB2-1", skuId: "sku-3" });
  input.audit.snapshot.rows.push({ ...input.audit.snapshot.rows[0], barcode: "BCB2-1", skuId: "sku-3" });
  input.stock.rows.push({ ...input.stock.rows[0], barcode: "BCB2-1", resetEventId: "baseline-3" });
  input.audit.snapshot.managedActiveSkuCount = 3;
  const report = core.buildPurchaseCycleReentryShadow(input);
  assert.ok(report.rows.filter((row) => row.barcode !== "BCB2-1").every((row) => row.candidateQuantity === null));
  assert.ok(report.rows.find((row) => row.barcode === "BCB2-1").candidateQuantity > 0);
  assert.equal(report.summary.candidateCount, 1);
});
