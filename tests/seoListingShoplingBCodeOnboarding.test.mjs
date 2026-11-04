import assert from "node:assert/strict";
import test from "node:test";

import {
  SEO_LISTING_SHOPLING_BCODE_ONBOARDING_SOURCE,
  buildSeoListingShoplingAuditPopulationSummary,
  buildSeoListingShoplingBCodeOnboardingPlan,
  extractShoplingBCodeCatalogGoodsKeys,
  selectSeoListingShoplingBCodeAuditLifecycleRows,
} from "../src/lib/seoListingShoplingBCodeOnboarding.ts";
import { SEO_LISTING_LEGACY_ONBOARDING_SOURCE } from "../src/lib/seoListingLegacyOnboarding.ts";
import { SEO_LISTING_SHADOW_EXPECTED_PROFILES } from "../src/lib/seoListingLifecycleReconciliation.ts";

const OWNER = "11111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-10-31T08:00:00.000Z");
const SUFFIXES = ["a", "b", "c", "d", "e", "f"];

function item(id = "item-1", overrides = {}) {
  return {
    owner_id: OWNER,
    item_id: id,
    model_number: id === "item-1" ? "AAA900" : "AAA901",
    product_name: id === "item-1" ? "현재 상품" : "다른 상품",
    archived_at: null,
    updated_at: "2026-10-30T00:00:00.000Z",
    ...overrides,
  };
}

function options(id = "item-1", codes = ["BAA1-1", "BAA1-2"]) {
  return codes.map((barcode, index) => ({
    owner_id: OWNER,
    item_id: id,
    option_id: `${id}-option-${index + 1}`,
    barcode,
  }));
}

function catalog(overrides = {}) {
  return SUFFIXES.flatMap((suffix, index) =>
    ["BAA1-1", "BAA1-2"].map((bCode, optionIndex) => ({
      goods_key: String(9001 + index),
      ptn_goods_cd: `SEO20261031${suffix}`,
      sale_status: "B",
      optPtnOptCd: bCode,
      optBarcode: String(123456789000 + index * 10 + optionIndex),
      ...overrides,
    })),
  );
}

function ledger() {
  return SEO_LISTING_SHADOW_EXPECTED_PROFILES.map((profile, index) => ({
    owner_id: OWNER,
    goods_key: String(9001 + index),
    launch_item_id: "item-1",
    profile,
    status: "sent",
    market_status: "sent",
    updated_at: "2026-10-30T00:00:00.000Z",
  }));
}

function build(overrides = {}) {
  return buildSeoListingShoplingBCodeOnboardingPlan({
    ownerId: OWNER,
    catalogRows: catalog(),
    launchItems: [item()],
    launchOptions: options(),
    marketLedgerRows: ledger(),
    now: NOW,
    ...overrides,
  });
}

test("integrity audit scope includes only legacy and B-code onboarding records", () => {
  const rows = [
    {
      launch_item_id: "legacy-managed",
      evidence: { source: SEO_LISTING_LEGACY_ONBOARDING_SOURCE },
    },
    {
      launch_item_id: "bcode",
      evidence: { source: SEO_LISTING_SHOPLING_BCODE_ONBOARDING_SOURCE },
    },
    {
      launch_item_id: "legacy-review",
      evidence: { source: SEO_LISTING_LEGACY_ONBOARDING_SOURCE },
    },
    {
      launch_item_id: "legacy-review",
      evidence: {
        source: SEO_LISTING_LEGACY_ONBOARDING_SOURCE,
        legacyOnboarding: true,
      },
    },
    {
      launch_item_id: "unrelated-shadow",
      evidence: { source: "seo-listing-shadow-bootstrap-v1" },
    },
    { launch_item_id: "unknown", evidence: {} },
  ];
  assert.deepEqual(
    selectSeoListingShoplingBCodeAuditLifecycleRows(rows).map(
      (row) => row.launch_item_id,
    ),
    ["legacy-managed", "bcode"],
  );
});

