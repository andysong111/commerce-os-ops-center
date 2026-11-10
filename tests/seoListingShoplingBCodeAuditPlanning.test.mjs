import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSeoListingBCodeAuditPlans,
  seoListingBCodeAuditFingerprint,
} from "../src/lib/seoListingShoplingBCodeAuditPlanning.ts";
import { SEO_LISTING_SHADOW_EXPECTED_PROFILES } from "../src/lib/seoListingLifecycleReconciliation.ts";

const OWNER = "11111111-1111-1111-1111-111111111111";
const SUFFIXES = ["a", "b", "c", "d", "e", "f"];

function lifecycle(launchItemId = "item-1", start = 9001) {
  return SEO_LISTING_SHADOW_EXPECTED_PROFILES.map((profile, index) => ({
    owner_id: OWNER,
    launch_item_id: launchItemId,
    market_account_key: profile,
    goods_key: String(start + index),
    state: "LIVE",
    requires_review: false,
  }));
}

function catalog(launchBCode = "BAA1-1", start = 9001) {
  return SUFFIXES.map((suffix, index) => ({
    goods_key: String(start + index),
    ptn_goods_cd: `SEO20261110${suffix}`,
    prod_group: `${SEO_LISTING_SHADOW_EXPECTED_PROFILES[index]}번`,
    sale_status: "B",
    optPtnOptCd: launchBCode,
  }));
}

function ledger(launchItemId = "item-1", start = 9001) {
  return SEO_LISTING_SHADOW_EXPECTED_PROFILES.map((profile, index) => ({
    owner_id: OWNER,
    goods_key: String(start + index),
    launch_item_id: launchItemId,
    profile,
    status: "sent",
    title_status: "ready",
    market_status: "sent",
    updated_at: "2026-11-10T00:00:00.000Z",
  }));
}

function build(overrides = {}) {
  return buildSeoListingBCodeAuditPlans({
    ownerId: OWNER,
    generatedAt: "2026-11-10T01:00:00.000Z",
    passingJobs: [
      {
        launch_item_id: "item-1",
        model_number: "AAA900",
        product_name: "감사 상품",
        registration_payload: {
          goodsKeys: SUFFIXES.map((_, index) => String(9001 + index)),
        },
      },
    ],
    productReviews: [],
    existingLifecycleRows: lifecycle(),
    catalogRows: catalog(),
    marketLedgerRows: ledger(),
    launchItems: [
      {
        item_id: "item-1",
        model_number: "AAA900",
        product_name: "감사 상품",
      },
    ],
    launchOptions: [{ item_id: "item-1", barcode: "BAA1-1" }],
    ...overrides,
  });
}

test("48-pass receipt design pins exact lifecycle catalog and market identities without a write", () => {
  const result = build();
  assert.equal(result.auditReceipts.complete, true);
  assert.equal(result.auditReceipts.receiptCount, 1);
  assert.equal(result.auditReceipts.holdCount, 0);
  assert.equal(result.auditReceipts.persistenceApplied, false);
  const receipt = result.auditReceipts.receipts[0];
  assert.equal(receipt.bindings.length, 6);
  assert.equal(receipt.internalWriteApplied, false);
  assert.equal(receipt.externalMarketWrite, false);
  const semantic = { ...receipt };
  delete semantic.observedAt;
  delete semantic.fingerprint;
  delete semantic.internalWriteApplied;
  delete semantic.externalMarketWrite;
  assert.equal(receipt.fingerprint, seoListingBCodeAuditFingerprint(semantic));
});

test("receipt fingerprint stays stable across row order and observation time", () => {
  const first = build();
  const second = build({
    generatedAt: "2026-11-11T01:00:00.000Z",
    existingLifecycleRows: [...lifecycle()].reverse(),
    catalogRows: [...catalog()].reverse(),
    marketLedgerRows: [...ledger()].reverse(),
  });
  assert.equal(
    first.auditReceipts.receipts[0].fingerprint,
    second.auditReceipts.receipts[0].fingerprint,
  );
  assert.equal(
    first.auditReceipts.receiptSetFingerprint,
    second.auditReceipts.receiptSetFingerprint,
  );
});

test("receipt preview fails closed when a previously passing market identity drifts", () => {
  const changed = ledger();
  changed[0] = { ...changed[0], profile: "소매2" };
  const result = build({ marketLedgerRows: changed });
  assert.equal(result.auditReceipts.complete, false);
  assert.equal(result.auditReceipts.receiptCount, 0);
  assert.equal(result.auditReceipts.holdCount, 1);
  assert.equal(result.auditReceipts.holds[0].reason, "AUDIT_RECEIPT_EVIDENCE_DRIFT");
});

test("missing old goods keys are isolation-ready only when no current product reuses them", () => {
  const missingReview = [
    {
      launchItemId: "old-item",
      modelNumber: "AAA100",
      reason: "BCODE_SHOPLING_CURRENT_CATALOG_MISSING",
    },
  ];
  const ready = build({
    passingJobs: [],
    productReviews: missingReview,
    existingLifecycleRows: lifecycle("old-item", 8001),
    catalogRows: [],
    marketLedgerRows: [],
  });
  assert.equal(ready.isolationPlan.readyCount, 1);
  assert.equal(
    ready.isolationPlan.products[0].disposition,
    "INTERNAL_ISOLATION_READY",
  );
  assert.equal(ready.isolationPlan.internalWriteApplied, false);

  const reused = build({
    passingJobs: [],
    productReviews: missingReview,
    existingLifecycleRows: lifecycle("old-item", 8001),
    catalogRows: catalog("BAA1-1", 8001),
    marketLedgerRows: [],
  });
  assert.equal(reused.isolationPlan.readyCount, 0);
  assert.equal(reused.isolationPlan.holdCount, 1);
  assert.equal(reused.isolationPlan.products[0].disposition, "HOLD_FOR_REVIEW");
  assert.deepEqual(reused.isolationPlan.products[0].overlapLaunchItemIds, ["item-1"]);
});

test("market-ledger recovery candidate requires six exact persisted and current bindings", () => {
  const reviews = [
    {
      launchItemId: "item-1",
      modelNumber: "AAA900",
      reason: "BCODE_MARKET_PIPELINE_IDENTITY_INCOMPLETE",
    },
  ];
  const ready = build({
    passingJobs: [],
    productReviews: reviews,
    marketLedgerRows: [],
  });
  assert.equal(ready.marketLedgerRecoveryPlan.readyCount, 1);
  assert.equal(
    ready.marketLedgerRecoveryPlan.products[0].disposition,
    "INTERNAL_MARKET_LEDGER_RECOVERY_CANDIDATE",
  );
  assert.equal(ready.marketLedgerRecoveryPlan.internalWriteApplied, false);

  const incomplete = build({
    passingJobs: [],
    productReviews: reviews,
    existingLifecycleRows: lifecycle().slice(0, 5),
    marketLedgerRows: [],
  });
  assert.equal(incomplete.marketLedgerRecoveryPlan.readyCount, 0);
  assert.equal(incomplete.marketLedgerRecoveryPlan.holdCount, 1);
});
