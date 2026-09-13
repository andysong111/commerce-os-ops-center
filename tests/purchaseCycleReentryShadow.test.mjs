import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { loadPurchaseCycleModule as load } from "./helpers/purchaseCycleHarness.mjs";

const engine = load("src/lib/productDecisionEngine/purchaseV2.ts");
const core = load("src/lib/purchaseCycleReentryShadowCore.ts", { "./productDecisionEngine/purchaseV2": engine });
const stockEvidence = load("src/lib/purchaseCycleStockEvidence.ts");
const china = load("src/lib/chinaOrderLedger.ts", { "@/lib/supabase/admin": {} });
const now = "2026-09-13T15:00:00.000Z";
const earlier = "2026-09-13T14:00:00.000Z";
const barcode = "BAB3-1";
function fixture() {
  return {
    now, targetCycleMonth: "2026-10", readStartedAt: now,
    planning: { generatedAt: now, products: [{ skuId: "sku-1", barcode, productName: "fixture", modelNo: "AAA231", skuActive: true, latestCostKrw: 1000 }] },
    audit: { ready: true, analysisAsOf: earlier, snapshot: { analysisAsOf: earlier, classificationComplete: true, bucketCount: 12, bucketDays: 30, orphanEventCount: 0, managedActiveSkuCount: 1, contentFingerprint: "canonical-1", rows: [{ skuId: "sku-1", barcode, monthlyUnits: Array(12).fill(100), monthlyRevenue: Array(12).fill(300000) }] } },
    stock: { generatedAt: now, state: "READY", fingerprint: "stock-1", blockers: [], rows: [{ barcode, productName: "fixture", resetAt: earlier, resetEventId: "baseline-1", exactInventoryQuantity: 20, salesCoverageReady: true, recent30StockoutDays: 0, desiredStatus: "ON_SALE", syncNeeded: false, syncBlocked: false, latestSyncOutcome: "SUCCEEDED" }] },
    ledger: { commitments: [], invalidEventCount: 0 },
    feedback: { multipliers: new Map(), fingerprint: "feedback-1" },
  };
}
const rowOf = (input = fixture()) => core.buildPurchaseCycleReentryShadow(input).rows[0];
const hasIssue = (row, name) => row.issues.some((value) => value.code === name);
const committed = (open, recommendation = open) => ({ barcode, openQuantity: open, recommendationOpenQuantity: recommendation, updatedAt: earlier });