test("integrity audit population explains source, state, and initial review verdicts", () => {
  const rows = [
    {
      launch_item_id: "legacy-current",
      goods_key: "9001",
      state: "LIVE",
      requires_review: false,
      review_reason: "",
      evidence: { source: SEO_LISTING_LEGACY_ONBOARDING_SOURCE },
    },
    {
      launch_item_id: "legacy-current",
      goods_key: "9002",
      state: "LIVE",
      requires_review: false,
      review_reason: "",
      evidence: { source: SEO_LISTING_LEGACY_ONBOARDING_SOURCE },
    },
    {
      launch_item_id: "bcode-review",
      goods_key: "9101",
      state: "EXCEPTION",
      requires_review: true,
      review_reason: "BCODE_SHOPLING_PROFILE_AMBIGUOUS",
      evidence: { source: SEO_LISTING_SHOPLING_BCODE_ONBOARDING_SOURCE },
    },
  ];
  assert.deepEqual(buildSeoListingShoplingAuditPopulationSummary(rows), {
    rowCount: 3,
    productCount: 2,
    goodsKeyCount: 3,
    sources: [
      {
        key: SEO_LISTING_LEGACY_ONBOARDING_SOURCE,
        rowCount: 2,
        productCount: 1,
        goodsKeyCount: 2,
      },
      {
        key: SEO_LISTING_SHOPLING_BCODE_ONBOARDING_SOURCE,
        rowCount: 1,
        productCount: 1,
        goodsKeyCount: 1,
      },
    ],
    states: [
      { key: "EXCEPTION", rowCount: 1, productCount: 1, goodsKeyCount: 1 },
      { key: "LIVE", rowCount: 2, productCount: 1, goodsKeyCount: 2 },
    ],
    reviewReasons: [
      {
        key: "BCODE_SHOPLING_PROFILE_AMBIGUOUS",
        rowCount: 1,
        productCount: 1,
        goodsKeyCount: 1,
      },
      { key: "NO_REVIEW", rowCount: 2, productCount: 1, goodsKeyCount: 2 },
    ],
    sourceStates: [
      {
        key: `${SEO_LISTING_LEGACY_ONBOARDING_SOURCE}:LIVE`,
        rowCount: 2,
        productCount: 1,
        goodsKeyCount: 2,
      },
      {
        key: `${SEO_LISTING_SHOPLING_BCODE_ONBOARDING_SOURCE}:EXCEPTION`,
        rowCount: 1,
        productCount: 1,
        goodsKeyCount: 1,
      },
    ],
  });
});

test("prepares exactly one six-profile current Shopling set for verification", () => {
  const result = build();
  assert.equal(result.source, SEO_LISTING_SHOPLING_BCODE_ONBOARDING_SOURCE);
  assert.equal(result.productsExamined, 1);
  assert.equal(result.productsMatchedCurrentShopling, 1);
  assert.equal(result.productsPreparedForVerification, 1);
  assert.equal(result.productsNeedingReview, 0);
  assert.equal(result.syntheticJobs.length, 1);
  assert.deepEqual(result.syntheticJobs[0].registration_payload.goodsKeys, [
    "9001",
    "9002",
    "9003",
    "9004",
    "9005",
    "9006",
  ]);
});

test("uses the official product-group field for legacy codes without a-f suffixes", () => {
  const directGroups = catalog().map((row) => ({
    ...row,
    ptn_goods_cd: "LEGACY",
    prod_group: `${
      SEO_LISTING_SHADOW_EXPECTED_PROFILES[Number(row.goods_key) - 9001]
    }번`,
  }));
  const result = build({ catalogRows: directGroups });
  assert.equal(result.productsPreparedForVerification, 1);
  assert.equal(result.productsNeedingReview, 0);
});

test("uses optPtnOptCd only and never mistakes numeric option barcode for a B-code", () => {
  const numericOnly = catalog().map((row) => ({
    ...row,
    optPtnOptCd: row.optBarcode,
    optBarcode: "BAA1-1",
  }));
  assert.deepEqual(extractShoplingBCodeCatalogGoodsKeys(numericOnly), []);
  const result = build({ catalogRows: numericOnly });
  assert.equal(result.productsMatchedCurrentShopling, 0);
  assert.equal(result.productsUnmatchedCurrentShopling, 1);
  assert.equal(result.syntheticJobs.length, 0);
  assert.equal(result.exceptionRecords.length, 0);
});

test("a listing with both a B-code and an invalid partner option code is quarantined", () => {
  const mixed = [
    ...catalog(),
    {
      goods_key: "9001",
      ptn_goods_cd: "SEO20261031a",
      sale_status: "B",
      optPtnOptCd: "123456789012",
      optBarcode: "123456789012",
    },
  ];
  const result = build({ catalogRows: mixed });
  assert.equal(result.syntheticJobs.length, 0);
  assert.equal(result.unresolvedCatalogGoodsKeyCount, 1);
  assert.equal(
    result.productReviews[0].reason,
    "BCODE_SHOPLING_IDENTITY_CONFLICT",
  );
  assert.deepEqual(result.productReviews[0].details, [
    "BCODE_INVALID_PARTNER_OPTION_CODE",
  ]);
});

