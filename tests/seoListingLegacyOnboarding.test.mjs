import assert from "node:assert/strict";
import test from "node:test";

import {
  SEO_LISTING_LEGACY_ONBOARDING_SOURCE,
  buildSeoListingLegacyOnboardingPlan,
  extractLegacyCurrentGoodsKeys,
} from "../src/lib/seoListingLegacyOnboarding.ts";
import {
  SEO_LISTING_SHADOW_EXPECTED_PROFILES,
  buildSeoListingShadowReconciliationPlan,
} from "../src/lib/seoListingLifecycleReconciliation.ts";

const OWNER = "11111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-10-30T08:00:00.000Z");
const CHANNELS = [
  "wholesale1",
  "wholesale2",
  "wholesale3",
  "wholesale4",
  "retail1",
  "retail2",
];

function item(overrides = {}) {
  return {
    owner_id: OWNER,
    item_id: "legacy-1",
    model_number: "AAA900",
    product_name: "과거 등록상품",
    barcode: "BAA9-1",
    option_barcodes: ["BAA9-1"],
    option_barcode_nos: ["BAA9-1"],
    item_payload: {
      shoplingProducts: Object.fromEntries(
        CHANNELS.map((channel, index) => [
          channel,
          {
            status: "success",
            goodsKey: String(9001 + index),
            registeredAt: "2026-09-01T00:00:00.000Z",
          },
        ]),
      ),
    },
    updated_at: "2026-10-29T00:00:00.000Z",
    ...overrides,
  };
}

function registryRows() {
  return [
    ...SEO_LISTING_SHADOW_EXPECTED_PROFILES.map((profile, index) => ({
      owner_id: OWNER,
      launch_item_id: "legacy-1",
      model_number: "AAA900",
      goods_key: String(9001 + index),
      product_group_label: profile,
      updated_at: "2026-10-29T00:00:00.000Z",
    })),
    {
      owner_id: OWNER,
      launch_item_id: "legacy-1",
      model_number: "AAA900",
      goods_key: "1111",
      product_group_label: "도매1",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  ];
}

function ledgerRows(status = "sent", marketStatus = "sent") {
  return SEO_LISTING_SHADOW_EXPECTED_PROFILES.map((profile, index) => ({
    owner_id: OWNER,
    launch_item_id: "legacy-1",
    model_number: "AAA900",
    goods_key: String(9001 + index),
    profile,
    status,
    market_status: marketStatus,
    title_status: "ok",
    registry_registered_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-10-29T00:00:00.000Z",
  }));
}

function build(overrides = {}) {
  return buildSeoListingLegacyOnboardingPlan({
    ownerId: OWNER,
    registryRows: registryRows(),
    launchItems: [item()],
    marketLedgerRows: ledgerRows(),
    now: NOW,
    ...overrides,
  });
}

test("uses only the six current item identities and ignores historical registry keys", () => {
  assert.deepEqual(extractLegacyCurrentGoodsKeys([item()]), [
    "9001",
    "9002",
    "9003",
    "9004",
    "9005",
    "9006",
  ]);
  const result = build();
  assert.equal(result.productsExamined, 1);
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
  assert.equal(
    result.syntheticJobs[0].reconciliation_source,
    SEO_LISTING_LEGACY_ONBOARDING_SOURCE,
  );
});

test("an incomplete current identity becomes six fail-closed review rows", () => {
  const incomplete = item();
  delete incomplete.item_payload.shoplingProducts.retail2;
  const result = build({ launchItems: [incomplete] });
  assert.equal(result.productsPreparedForVerification, 0);
  assert.equal(result.productsNeedingReview, 1);
  assert.equal(result.syntheticJobs.length, 0);
  assert.equal(result.exceptionRecords.length, 6);
  assert.ok(result.exceptionRecords.every((row) => row.state === "EXCEPTION"));
  assert.ok(result.exceptionRecords.every((row) => row.attempt_count === 0));
  assert.ok(result.exceptionRecords.every((row) => row.live_started_at === null));
  assert.ok(
    result.exceptionRecords.every(
      (row) => row.review_reason === "LEGACY_CURRENT_IDENTITY_INCOMPLETE",
    ),
  );
  assert.ok(
    result.exceptionRecords.every(
      (row) => row.evidence.externalMarketWrite === false,
    ),
  );
});

test("a complete existing six-channel lifecycle is idempotently skipped", () => {
  const existingLifecycleRows = SEO_LISTING_SHADOW_EXPECTED_PROFILES.map(
    (profile) => ({
      owner_id: OWNER,
      launch_item_id: "legacy-1",
      market_account_key: profile,
    }),
  );
  const result = build({ existingLifecycleRows });
  assert.equal(result.productsSkippedExisting, 1);
  assert.equal(result.syntheticJobs.length, 0);
  assert.equal(result.exceptionRecords.length, 0);
});

test("verified legacy identities start at day zero only after fresh live readback", () => {
  const legacy = build();
  const result = buildSeoListingShadowReconciliationPlan({
    ownerId: OWNER,
    jobs: legacy.syntheticJobs,
    marketLedgerRows: ledgerRows(),
    launchItems: [item()],
    salesRows: [
      {
        barcode: "BAA9-1",
        last_sale_at: null,
        sales_quantity_365: 0,
        evaluated_at: "2026-10-30T07:30:00.000Z",
        updated_at: "2026-10-30T07:30:00.000Z",
      },
    ],
    shoplingStatuses: Array.from({ length: 6 }, (_, index) => ({
      goodsKey: String(9001 + index),
      state: "READY",
      currentSaleStatus: "B",
      updated_at: NOW.toISOString(),
    })),
    now: NOW,
  });
  assert.equal(result.liveRecordCount, 6);
  assert.ok(result.records.every((row) => row.live_started_at === NOW.toISOString()));
  assert.ok(
    result.records.every(
      (row) => row.evidence.source === SEO_LISTING_LEGACY_ONBOARDING_SOURCE,
    ),
  );
  assert.ok(
    result.records.every((row) => row.evidence.externalMarketWrite === false),
  );
});