test("same V2 engine, unallocated candidates, and permanently locked execution", () => {
  const input = fixture(), report = core.buildPurchaseCycleReentryShadow(input), row = report.rows[0];
  const expected = engine.calculatePurchaseV2Product({ barcode, name: "fixture", modelNo: "AAA231", monthlyUnits: Array(12).fill(100), monthlyRevenue: Array(12).fill(300000), unitCostKrw: 1000, inventorySource: "EXACT_AFTER_STOCKOUT_RESET", inventoryLowQuantity: 20, inventoryHighQuantity: 20, openCommitmentQuantity: 0, recent30StockoutDays: 0, feedbackMultiplier: 1 });
  assert.equal(row.candidateQuantity, expected.recommendedQuantity);
  assert.equal(row.target44Quantity, expected.target44Quantity);
  assert.equal(report.mode, "SHADOW_READ_ONLY");
  for (const key of ["writesEnabled", "actualPurchaseExecuted", "approvalGranted"]) assert.equal(report[key], false);
  assert.equal(report.cashBudgetKrw, null); assert.equal(row.allocatedQuantity, 0);
  assert.equal(report.budgetMonth, "2026-09");
});
test("sale-driven stock decrease increases next need without another baseline write", () => {
  const first = fixture(), second = fixture(); second.stock.rows[0].exactInventoryQuantity = 10;
  assert.equal(rowOf(second).candidateQuantity - rowOf(first).candidateQuantity, 10);
  assert.notEqual(core.buildPurchaseCycleReentryShadow(first).sourceFingerprint, core.buildPurchaseCycleReentryShadow(second).sourceFingerprint);
});
test("stocktake/restock is current total, not added a second time", () => {
  const input = fixture(); input.stock.rows[0].exactInventoryQuantity = 200;
  assert.equal(rowOf(input).candidateQuantity, 0); assert.equal(rowOf(input).stockQuantity, 200);
  assert.equal(rowOf(input).stage, "STOCK_SUFFICIENT");
});
test("zero reset is legitimate exact zero only with current sales evidence", () => {
  const input = fixture(); Object.assign(input.stock.rows[0], { exactInventoryQuantity: 0, desiredStatus: "SOLD_OUT" });
  assert.equal(rowOf(input).stockQuantity, 0); assert.ok(rowOf(input).candidateQuantity > 0);
});
test("all open orders across months, including manual additions, prevent duplicates", () => {
  const first = fixture(), second = fixture(); second.ledger.commitments = [committed(30), committed(10, 0)];
  assert.equal(rowOf(first).candidateQuantity - rowOf(second).candidateQuantity, 40);
  assert.equal(rowOf(second).manualOpenDifferenceQuantity, 10);
});
test("partial receipt transfers open quantity into stock exactly once", () => {
  const before = fixture(); before.ledger.commitments = [committed(50)];
  const after = fixture(); after.ledger.commitments = [committed(20)]; after.stock.rows[0].exactInventoryQuantity = 50;
  assert.equal(rowOf(before).candidateQuantity, rowOf(after).candidateQuantity);
});
test("absence of an open-order source is not zero open orders", () => {
  const input = fixture(); input.ledger = null;
  const report = core.buildPurchaseCycleReentryShadow(input);
  assert.equal(report.state, "BLOCKED"); assert.equal(report.rows[0].openCommitmentQuantity, null); assert.equal(report.rows[0].candidateQuantity, null);
});
test("missing baseline stays accumulation, never exact zero or compulsory census", () => {
  const input = fixture(); input.stock.rows = [];
  assert.equal(rowOf(input).stage, "BASELINE_ACCUMULATING"); assert.equal(rowOf(input).stockQuantity, null); assert.equal(rowOf(input).candidateQuantity, null);
});
test("estimated band may show V2 reference but cannot become an exact candidate", () => {
  const input = fixture(); input.stock.rows = [];
  input.diagnostics = { state: "READY_READ_ONLY", canonicalCoverageEndAt: earlier, rows: [{ barcode, state: "BAND_READY", diagnosticLowQuantity: 20, diagnosticHighQuantity: 20 }] };
  const row = rowOf(input); assert.equal(row.inventoryBasis, "ESTIMATED_REFERENCE"); assert.equal(row.candidateQuantity, null); assert.ok(row.target44Quantity > 0); assert.equal(row.stage, "REVIEW");
});
test("historical stale-Tail regression: refreshed report timestamp does not refresh evidence", () => {
  const input = fixture(); const source = input.stock;
  const tails = new Map([["baseline-1", { barcode, resetEventId: "baseline-1", resetAt: earlier, coverageStartAt: earlier, coverageEndAt: "2026-09-13T14:49:59.999Z" }]]);
  input.stock = stockEvidence.validatePurchaseCycleStockEvidence(source, tails, undefined, Date.parse(now));
  input.diagnostics = { state: "READY_READ_ONLY", canonicalCoverageEndAt: now, rows: [{ barcode, state: "BAND_READY", diagnosticLowQuantity: 0, diagnosticHighQuantity: 0 }] };
  const row = rowOf(input); assert.ok(hasIssue(row, "BASELINE_EVIDENCE_NOT_READY")); assert.equal(row.inventoryBasis, "UNKNOWN"); assert.equal(row.candidateQuantity, null);
});
test("missing source, old demand, and future demand are visible global blockers", () => {
  for (const timestamp of ["2026-09-11T15:00:00Z", "2026-09-13T16:00:00Z"]) {
    const input = fixture(); input.audit.analysisAsOf = input.audit.snapshot.analysisAsOf = timestamp;
    const report = core.buildPurchaseCycleReentryShadow(input); assert.equal(report.state, "BLOCKED"); assert.equal(report.rows[0].candidateQuantity, null);
  }
  const input = fixture(); input.planning = null; input.sourceErrors = ["PLANNING_READ_FAILED"];
  assert.equal(core.buildPurchaseCycleReentryShadow(input).summary.activeSkuCount, null);
});
test("duplicate normalized B-code and SKU identity disagreement fail closed", () => {
  const input = fixture(); input.planning.products.push({ ...input.planning.products[0], barcode: " bab3–1 ", skuId: "sku-2" }); input.audit.snapshot.managedActiveSkuCount = 2; input.audit.snapshot.rows.push({ ...input.audit.snapshot.rows[0], skuId: "sku-2" });
  assert.ok(hasIssue(rowOf(input), "BARCODE_IDENTITY_CONFLICT")); assert.equal(rowOf(input).candidateQuantity, null);
  const other = fixture(); other.audit.snapshot.rows[0].skuId = "other"; assert.ok(hasIssue(rowOf(other), "DEMAND_IDENTITY_OR_BUCKETS_INVALID"));
});
test("malformed demand, cost and stock do not get silently normalized to zero", () => {
  for (const change of [
    (x) => { x.audit.snapshot.rows[0].monthlyUnits = undefined; },
    (x) => { x.audit.snapshot.rows[0].monthlyUnits[0] = -1; },
    (x) => { x.planning.products[0].latestCostKrw = 0; },
    (x) => { x.stock.rows[0].exactInventoryQuantity = NaN; },
    (x) => { x.stock.rows[0].resetAt = "2026-09-14T15:00:00Z"; },
  ]) { const input = fixture(); change(input); assert.equal(rowOf(input).candidateQuantity, null); }
});
test("STARTED/UNCERTAIN or pending selling status never becomes an approved action", () => {
  for (const outcome of ["STARTED", "UNCERTAIN", "FAILED"]) {
    const input = fixture(); input.stock.rows[0].latestSyncOutcome = outcome;
    assert.equal(rowOf(input).candidateQuantity, null); assert.ok(hasIssue(rowOf(input), "SALE_STATUS_RECONCILIATION"));
  }
});
test("identical evidence has identical fingerprint; generatedAt alone does not fake a change", () => {
  const a = fixture(), b = fixture(); b.now = "2026-09-13T15:00:01Z"; b.readStartedAt = b.now;
  assert.equal(core.buildPurchaseCycleReentryShadow(a).sourceFingerprint, core.buildPurchaseCycleReentryShadow(b).sourceFingerprint);
});
test("KST month boundary and December rollover; arbitrary target month is rejected", () => {
  assert.equal(core.reentryShadowMonths("2026-09-30T15:00:00Z").current, "2026-10");
  assert.equal(core.reentryShadowMonths("2026-12-31T15:00:00Z").next, "2027-02");
  assert.throws(() => core.validateReentryTargetMonth("2026-11", now), /TARGET_MONTH/);
});