test("conflicting partner product codes on one goods key are quarantined", () => {
  const conflicting = catalog().map((row, index) =>
    row.goods_key === "9001" && index === 1
      ? { ...row, ptn_goods_cd: "OTHERBASEa" }
      : row,
  );
  const result = build({ catalogRows: conflicting });
  assert.equal(result.syntheticJobs.length, 0);
  assert.equal(result.unresolvedCatalogGoodsKeyCount, 1);
  assert.equal(
    result.productReviews[0].reason,
    "BCODE_SHOPLING_IDENTITY_CONFLICT",
  );
  assert.deepEqual(result.productReviews[0].details, [
    "BCODE_PARTNER_PRODUCT_CODE_CONFLICT",
  ]);
});

test("a partial six-profile set is onboarded as six fail-closed review rows", () => {
  const partial = catalog().filter((row) => row.goods_key !== "9006");
  const result = build({ catalogRows: partial });
  assert.equal(result.productsPreparedForVerification, 0);
  assert.equal(result.productsNeedingReview, 1);
  assert.equal(result.exceptionRecords.length, 6);
  assert.ok(result.exceptionRecords.every((row) => row.state === "EXCEPTION"));
  assert.ok(result.exceptionRecords.every((row) => row.attempt_count === 0));
  assert.ok(result.exceptionRecords.every((row) => row.evidence.externalMarketWrite === false));
  assert.ok(
    result.exceptionRecords.every(
      (row) =>
        row.review_reason === "BCODE_SHOPLING_SIX_PROFILE_SET_INCOMPLETE",
    ),
  );
});

test("a duplicate profile cannot choose an arbitrary goods key", () => {
  const duplicate = [
    ...catalog(),
    ...catalog()
      .filter((row) => row.goods_key === "9001")
      .map((row) => ({ ...row, goods_key: "9999" })),
  ];
  const result = build({ catalogRows: duplicate });
  assert.equal(result.syntheticJobs.length, 0);
  assert.equal(result.productReviews[0].reason, "BCODE_SHOPLING_PROFILE_AMBIGUOUS");
  assert.equal(
    result.exceptionRecords.find((row) => row.market_account_key === "도매1")
      ?.goods_key,
    "",
  );
});

test("a B-code shared by two launch items is quarantined instead of auto-mapped", () => {
  const result = build({
    launchItems: [item(), item("item-2")],
    launchOptions: [
      ...options(),
      ...options("item-2", ["BAA1-1"]),
    ],
  });
  assert.equal(result.syntheticJobs.length, 0);
  assert.equal(result.productsNeedingReview, 2);
  assert.ok(
    result.productReviews.every(
      (row) => row.reason === "BCODE_SHOPLING_IDENTITY_CONFLICT",
    ),
  );
  assert.ok(
    result.productReviews.every((row) =>
      row.details?.includes("BCODE_LAUNCH_ITEM_MAPPING_CONFLICT"),
    ),
  );
});

test("missing market pipeline identity stays in review with attempt zero", () => {
  const result = build({ marketLedgerRows: [] });
  assert.equal(result.syntheticJobs.length, 0);
  assert.equal(result.exceptionRecords.length, 6);
  assert.ok(
    result.exceptionRecords.every(
      (row) =>
        row.review_reason === "BCODE_MARKET_PIPELINE_IDENTITY_INCOMPLETE",
    ),
  );
});

test("market ledger profiles must match the catalog profile for each goods key", () => {
  const swapped = ledger();
  [swapped[0].profile, swapped[1].profile] = [
    swapped[1].profile,
    swapped[0].profile,
  ];
  const result = build({ marketLedgerRows: swapped });
  assert.equal(result.syntheticJobs.length, 0);
  assert.equal(result.productsNeedingReview, 1);
  assert.equal(
    result.productReviews[0].reason,
    "BCODE_MARKET_PIPELINE_IDENTITY_INCOMPLETE",
  );
});

test("deleted-only Shopling codes are evidence, not current managed listings", () => {
  const result = build({ catalogRows: catalog({ sale_status: "Z" }) });
  assert.equal(result.deletedCatalogGoodsKeyCount, 6);
  assert.equal(result.productsMatchedCurrentShopling, 0);
  assert.equal(result.productsUnmatchedCurrentShopling, 1);
  assert.equal(result.exceptionRecords.length, 0);
});

test("a complete existing lifecycle identity is idempotently skipped", () => {
  const existingLifecycleRows = SEO_LISTING_SHADOW_EXPECTED_PROFILES.map(
    (profile) => ({
      owner_id: OWNER,
      launch_item_id: "item-1",
      market_account_key: profile,
    }),
  );
  const result = build({ existingLifecycleRows });
  assert.equal(result.productsSkippedExisting, 1);
  assert.equal(result.syntheticJobs.length, 0);
  assert.equal(result.exceptionRecords.length, 0);
});

