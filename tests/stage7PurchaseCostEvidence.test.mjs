import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  stage7PurchaseCostCandidates,
  stage7PurchaseCostCoverage,
  verifiedPurchaseCostReady,
} from "../src/lib/verifiedPurchaseCostEvidence.ts";

const [readiness, page, priority, preflight] = await Promise.all([
  readFile("src/lib/stage7PurchaseCostEvidenceReadiness.ts", "utf8"),
  readFile("src/app/stage7-purchase-cost-evidence/page.tsx", "utf8"),
  readFile("src/lib/stage8InventoryVerificationPriority.ts", "utf8"),
  readFile("src/lib/purchaseCyclePreflightCore.ts", "utf8"),
]);

const NOW = Date.parse("2026-09-18T02:00:00.000Z");

function legacy(overrides = {}) {
  return {
    purchaseStatus: "발주 추천",
    hasVerifiedPurchaseCost: true,
    purchaseCostTrustSource: "LEGACY_VERIFIED_COST_EVIDENCE",
    verifiedPurchaseUnitCostKrw: 1200,
    purchaseProtectedCostKrw: 1300,
    verifiedPurchaseCostAt: "2026-09-01T00:00:00.000Z",
    hasConfirmedReceiptCost: false,
    latestConfirmedReceiptCostKrw: 0,
    purchaseCostEvidenceCount: 1,
    ...overrides,
  };
}

function receipt(overrides = {}) {
  return {
    purchaseStatus: "발주 추천",
    hasVerifiedPurchaseCost: true,
    purchaseCostTrustSource: "CONFIRMED_RECEIPT",
    verifiedPurchaseUnitCostKrw: 1400,
    purchaseProtectedCostKrw: 1500,
    verifiedPurchaseCostAt: "2026-09-02T00:00:00.000Z",
    hasConfirmedReceiptCost: true,
    latestConfirmedReceiptCostKrw: 1400,
    purchaseCostEvidenceCount: 0,
    ...overrides,
  };
}

test("stage7 full candidate coverage is READY", () => {
  const report = stage7PurchaseCostCoverage(
    "READY",
    [legacy(), receipt()],
    NOW,
  );
  assert.deepEqual(report, {
    state: "READY",
    candidateCount: 2,
    verifiedCount: 2,
    missingCount: 0,
  });
});

test("stage7 with no purchase recommendation is WAITING", () => {
  const rows = [legacy({ purchaseStatus: "발주 보류" })];
  assert.equal(stage7PurchaseCostCandidates(rows).length, 0);
  assert.deepEqual(stage7PurchaseCostCoverage("READY", rows, NOW), {
    state: "WAITING",
    candidateCount: 0,
    verifiedCount: 0,
    missingCount: 0,
  });
});

test("stage7 partial candidate coverage is BLOCKED", () => {
  const report = stage7PurchaseCostCoverage(
    "READY",
    [legacy(), legacy({ hasVerifiedPurchaseCost: false })],
    NOW,
  );
  assert.deepEqual(report, {
    state: "BLOCKED",
    candidateCount: 2,
    verifiedCount: 1,
    missingCount: 1,
  });
});

test("stage7 remains BLOCKED when structural priority is blocked", () => {
  const report = stage7PurchaseCostCoverage("BLOCKED", [legacy()], NOW);
  assert.equal(report.state, "BLOCKED");
  assert.equal(report.verifiedCount, 1);
});

for (const [name, row] of [
  ["unverified source", legacy({ purchaseCostTrustSource: "UNVERIFIED" })],
  ["zero unit cost", legacy({ verifiedPurchaseUnitCostKrw: 0 })],
  ["unsafe unit cost", legacy({ verifiedPurchaseUnitCostKrw: Number.MAX_SAFE_INTEGER })],
  ["protected below unit", legacy({ purchaseProtectedCostKrw: 1199 })],
  ["negative protected cost", legacy({ purchaseProtectedCostKrw: -1 })],
  ["missing evidence date", legacy({ verifiedPurchaseCostAt: null })],
  ["future evidence date", legacy({ verifiedPurchaseCostAt: "2026-09-19T00:00:00.000Z" })],
  ["no purchase evidence rows", legacy({ purchaseCostEvidenceCount: 0 })],
  ["purchase-only evidence mislabeled as receipt", legacy({ hasConfirmedReceiptCost: true })],
  ["receipt unit mismatch", receipt({ latestConfirmedReceiptCostKrw: 1399 })],
  ["receipt without receipt truth", receipt({ hasConfirmedReceiptCost: false })],
]) {
  test(`malformed verified-cost contract stays BLOCKED: ${name}`, () => {
    assert.equal(verifiedPurchaseCostReady(row, NOW), false);
    const report = stage7PurchaseCostCoverage("READY", [row], NOW);
    assert.deepEqual(report, {
      state: "BLOCKED",
      candidateCount: 1,
      verifiedCount: 0,
      missingCount: 1,
    });
  });
}

test("non-candidate malformed rows do not contaminate Stage 7 coverage", () => {
  const report = stage7PurchaseCostCoverage(
    "READY",
    [
      legacy(),
      legacy({
        purchaseStatus: "발주 보류",
        hasVerifiedPurchaseCost: true,
        purchaseCostTrustSource: "UNVERIFIED",
      }),
    ],
    NOW,
  );
  assert.deepEqual(report, {
    state: "READY",
    candidateCount: 1,
    verifiedCount: 1,
    missingCount: 0,
  });
});

test("stage7 loader reuses the shared validator and candidate selector", () => {
  assert.match(readiness, /stage7PurchaseCostCandidates/);
  assert.match(readiness, /stage7PurchaseCostCoverage/);
  assert.match(readiness, /verifiedPurchaseCostReady/);
  assert.doesNotMatch(
    readiness,
    /stage8LegacyVerifiedCostEvidence|readPriceAdjustmentReceiptCache/,
  );
});

test("legacy purchase-only evidence can satisfy cost gate without becoming receipt truth", () => {
  assert.match(priority, /verifiedPurchaseCostReady/);
  assert.match(preflight, /row\.hasVerifiedPurchaseCost === true/);
  assert.match(preflight, /purchaseCostTrustSource/);
  assert.match(preflight, /verifiedPurchaseUnitCostKrw/);
  assert.match(preflight, /verifiedPurchaseCostAt/);
  assert.match(
    page,
    /확정입고원가와 별도 검증된 구매전용 원가근거/,
  );
});

test("stage7 remains read-only and cannot mutate price inventory receipt or orders", () => {
  assert.match(readiness, /businessWritesEnabled: false/);
  assert.match(readiness, /priceWritesEnabled: false/);
  assert.match(readiness, /inventoryWritesEnabled: false/);
  assert.match(readiness, /receiptWritesEnabled: false/);
  assert.doesNotMatch(
    `${readiness}\n${page}`,
    /method:\s*["']POST["']|upsertRows|insert\(|update\(|delete\(|rpc\(/,
  );
});
