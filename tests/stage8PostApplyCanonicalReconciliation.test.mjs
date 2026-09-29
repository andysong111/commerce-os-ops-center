import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, page, candidate, audit, sales] = await Promise.all([
  readFile("src/lib/stage8PostApplyCanonicalReconciliation.ts", "utf8"),
  readFile("src/app/stage8-postapply-canonical-reconciliation/page.tsx", "utf8"),
  readFile("src/lib/stage8CandidateDemandParity.ts", "utf8"),
  readFile("src/lib/productMasterCanonicalSalesAudit.ts", "utf8"),
  readFile("src/lib/productMasterShoplingSalesEventSync.ts", "utf8"),
]);

test("reconciliation is pinned to the completed candidate request and fingerprints", () => {
  assert.match(engine, /salesStatus\.state !== "COMPLETED"/);
  assert.match(engine, /candidate\.salesRequestId === salesStatus\.requestId/);
  assert.match(engine, /salesStatus\.report\.planFingerprint === candidate\.planFingerprint/);
  assert.match(engine, /salesStatus\.report\.eventFingerprint === candidate\.eventFingerprint/);
  assert.match(engine, /planning\.contentFingerprint === candidate\.planningContentFingerprint/);
  assert.match(engine, /persisted\.analysisAsOf === candidate\.analysisAsOf/);
});

test("persisted event accounting must match the promoted candidate exactly", () => {
  assert.match(engine, /persisted\.sourceEventCount === candidate\.report\.sourceEventCount/);
  assert.match(engine, /persisted\.validEventCount \+ persisted\.inactiveManagedValidEventCount/);
  assert.match(engine, /persisted\.tombstoneCount \+ persisted\.inactiveManagedTombstoneCount/);
  assert.match(engine, /persisted\.classificationComplete && persisted\.orphanEventCount === 0/);
});

test("active demand arrays must match candidate 12x30 buckets exactly", () => {
  assert.match(engine, /buildCandidateRollingRows/);
  assert.match(engine, /arraysEqual\([\s\S]*candidateRow\.monthlyUnits[\s\S]*persistedRow\.monthlyUnits/);
  assert.match(engine, /arraysEqual\([\s\S]*candidateRow\.monthlyRevenue[\s\S]*persistedRow\.monthlyRevenue/);
  assert.match(engine, /validEventMatch/);
  assert.match(engine, /rowMismatchCount === 0/);
  assert.match(engine, /missingPersistedBarcodes\.length === 0/);
});

test("extra persisted active SKUs are allowed only when they carry no sales demand", () => {
  assert.match(engine, /persistedRowIsZero/);
  assert.match(engine, /extraPersistedNonZeroCount === 0/);
  assert.match(page, /판매 배열과 이벤트수가 모두 0일 때만 허용/);
});

test("the exact FULL operation evidence must prove all candidate rows were written", () => {
  assert.match(engine, /SALES_EVENT_FULL/);
  assert.match(engine, /output\.verified === true/);
  assert.match(engine, /selected === expectedRows/);
  assert.match(engine, /written === expectedRows/);
  assert.match(engine, /output\.snapshotFinalized === true/);
  assert.match(engine, /snapshotActiveRows === expectedRows/);
  assert.match(engine, /fullApply\.verified/);
  assert.match(page, /FULL 검증 write/);
});

test("reconciliation is read-only and does not fall back to legacy direct parity", () => {
  assert.doesNotMatch(engine, /ShoplingReadClient|applyProductMasterShoplingSalesEvents|postProductMasterEvents|calculateProductDecisionPlan/);
  assert.match(page, /읽기 전용/);
  assert.match(page, /Legacy 직접집계가 놓친 BAB3-1/);
  assert.match(candidate, /buildCandidateRollingRows/);
  assert.match(audit, /loadProductMasterCanonicalSalesAudit/);
  assert.match(sales, /SALES_EVENT_FULL/);
});


test("blocked extra persisted SKUs expose planning state and nonzero demand evidence", () => {
  assert.match(engine, /extraPersistedDiagnostics/);
  assert.match(engine, /persistedHasDemand/);
  assert.match(engine, /planningMatchCount/);
  assert.match(engine, /activePlanningMatchCount/);
  assert.match(engine, /ALL_PLANNING_ROWS_INACTIVE/);
  assert.match(engine, /DUPLICATE_ACTIVE_PLANNING_ROWS/);
  assert.match(engine, /UNKNOWN_CANDIDATE_INDEX_EXCLUSION/);
  assert.match(page, /Candidate에 없는 Persisted active SKU 진단/);
  assert.match(page, /Candidate 제외 이유/);
});