test("read-only integrity audit rechecks an existing six-profile lifecycle set", () => {
  const existingLifecycleRows = SEO_LISTING_SHADOW_EXPECTED_PROFILES.map(
    (profile, index) => ({
      owner_id: OWNER,
      launch_item_id: "item-1",
      market_account_key: profile,
      goods_key: String(9001 + index),
    }),
  );
  const result = build({ existingLifecycleRows, auditExisting: true });
  assert.equal(result.productsSkippedExisting, 0);
  assert.equal(result.productsAuditedExisting, 1);
  assert.equal(result.productsPassingExistingAudit, 1);
  assert.equal(result.productsFailingExistingAudit, 0);
  assert.equal(result.productsPreparedForVerification, 1);
  assert.equal(result.syntheticJobs.length, 1);
  assert.equal(result.productsNeedingReview, 0);
});

test("read-only integrity audit reports a persisted profile-to-goods-key mismatch", () => {
  const existingLifecycleRows = SEO_LISTING_SHADOW_EXPECTED_PROFILES.map(
    (profile, index) => ({
      owner_id: OWNER,
      launch_item_id: "item-1",
      market_account_key: profile,
      goods_key: String(9001 + index),
    }),
  );
  [existingLifecycleRows[0].goods_key, existingLifecycleRows[1].goods_key] = [
    existingLifecycleRows[1].goods_key,
    existingLifecycleRows[0].goods_key,
  ];
  const result = build({ existingLifecycleRows, auditExisting: true });
  assert.equal(result.productsAuditedExisting, 1);
  assert.equal(result.productsPassingExistingAudit, 0);
  assert.equal(result.productsFailingExistingAudit, 1);
  assert.equal(result.syntheticJobs.length, 0);
  assert.equal(
    result.productReviews[0].reason,
    "BCODE_EXISTING_LIFECYCLE_IDENTITY_MISMATCH",
  );
  assert.equal(result.exceptionRecords.length, 0);
});

test("read-only integrity audit excludes products that were never onboarded", () => {
  const result = build({ existingLifecycleRows: [], auditExisting: true });
  assert.equal(result.productsAuditedExisting, 0);
  assert.equal(result.productsPreparedForVerification, 0);
  assert.equal(result.syntheticJobs.length, 0);
  assert.equal(result.productsNeedingReview, 0);
});

test("read-only integrity audit fails closed when persisted product B-code options disappeared", () => {
  const existingLifecycleRows = SEO_LISTING_SHADOW_EXPECTED_PROFILES.map(
    (profile, index) => ({
      owner_id: OWNER,
      launch_item_id: "item-1",
      market_account_key: profile,
      goods_key: String(9001 + index),
    }),
  );
  const result = build({
    existingLifecycleRows,
    launchOptions: [],
    auditExisting: true,
  });
  assert.equal(result.productsExamined, 1);
  assert.equal(result.productsAuditedExisting, 1);
  assert.equal(result.productsPassingExistingAudit, 0);
  assert.equal(result.productsFailingExistingAudit, 1);
  assert.equal(result.productsNeedingReview, 1);
  assert.equal(
    result.productReviews[0].reason,
    "BCODE_LAUNCH_OPTION_BCODE_MISSING",
  );
});

test("read-only integrity audit fails closed when persisted launch item disappeared", () => {
  const existingLifecycleRows = SEO_LISTING_SHADOW_EXPECTED_PROFILES.map(
    (profile, index) => ({
      owner_id: OWNER,
      launch_item_id: "missing-item",
      market_account_key: profile,
      goods_key: String(9001 + index),
    }),
  );
  const result = build({
    existingLifecycleRows,
    auditExisting: true,
  });
  assert.equal(result.productsExamined, 1);
  assert.equal(result.productsAuditedExisting, 1);
  assert.equal(result.productsPassingExistingAudit, 0);
  assert.equal(result.productsFailingExistingAudit, 1);
  assert.equal(result.productsNeedingReview, 1);
  assert.equal(
    result.productReviews[0].reason,
    "BCODE_LAUNCH_ITEM_MISSING",
  );
});

test("read-only integrity audit fails closed when an existing product vanished from the current catalog", () => {
  const existingLifecycleRows = SEO_LISTING_SHADOW_EXPECTED_PROFILES.map(
    (profile, index) => ({
      owner_id: OWNER,
      launch_item_id: "item-1",
      market_account_key: profile,
      goods_key: String(9001 + index),
    }),
  );
  const result = build({
    catalogRows: [],
    existingLifecycleRows,
    auditExisting: true,
  });
  assert.equal(result.productsAuditedExisting, 1);
  assert.equal(result.productsPassingExistingAudit, 0);
  assert.equal(result.productsFailingExistingAudit, 1);
  assert.equal(result.syntheticJobs.length, 0);
  assert.equal(
    result.productReviews[0].reason,
    "BCODE_SHOPLING_CURRENT_CATALOG_MISSING",
  );
});