function stored(index = 0, changes = {}) {
  return { source_event_id: `persisted-${index}`, started_at: earlier, input_snapshot: { sourceSystem: "fixture", sourceLineId: "line-1", sourceEventId: `event-${index}`, barcode, status: "ORDERED", requestedQuantity: 100, orderedQuantity: 100, occurredAt: earlier, ...changes } };
}
function strictModule(results = []) {
  let calls = 0;
  const admin = { from(table) {
    assert.equal(table, "commerce_operation_runs");
    const query = { select(_s, options) { assert.equal(options.count, "exact"); return query; }, eq() { return query; }, order(column) { assert.equal(column, "source_event_id"); return query; }, range(from, to) { assert.equal(from, calls * 500); assert.equal(to, from + 499); return Promise.resolve(results[calls++]); } };
    return query;
  } };
  return { module: load("src/lib/purchaseCycleReentryCommitments.ts", { "@/lib/chinaOrderLedger": china, "@/lib/supabase/admin": { createSupabaseAdminClient: async () => admin } }), calls: () => calls };
}
test("complete empty ledger is distinct from missing count, truncated and failed reads", async () => {
  assert.equal((await strictModule([{ data: [], count: 0, error: null }]).module.loadPurchaseCycleReentryCommitments()).totalOpenQuantity, 0);
  for (const result of [{ data: [], count: null, error: null }, { data: [], count: 3, error: null }, { data: [], count: 5001, error: null }, { data: null, count: null, error: { message: "secret must not leak" } }]) {
    await assert.rejects(strictModule([result]).module.loadPurchaseCycleReentryCommitments());
  }
});
test("full count-verified paging preserves older open orders, not just newest page", async () => {
  const first = Array.from({ length: 500 }, (_, i) => stored(i));
  const item = stored(500, { sourceLineId: "old-still-open", orderedQuantity: 30, requestedQuantity: 30 });
  const fixtureModule = strictModule([{ data: first, count: 501, error: null }, { data: [item], count: 501, error: null }]);
  const result = await fixtureModule.module.loadPurchaseCycleReentryCommitments(); assert.equal(fixtureModule.calls(), 2); assert.equal(result.totalOpenQuantity, 130);
});
test("changed count or duplicate page identity rejects an incoherent ledger", async () => {
  const first = Array.from({ length: 500 }, (_, i) => stored(i));
  await assert.rejects(strictModule([{ data: first, count: 501, error: null }, { data: [stored(500)], count: 502, error: null }]).module.loadPurchaseCycleReentryCommitments(), /CHANGED/);
  await assert.rejects(strictModule([{ data: first, count: 501, error: null }, { data: [stored(0)], count: 501, error: null }]).module.loadPurchaseCycleReentryCommitments(), /DRIFT/);
});
test("cumulative partial receipts, cancellation, repeated event and cross-source collision", () => {
  const strict = strictModule().module;
  const events = [stored(1), stored(2, { status: "PARTIALLY_RECEIVED", receivedQuantity: 30, occurredAt: "2026-09-13T14:01:00Z" })];
  assert.equal(strict.validateReentryCommitmentRows(events).totalOpenQuantity, 70);
  assert.equal(strict.validateReentryCommitmentRows([...events, { ...events[1], source_event_id: "duplicate-storage" }]).totalOpenQuantity, 70);
  assert.equal(strict.validateReentryCommitmentRows([...events, stored(3, { status: "CANCELLED", occurredAt: "2026-09-13T14:02:00Z" })]).totalOpenQuantity, 0);
  assert.throws(() => strict.validateReentryCommitmentRows([stored(1), stored(2, { sourceEventId: "event-1", sourceSystem: "different" })]), /COLLISION/);
  assert.throws(() => strict.validateReentryCommitmentRows([stored(1, { orderedQuantity: 2.5 })]), /QUANTITY_INVALID/);
  assert.throws(() => strict.validateReentryCommitmentRows([stored(1, { occurredAt: new Date(Date.now() + 120000).toISOString() })]), /FUTURE/);
});

