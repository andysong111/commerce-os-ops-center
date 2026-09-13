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
function reconciliation({ sourceEventId, sourceLineId = "private-line", fromBarcode = "UNASSIGNED-202609-001", toBarcode = "BGF1-3", confirmed = true, confirmationMethod = "OWNER_EXPLICIT_CONFIRMATION", confirmedAt = "2026-09-14T00:02:00.000Z" } = {}) {
  const id = sourceEventId ?? `reconcile-${toBarcode}`;
  const row = stored({
    sourceLineId,
    sourceEventId: id,
    barcode: toBarcode,
    status: "ORDERED",
    requestedQuantity: 200,
    orderedQuantity: 200,
    receivedQuantity: 0,
    cancelledQuantity: 0,
    occurredAt: confirmedAt,
    note: "owner-confirmed identity with lifecycle parity",
    payload: { identityReconciliation: { confirmed, confirmationMethod, fromBarcode, toBarcode, modelNo: "AAA309", confirmedAt } },
  });
  row.source_event_id = `persisted-${id}`;
  row.started_at = confirmedAt;
  return row;
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
test("review regression: TMP-looking codes outside the seven verified legacy placeholders remain global blockers", () => {
  for (const code of ["TMP2-99", "TMP1-8", "TMP1-0", "TMP01-1", "TMP1-01"]) {
    const x = fixture(); x.planning.products.push({ skuId: "unknown-temp", barcode: code, skuActive: true });
    const report = build(x);
    assert.equal(report.state, "BLOCKED", code); assert.ok(pending(report, "CATALOG_INVALID_BARCODE"), code);
    assert.equal(report.summary.candidateCount, 0); assert.equal(report.quarantinedSkuCount, 0);
    assert.ok(!issue(report.rows.find((row) => row.barcode === code), "CATALOG_PLACEHOLDER"));
  }
});
test("review regression: row demand and identity errors demote corresponding recovery evidence", () => {
  for (const mutate of [
    (x) => { x.audit.snapshot.rows[0].skuId = "different-sku"; },
    (x) => { x.audit.snapshot.rows[0].monthlyUnits = [1]; },
    (x) => { x.audit.snapshot.rows[0].monthlyRevenue = [-1, ...Array(11).fill(1)]; },
  ]) {
    const x = fixture(); mutate(x); const report = build(x);
    assert.equal(report.summary.candidateCount, 0);
    assert.equal(report.recovery.find((row) => row.id === "sales").state, "REVIEW");
    assert.doesNotMatch(report.recovery.find((row) => row.id === "sales").message, /통과했습니다/);
  }
  const x = fixture(); x.planning.products[0].skuId = "";
  const invalidId = build(x); assert.equal(invalidId.recovery.find((row) => row.id === "catalog_cost").state, "REVIEW");
  const y = fixture(); y.planning.products.push({ ...y.planning.products[0], barcode: "BGF1-3" });
  y.audit.snapshot.managedActiveSkuCount = 2; y.audit.snapshot.rows.push({ ...y.audit.snapshot.rows[0], barcode: "BGF1-3" });
  const alias = build(y); assert.equal(alias.summary.candidateCount, 0);
  assert.equal(alias.recovery.find((row) => row.id === "sales").state, "REVIEW");
  assert.equal(alias.recovery.find((row) => row.id === "catalog_cost").state, "REVIEW");
  const healthy = build(fixture());
  assert.equal(healthy.recovery.find((row) => row.id === "sales").state, "VERIFIED");
  assert.equal(healthy.recovery.find((row) => row.id === "catalog_cost").state, "VERIFIED");
});
test("review regression: publication phase changes update the fingerprint even without a canonical snapshot", () => {
  const x = fixture(); x.audit = { ready: false, state: "READY_CANARY", analysisAsOf: earlier, snapshot: null };
  const before = build(x); x.audit.state = "READY_FULL"; const after = build(x);
  assert.notEqual(before.sourceFingerprint, after.sourceFingerprint);
  assert.equal(after.demandSourceState, "READY_FULL"); assert.equal(after.state, "BLOCKED");
  assert.ok(pending(after, "DEMAND_PUBLICATION_PENDING")); assert.equal(after.summary.candidateCount, 0);
  assert.equal(build(x).sourceFingerprint, after.sourceFingerprint);
});
test("owner-confirmed reconciliation resolves the exact unassigned line without changing its 200-unit open quantity", () => {
  const unresolved = "UNASSIGNED-202609-001";
  const reserved = stored({ sourceEventId: "unassigned-reserved", barcode: unresolved, status: "RESERVED", requestedQuantity: 200, orderedQuantity: undefined });
  reserved.source_event_id = "persisted-reserved";
  const ordered = stored({ sourceEventId: "unassigned-ordered", barcode: unresolved, status: "ORDERED", requestedQuantity: 200, orderedQuantity: 200, occurredAt: "2026-09-14T00:01:00.000Z" });
  ordered.source_event_id = "persisted-ordered";
  const result = commitments.validateReentryCommitmentRows([reserved, ordered, reconciliation()], Date.parse(now));
  assert.equal(result.invalidEventCount, 0);
  assert.equal(result.totalCommitments, 1);
  assert.equal(result.totalOpenQuantity, 200);
  assert.equal(result.commitments[0].barcode, "BGF1-3");
  assert.equal(result.commitments[0].orderedQuantity, 200);
  assert.equal(result.commitments[0].eventCount, 3);
});
test("identity reconciliation conflicts fail closed instead of picking an arbitrary B-code", () => {
  assert.throws(() => commitments.validateReentryCommitmentRows([
    reconciliation({ sourceEventId: "first", toBarcode: "BGF1-3" }),
    reconciliation({ sourceEventId: "second", toBarcode: "BAA1-1" }),
  ], Date.parse(now)), (error) => error.message === "REENTRY_COMMITMENT_RECONCILIATION_CONFLICT");
});
test("unconfirmed, mismatched, malformed or future reconciliation markers fail closed", () => {
  const invalidRows = [
    reconciliation({ sourceEventId: "unconfirmed", confirmed: false }),
    reconciliation({ sourceEventId: "method", confirmationMethod: "NAME_MATCH_ONLY" }),
    reconciliation({ sourceEventId: "from", fromBarcode: "BAD" }),
    reconciliation({ sourceEventId: "future", confirmedAt: "2026-09-14T02:00:00.000Z" }),
  ];
  const mismatched = reconciliation({ sourceEventId: "mismatch" });
  mismatched.input_snapshot.payload.identityReconciliation.toBarcode = "BAA1-1";
  invalidRows.push(mismatched);
  for (const row of invalidRows) {
    assert.throws(() => commitments.validateReentryCommitmentRows([row], Date.parse(now)), (error) => error.message === "REENTRY_COMMITMENT_RECONCILIATION_INVALID");
  }
});
test("a correction on another source line cannot resolve an unrelated unassigned order", () => {
  const unresolved = stored({ sourceEventId: "unresolved", barcode: "UNASSIGNED-202609-001" });
  unresolved.source_event_id = "persisted-unresolved";
  assert.throws(() => commitments.validateReentryCommitmentRows([
    unresolved,
    reconciliation({ sourceEventId: "other-line", sourceLineId: "different-line" }),
  ], Date.parse(now)), (error) => error.message === "REENTRY_COMMITMENT_RECONCILIATION_SOURCE_MISSING");
});
test("repeating the exact confirmed mapping is quantity-idempotent", () => {
  const unresolved = "UNASSIGNED-202609-001";
  const ordered = stored({ sourceEventId: "unassigned-ordered", barcode: unresolved, orderedQuantity: 200 });
  ordered.source_event_id = "persisted-unassigned";
  const result = commitments.validateReentryCommitmentRows([
    ordered,
    reconciliation({ sourceEventId: "repeat-1" }),
    reconciliation({ sourceEventId: "repeat-2", confirmedAt: "2026-09-14T00:03:00.000Z" }),
  ], Date.parse(now));
  assert.equal(result.totalCommitments, 1);
  assert.equal(result.totalOpenQuantity, 200);
  assert.equal(result.commitments[0].orderedQuantity, 200);
  assert.equal(result.commitments[0].eventCount, 3);
});
test("reconciliation markers cannot alter lifecycle quantity or status", () => {
  const unresolved = stored({ sourceEventId: "base", barcode: "UNASSIGNED-202609-001", status: "ORDERED", requestedQuantity: 200, orderedQuantity: 200 });
  unresolved.source_event_id = "persisted-base";
  const mutations = [
    (row) => { row.input_snapshot.orderedQuantity = 999; },
    (row) => { row.input_snapshot.status = "CANCELLED"; },
    (row) => { row.input_snapshot.status = "RECEIVED"; row.input_snapshot.receivedQuantity = 200; },
  ];
  for (let index = 0; index < mutations.length; index += 1) {
    const row = reconciliation({ sourceEventId: `lifecycle-${index}` });
    mutations[index](row);
    assert.throws(() => commitments.validateReentryCommitmentRows([unresolved, row], Date.parse(now)), (error) => error.message === "REENTRY_COMMITMENT_RECONCILIATION_LIFECYCLE_MISMATCH");
  }
});
test("reconciliation markers cannot carry manual-addition semantics", () => {
  const unresolved = stored({ sourceEventId: "base", barcode: "UNASSIGNED-202609-001", status: "ORDERED", requestedQuantity: 200, orderedQuantity: 200 });
  unresolved.source_event_id = "persisted-base";
  const row = reconciliation({ sourceEventId: "manual-addition" });
  row.input_snapshot.payload.manualAddition = true;
  row.input_snapshot.payload.addedQuantity = 999;
  assert.throws(() => commitments.validateReentryCommitmentRows([unresolved, row], Date.parse(now)), (error) => error.message === "REENTRY_COMMITMENT_RECONCILIATION_LIFECYCLE_FORBIDDEN");
});