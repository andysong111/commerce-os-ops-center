import assert from "node:assert/strict";
import test from "node:test";
import { loadPurchaseCycleModule as load } from "./helpers/purchaseCycleHarness.mjs";
const engine = load("src/lib/productDecisionEngine/purchaseV2.ts");
const core = load("src/lib/purchaseCycleReentryShadowCore.ts", { "./productDecisionEngine/purchaseV2": engine });
const china = load("src/lib/chinaOrderLedger.ts", { "@/lib/supabase/admin": {} });
const commitments = load("src/lib/purchaseCycleReentryCommitments.ts", { "@/lib/chinaOrderLedger": china, "@/lib/supabase/admin": {} });
const now = "2026-09-14T01:00:00.000Z", earlier = "2026-09-14T00:00:00.000Z", barcode = "BAB3-1";
function fixture() {
  return { now, targetCycleMonth: "2026-10", readStartedAt: now,
    planning: { generatedAt: now, products: [{ skuId: "sku-1", barcode, productName: "fixture", skuActive: true, latestCostKrw: 1000 }] },
    audit: { ready: true, state: "READY", analysisAsOf: earlier, snapshot: { analysisAsOf: earlier, classificationComplete: true, bucketCount: 12, bucketDays: 30, orphanEventCount: 0, managedActiveSkuCount: 1, contentFingerprint: "canonical", rows: [{ skuId: "sku-1", barcode, monthlyUnits: Array(12).fill(100), monthlyRevenue: Array(12).fill(300000) }] } },
    stock: { generatedAt: now, state: "READY", blockers: [], rows: [{ barcode, resetAt: earlier, resetEventId: "baseline", exactInventoryQuantity: 20, salesCoverageReady: true, desiredStatus: "ON_SALE", syncNeeded: false, syncBlocked: false, latestSyncOutcome: "SUCCEEDED" }] },
    ledger: { commitments: [], invalidEventCount: 0 },
  };
}
const build = (x) => core.buildPurchaseCycleReentryShadow(x);
const issue = (x, code) => x.issues.some((row) => row.code === code);
const pending = (x, code) => x.blockers.some((row) => row.code === code);
function stored(changes = {}) {
  return { source_event_id: "private-persisted-id", started_at: earlier, input_snapshot: { sourceSystem: "EXTERNAL_ORDER_IMPORT", sourceLineId: "private-line", barcode, sourceEventId: "private-event", status: "ORDERED", requestedQuantity: 200, orderedQuantity: 200, occurredAt: earlier, ...changes } };
}
test("production regression: seven TMP placeholders remain visible without poisoning the managed B-code scope", () => {
  const x = fixture();
  for (let i = 1; i <= 7; i++) x.planning.products.push({ skuId: `temporary-${i}`, barcode: `TMP1-${i}`, productName: "awaiting mapping", skuActive: true });
  const report = build(x);
  assert.equal(report.managedSkuCount, 1); assert.equal(report.quarantinedSkuCount, 7); assert.equal(report.summary.activeSkuCount, 8);
  assert.equal(report.state, "REVIEW_SHADOW"); assert.equal(report.summary.candidateCount, 1); assert.equal(report.rows.length, 8);
  for (const row of report.rows.filter((row) => row.barcode.startsWith("TMP"))) {
    assert.ok(issue(row, "CATALOG_PLACEHOLDER")); assert.equal(row.candidateQuantity, null); assert.equal(row.stockQuantity, null); assert.equal(row.allocatedQuantity, 0);
  }
  assert.ok(!pending(report, "CATALOG_DEMAND_SCOPE_MISMATCH")); assert.ok(!pending(report, "CATALOG_INVALID_BARCODE"));
});
test("only explicit TMP placeholders are quarantined; unknown malformed codes still fail closed", () => {
  const x = fixture(); x.planning.products.push({ skuId: "bad", barcode: "UNKNOWN-1", skuActive: true });
  const report = build(x); assert.equal(report.state, "BLOCKED"); assert.ok(pending(report, "CATALOG_INVALID_BARCODE")); assert.equal(report.summary.candidateCount, 0);
});
test("TMP alias sharing a real SKU identity cannot enable the real B-code candidate", () => {
  const x = fixture(); x.planning.products.push({ ...x.planning.products[0], barcode: "TMP1-1" });
  const report = build(x); assert.equal(report.summary.candidateCount, 0); assert.ok(issue(report.rows.find((row) => row.barcode === barcode), "SKU_IDENTITY_CONFLICT"));
});
test("a commitment against TMP still blocks all new recommendations; it is not discarded as non-purchase stock", () => {
  const x = fixture(); x.ledger.commitments.push({ barcode: "TMP1-1", openQuantity: 200, recommendationOpenQuantity: 200, updatedAt: earlier });
  const report = build(x); assert.equal(report.state, "BLOCKED"); assert.ok(pending(report, "COMMITMENT_INVALID")); assert.equal(report.summary.candidateCount, 0);
});
test("unavailable official demand is not reported as corrupt identity on every SKU", () => {
  const x = fixture(); x.audit = { ready: false, state: "READY_CANARY", analysisAsOf: "2026-09-07T14:32:29.432Z", snapshot: null };
  const report = build(x); assert.equal(report.state, "BLOCKED"); assert.ok(pending(report, "DEMAND_PUBLICATION_PENDING")); assert.ok(pending(report, "DEMAND_STALE"));
  assert.equal(report.demandSourceState, "READY_CANARY"); assert.ok(issue(report.rows[0], "DEMAND_SOURCE_UNAVAILABLE")); assert.ok(!issue(report.rows[0], "DEMAND_IDENTITY_OR_BUCKETS_INVALID"));
  assert.equal(report.rows[0].candidateQuantity, null); assert.equal(report.recovery.find((x) => x.id === "sales").state, "BLOCKED");
});
test("actual bad demand rows still fail identity checks when a snapshot is present", () => {
  const x = fixture(); x.audit.snapshot.rows[0].skuId = "other";
  const report = build(x); assert.ok(issue(report.rows[0], "DEMAND_IDENTITY_OR_BUCKETS_INVALID")); assert.equal(report.rows[0].candidateQuantity, null);
});
test("production unassigned 200-unit order is an actionable hold, never zero commitments or a leaked identifier", () => {
  assert.throws(() => commitments.validateReentryCommitmentRows([stored({ barcode: "UNASSIGNED-202609-001" })]), (error) => error.message === "REENTRY_COMMITMENT_BARCODE_UNRESOLVED");
  const x = fixture(); x.ledger = null; x.sourceErrors = ["REENTRY_COMMITMENT_BARCODE_UNRESOLVED"];
  const report = build(x); assert.equal(report.state, "BLOCKED"); assert.equal(report.rows[0].openCommitmentQuantity, null);
  assert.match(report.blockers.find((row) => row.code === x.sourceErrors[0]).message, /B코드/);
  assert.equal(report.recovery.find((row) => row.id === "commitments").state, "BLOCKED");
});
test("malformed commitment identity/status/time remain held and normalized only to safe error codes", () => {
  for (const [change, expected] of [[{ sourceSystem: "" }, "IDENTITY_REQUIRED"], [{ status: "private-secret-status" }, "STATUS_INVALID"], [{ occurredAt: "private-time" }, "TIME_INVALID"]]) {
    assert.throws(() => commitments.validateReentryCommitmentRows([stored(change)]), (error) => error.message === `REENTRY_COMMITMENT_${expected}`);
  }
  assert.equal(commitments.validateReentryCommitmentRows([stored()], Date.parse(now)).totalOpenQuantity, 200);
});
test("recovery cannot mark unavailable catalog/stock or absent cost evidence as verified", () => {
  const x = fixture(); x.stock = null; x.planning = null;
  const report = build(x); for (const id of ["catalog_cost", "stock_sale"]) assert.equal(report.recovery.find((row) => row.id === id).state, "BLOCKED");
  const noCost = fixture(); noCost.planning.products[0].latestCostKrw = 0;
  const result = build(noCost); assert.ok(issue(result.rows[0], "COST_MISSING")); assert.equal(result.recovery.find((row) => row.id === "catalog_cost").state, "REVIEW");
});
test("October 1 and later never change the read-only preparation into automatic approval", () => {
  const x = fixture(); x.now = x.readStartedAt = x.planning.generatedAt = x.stock.generatedAt = "2026-10-01T00:00:00.000Z";
  x.audit.analysisAsOf = x.audit.snapshot.analysisAsOf = x.now;
  const report = build(x); assert.equal(report.actualPurchaseExecuted, false); assert.equal(report.approvalGranted, false); assert.equal(report.writesEnabled, false);
  assert.equal(report.cashBudgetKrw, null); assert.equal(report.rows[0].allocatedQuantity, 0); assert.equal(report.recovery.at(-1).state, "DEFERRED");
});
