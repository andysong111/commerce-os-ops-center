import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [gate, directGate, route, page, parity, evidence] = await Promise.all([
  readFile("src/lib/stage8CandidatePromotionGate.ts", "utf8"),
  readFile("src/lib/salesEventDirectPromotionGate.ts", "utf8"),
  readFile("src/app/api/product-master/shopling-sales-events/route.ts", "utf8"),
  readFile("src/app/stage8-candidate-promotion-gate/page.tsx", "utf8"),
  readFile("src/lib/stage8CandidateDemandParity.ts", "utf8"),
  readFile("src/lib/stage8CandidateMismatchEvidence.ts", "utf8"),
]);

test("promotion gate pins current sales candidate, parity, and evidence fingerprints", () => {
  assert.match(gate, /loadProductMasterShoplingSalesEventSyncStatus/);
  assert.match(gate, /loadLatestCandidateSalesSnapshot/);
  assert.match(gate, /loadCandidateDemandParityStatus/);
  assert.match(gate, /loadCandidateMismatchEvidenceStatus/);
  assert.match(gate, /candidateSalesRequestId/);
  assert.match(gate, /candidatePlanFingerprint/);
  assert.match(gate, /candidateEventFingerprint/);
  assert.match(gate, /candidateParityFingerprint/);
  assert.match(gate, /evidenceFingerprint/);
  assert.match(gate, /promotionFingerprint/);
});

test("exact same-time parity can promote without mismatch evidence", () => {
  assert.match(gate, /parity\.state === "MATCH"/);
  assert.match(gate, /state: "EXACT_MATCH"/);
  assert.match(gate, /safeToApply: true/);
});

test("safe canonical superset is much stricter than net-positive totals", () => {
  assert.match(gate, /unitMismatchCount !== report\.revenueMismatchCount/);
  assert.match(gate, /unitMismatchCount !== report\.mismatchSamples\.length/);
  assert.match(gate, /candidateUnits\.every/);
  assert.match(gate, /candidateRevenue\.every/);
  assert.match(gate, /missingDirectCount === 0/);
  assert.match(gate, /directOnlyManagedCount === 0/);
  assert.match(gate, /candidateMinusDirectUnits >= 0/);
  assert.match(gate, /candidateMinusDirectRevenue >= 0/);
});

test("only candidate-only identity advantages are allowed", () => {
  assert.match(gate, /CANONICAL_ONLY_LEGACY_IGNORES/);
  assert.match(gate, /CANONICAL_ONLY_LEGACY_UNMAPPED/);
  assert.match(gate, /CANONICAL_HISTORICAL_BARCODE_LEGACY_ACTIVE_ONLY/);
  assert.match(gate, /LEGACY_ACTIVE_IDENTITY_MISSING/);
  assert.match(gate, /countOutsideAllowed/);
  assert.match(gate, /forbiddenCategoryCount === 0/);
  assert.match(gate, /forbiddenReasonCount === 0/);
  assert.match(gate, /truncatedEvidenceRows === 0/);
});

test("evidence deltas must exactly reconcile the aggregate candidate parity delta", () => {
  assert.match(gate, /evidenceUnitDelta === -parityReport\.candidateMinusDirectUnits/);
  assert.match(gate, /evidenceRevenueDelta === -parityReport\.candidateMinusDirectRevenue/);
  assert.match(gate, /sameStrings\(evidenceRequest\.targetBarcodes, expectedMismatchTargets\(parityReport\)\)/);
});

test("sales-event canary and full use the clean-candidate plus canary gate", () => {
  assert.match(route, /loadSalesEventDirectPromotionGate\(action\)/);
  assert.match(route, /!promotionGate\.safeToApply/);
  assert.match(route, /promotionGate\.candidatePlanFingerprint !== planFingerprint/);
  assert.match(route, /SALES_EVENT_PREWRITE_PROMOTION_GATE_BLOCKED/);
  assert.match(route, /promotionGate\.promotionFingerprint/);
  assert.match(page, /PRODUCT MASTER WRITE 차단/);
  assert.match(page, /판매 이벤트 API가 409로 차단/);
  assert.match(directGate, /report!\.unmappedRows === 0/);
  assert.match(directGate, /report!\.identityConflictCount === 0/);
  assert.match(directGate, /mode === "canary" \|\| status\.canaryVerified/);
  assert.doesNotMatch(directGate, /loadCandidateDemandParityStatus|loadCandidateMismatchEvidenceStatus/);
});

test("candidate parity and evidence remain read-only upstream inputs", () => {
  assert.doesNotMatch(parity, /applyProductMasterShoplingSalesEvents/);
  assert.doesNotMatch(evidence, /applyProductMasterShoplingSalesEvents/);
  assert.doesNotMatch(gate, /postProductMasterEvents|inventory_movements|sku_receipt_costs|1688/i);
});
