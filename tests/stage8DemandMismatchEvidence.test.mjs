import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, workflow, page, api, cron, parity] = await Promise.all([
  readFile("src/lib/stage8DemandMismatchEvidenceEngine.ts", "utf8"),
  readFile("src/lib/stage8DemandMismatchEvidence.ts", "utf8"),
  readFile("src/app/stage8-demand-mismatch-evidence/page.tsx", "utf8"),
  readFile("src/app/api/stage8/demand-mismatch-evidence/route.ts", "utf8"),
  readFile("src/app/api/cron/stage8-canonical-demand-parity/route.ts", "utf8"),
  readFile("src/lib/stage8CanonicalDemandParity.ts", "utf8"),
]);

test("evidence compiler sends the same raw Shopling row through canonical and legacy resolvers", () => {
  assert.match(engine, /aggregateProductMasterShoplingSalesEventChunk\([\s\S]*\[raw\]/);
  assert.match(engine, /aggregateShoplingOrderChunk\([\s\S]*\[raw\]/);
  assert.match(engine, /LEGACY_SKU_DIFFERS_FROM_CANONICAL/);
  assert.match(engine, /LEGACY_ACCEPTS_CANONICAL_IGNORES/);
  assert.match(engine, /CANONICAL_ONLY_LEGACY_UNMAPPED/);
  assert.match(engine, /unitDeltaLegacyMinusCanonical/);
  assert.match(engine, /revenueDeltaLegacyMinusCanonical/);
});

test("canonical target rows cannot be dropped by the fast raw-identity prefilter", () => {
  assert.match(engine, /const canonicalTargetExternalIds = new Set\(/);
  assert.match(
    engine,
    /aggregateProductMasterShoplingSalesEventChunk\(rows, planning, range,[\s\S]*targets\.barcodes\.has\(event\.barcode\)/,
  );
  assert.match(engine, /\.map\(\(event\) => event\.externalId\)/);
  assert.match(
    engine,
    /!candidateRow\(raw, targets\) &&[\s\S]*!canonicalTargetExternalIds\.has\(order\.id\)/,
  );
});

test("evidence preserves the unfiltered actual option barcode and raw identity fields", () => {
  assert.match(engine, /rawOptionBarcodeText/);
  assert.match(engine, /rawOptionBarcodeStructured/);
  assert.match(engine, /rawOptionBarcodeManaged/);
  assert.match(engine, /rawMallOrderCount/);
  assert.match(engine, /rawQuantity/);
  assert.match(engine, /rawPartnerCode/);
  assert.match(engine, /optionId/);
  assert.match(engine, /productId/);
  assert.match(engine, /mallProductKey/);
  assert.match(page, /원본 옵션바코드/);
});

test("legacy-only rows expose the exact canonical date preflight before managed scope", () => {
  assert.match(engine, /sourceRangeStart/);
  assert.match(engine, /sourceRangeEnd/);
  assert.match(engine, /rawIDt/);
  assert.match(engine, /orderedLocalDate/);
  assert.match(engine, /canonicalUtcOrderedDate/);
  assert.match(engine, /canonicalDateInsideFetchRange/);
  assert.match(engine, /CANONICAL_ORDER_DATE_OUTSIDE_FETCH_RANGE/);
  assert.match(engine, /if \(!canonicalDateInsideFetchRange\)/);
  assert.match(engine, /canonicalScopeProbe/);
  assert.match(engine, /canonicalScopeWouldBeManaged/);
  assert.match(engine, /canonicalScopeDecisionPath/);
  assert.match(engine, /CANONICAL_MANAGED_SCOPE_FALSE/);
  assert.match(page, /Shopling 조회구간/);
  assert.match(page, /mall_ord_dt/);
  assert.match(page, /i_dt/);
  assert.match(page, /Canonical 범위판정/);
});

test("legacy-only rows prove whether canonical excluded a structured non-managed option code", () => {
  assert.match(engine, /const STRUCTURED_BARCODE = \/\^\[A-Z\]\{3\}/);
  assert.match(engine, /CANONICAL_EXCLUDES_STRUCTURED_NON_MANAGED_OPTION_BARCODE/);
  assert.match(engine, /STRUCTURED_BARCODE\.test\(rawActualOptionBarcode\)/);
  assert.match(engine, /!MANAGED_BARCODE\.test\(rawActualOptionBarcode\)/);
  assert.match(page, /실제 옵션바코드가 비관리 구조코드라 Canonical이 의도적으로 제외/);
});

test("canonical-only legacy-unmapped rows distinguish inactive historical SKU support", () => {
  assert.match(engine, /inactiveManagedBarcodes/);
  assert.match(engine, /product\.skuActive === false/);
  assert.match(engine, /CANONICAL_HISTORICAL_BARCODE_LEGACY_ACTIVE_ONLY/);
  assert.match(engine, /LEGACY_ACTIVE_IDENTITY_MISSING/);
  assert.match(page, /비활성 관리 SKU 역사 바코드를 보존하지만 기존 직접집계는 활성 SKU만 조회/);
});

test("final evidence report aggregates reason counts and reason deltas", () => {
  assert.match(engine, /reasonCounts/);
  assert.match(engine, /reasonUnitDelta/);
  assert.match(engine, /reasonRevenueDelta/);
  assert.match(engine, /reasonUnitDelta\[row\.reason\]/);
  assert.match(engine, /reasonRevenueDelta\[row\.reason\]/);
  assert.match(page, /결정적 원인 분류/);
});

test("evidence request is pinned to the completed parity fingerprints and refuses planning drift", () => {
  assert.match(workflow, /parity\.state !== "MISMATCH"/);
  assert.match(workflow, /planning\.contentFingerprint !== parity\.report\.planningContentFingerprint/);
  assert.match(workflow, /DEMAND_MISMATCH_EVIDENCE_PLANNING_CHANGED_RERUN_PARITY/);
  assert.match(workflow, /canonicalContentFingerprint: parity\.report\.canonicalContentFingerprint/);
  assert.match(workflow, /parityFingerprint: parity\.report\.parityFingerprint/);
  assert.match(workflow, /analysisAsOf: asOf\.toISOString\(\)/);
  assert.match(parity, /mismatchSamples/);
});

test("worker is business-read-only: Shopling GET plus Ops evidence ledger only", () => {
  assert.match(workflow, /new ShoplingReadClient\(config\)\.read\("orders"/);
  assert.match(workflow, /commerce_operation_runs/);
  assert.doesNotMatch(workflow, /applyProductMasterShoplingSalesEvents|calculateProductDecisionPlan|inventory_movements|sku_receipt_costs|1688/i);
  assert.doesNotMatch(cron, /applyProductMasterShoplingSalesEvents|calculateProductDecisionPlan/);
  assert.match(page, /발주·가격·재고·입고원가·단종은 변경하지 않습니다/);
});

test("data-heavy evidence ranges get a bounded long function window", () => {
  assert.match(api, /export const maxDuration = 300/);
  assert.match(cron, /export const maxDuration = 300/);
});

test("existing Stage8 parity cron automatically hands terminal mismatch into evidence collection", () => {
  assert.match(cron, /CRON_SECRET/);
  assert.match(cron, /current\.state === "MISMATCH"/);
  assert.match(cron, /continueMismatchEvidence/);
  assert.match(cron, /createDemandMismatchEvidenceRequest/);
  assert.match(cron, /runDemandMismatchEvidenceStep/);
  assert.match(cron, /PARITY_REQUEUED/);
  assert.match(api, /isSameOriginOpsRequest/);
  assert.match(api, /run-next/);
  assert.match(api, /createDemandMismatchEvidenceRequest/);
  assert.match(workflow, /MAX_STEP_ATTEMPTS = 3/);
});