function loaderHarness(holdPlanning = null, failure = false) {
  const calls = { planning: 0, stock: 0 };
  const imports = {
    "@/lib/productDecisionLiveRefresh": { loadProductPlanningSnapshot: async () => { calls.planning++; if (failure) throw new Error("private source error"); if (holdPlanning) await holdPlanning; return fixture().planning; } },
    "@/lib/productMasterCanonicalSalesAudit": { loadProductMasterCanonicalSalesAudit: async () => fixture().audit },
    "@/lib/purchaseCycleStockReport": { loadPurchaseCycleStockReport: async (options) => { calls.stock++; assert.equal(options.refreshSales, false); return fixture().stock; } },
    "@/lib/purchaseCycleReentryCommitments": { loadPurchaseCycleReentryCommitments: async () => fixture().ledger },
    "@/lib/stage8ProvisionalInventoryDiagnostics": { loadProvisionalInventoryDiagnostics: async () => null },
    "@/lib/stage8CanonicalSalesEventSnapshot": { loadStage8CanonicalSalesEventSnapshot: async () => ({ state: "READY_READ_ONLY", events: [] }) },
    "@/lib/purchaseRecommendationFinalization": { loadPurchaseForecastFeedback: async () => fixture().feedback },
    "@/lib/purchaseCycleReentryShadowCore": { ...core, buildPurchaseCycleReentryShadow: (input) => ({ input }) },
  };
  return { module: load("src/lib/purchaseCycleReentryShadow.ts", imports), calls };
}
test("read-only loader single-flights concurrent reads but never caches a completed READY", async () => {
  let release; const hold = new Promise((resolve) => { release = resolve; });
  const h = loaderHarness(hold); const a = h.module.loadPurchaseCycleReentryShadow(); const b = h.module.loadPurchaseCycleReentryShadow();
  release(); await Promise.all([a, b]); assert.equal(h.calls.planning, 1); assert.equal(h.calls.stock, 1);
  await h.module.loadPurchaseCycleReentryShadow(); assert.equal(h.calls.planning, 2);
});
test("source exception becomes a redacted blocker, not an empty successful recommendation", async () => {
  const report = await loaderHarness(null, true).module.loadPurchaseCycleReentryShadow();
  assert.ok(report.input.sourceErrors.includes("PLANNING_READ_FAILED")); assert.equal(report.input.planning, null);
  assert.doesNotMatch(JSON.stringify(report), /private source error/);
});
test("API authentication, query boundaries, explicit write rejection and safe source failures", async () => {
  let calls = 0;
  const route = (authorized, unavailable = false) => load("src/app/api/china-order-manager/reentry-shadow/route.ts", {
    "@/lib/opsLoginBypass": { isSameOriginOpsRequest: () => authorized },
    "@/lib/purchaseCycleReentryShadowCore": core,
    "@/lib/purchaseCycleReentryShadow": { loadPurchaseCycleReentryShadow: async () => { calls++; if (unavailable) throw new Error("secret"); return core.buildPurchaseCycleReentryShadow(fixture()); } },
  });
  assert.equal((await route(false).GET(new Request("https://ops.test/api/shadow"))).status, 401); assert.equal(calls, 0);
  assert.equal((await route(true).GET(new Request("https://ops.test/api/shadow?approve=true"))).status, 400); assert.equal(calls, 0);
  assert.equal((await route(true).POST()).status, 405); assert.equal(calls, 0);
  assert.equal((await route(true).GET(new Request("https://ops.test/api/shadow"))).status, 200);
  const failed = await route(true, true).GET(new Request("https://ops.test/api/shadow")); assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /secret/);
});
test("shadow source graph has no write, refresh, allocation, finalization or draft entry point", () => {
  const source = readFileSync("src/lib/purchaseCycleReentryShadow.ts", "utf8");
  assert.doesNotMatch(source, /refreshSales:\s*true|storeInventoryOperation|create.*Draft|storePurchaseRecommendation|allocatePurchaseV2Portfolio/);
  assert.match(source, /refreshSales:\s*false/);
});
