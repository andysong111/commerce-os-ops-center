import assert from "node:assert/strict";
import test from "node:test";

import {
  SEO_LISTING_SHADOW_EXPECTED_PROFILES,
  buildSeoListingShadowReconciliationPlan,
  extractSeoRegistrationGoodsKeys,
} from "../src/lib/seoListingLifecycleReconciliation.ts";

const NOW = new Date("2026-10-29T03:00:00.000Z");

function job(overrides = {}) {
  return {
    owner_id: "11111111-1111-1111-1111-111111111111",
    launch_item_id: "launch-1",
    model_number: "AAA001",
    product_name: "테스트 상품",
    run_id: "run-1",
    registration_status: "success",
    registration_payload: { goodsKeys: ["101", "102", "103", "104", "105", "106"] },
    updated_at: "2026-10-28T00:00:00.000Z",
    ...overrides,
  };
}

function ledgers(status = "sent", marketStatus = "sent") {
  return SEO_LISTING_SHADOW_EXPECTED_PROFILES.map((profile, index) => ({
    owner_id: "11111111-1111-1111-1111-111111111111",
    launch_item_id: "launch-1",
    goods_key: String(101 + index),
    profile,
    status,
    market_status: marketStatus,
    title_status: "ok",
    registry_registered_at: "2026-10-27T00:00:00.000Z",
    updated_at: "2026-10-28T00:00:00.000Z",
  }));
}

function launchItem() {
  return {
    owner_id: "11111111-1111-1111-1111-111111111111",
    item_id: "launch-1",
    barcode: "BAA1-1",
    option_barcodes: ["BAA1-1"],
    option_barcode_nos: ["BAA1-1"],
    updated_at: "2026-10-29T02:00:00.000Z",
  };
}

function sale(overrides = {}) {
  return {
    barcode: "BAA1-1",
    last_sale_at: null,
    sales_quantity_365: 0,
    evaluated_at: "2026-10-29T02:30:00.000Z",
    updated_at: "2026-10-29T02:30:00.000Z",
    ...overrides,
  };
}

function statuses(status = "B") {
  return Array.from({ length: 6 }, (_, index) => ({
    goodsKey: String(101 + index),
    state: "READY",
    currentSaleStatus: status,
    updated_at: NOW.toISOString(),
  }));
}

function plan(overrides = {}) {
  return buildSeoListingShadowReconciliationPlan({
    ownerId: "11111111-1111-1111-1111-111111111111",
    jobs: [job()],
    marketLedgerRows: ledgers(),
    launchItems: [launchItem()],
    salesRows: [sale()],
    shoplingStatuses: statuses(),
    now: NOW,
    ...overrides,
  });
}

test("extracts both current and legacy exact Shopling goods key arrays", () => {
  assert.deepEqual(
    extractSeoRegistrationGoodsKeys([
      job(),
      job({
        run_id: "run-2",
        launch_item_id: "launch-2",
        registration_payload: { registeredGoodsKeys: ["201", "202", "bad"] },
      }),
    ]),
    ["101", "102", "103", "104", "105", "106", "201", "202"],
  );
});

test("seeds six LIVE records only after exact pipeline and Shopling selling readback", () => {
  const result = plan();
  assert.equal(result.productsExamined, 1);
  assert.equal(result.productsSeeded, 1);
  assert.equal(result.liveRecordCount, 6);
  assert.equal(result.reviewRecordCount, 0);
  assert.ok(result.records.every((row) => row.attempt_count === 1));
  assert.ok(result.records.every((row) => row.live_started_at === NOW.toISOString()));
  assert.ok(result.records.every((row) => row.exposure_verified === true));
});

test("protects every channel when a verified sale happened after registration", () => {
  const result = plan({
    salesRows: [
      sale({
        last_sale_at: "2026-10-28T12:00:00.000Z",
        sales_quantity_365: 3,
      }),
    ],
  });
  assert.equal(result.protectedRecordCount, 6);
  assert.ok(result.records.every((row) => row.sales_count_during_attempt === 1));
  assert.ok(result.records.every((row) => row.requires_review === false));
});

test("a sold product stays protected but flags a non-selling Shopling readback", () => {
  const result = plan({
    salesRows: [
      sale({
        last_sale_at: "2026-10-28T12:00:00.000Z",
        sales_quantity_365: 1,
      }),
    ],
    shoplingStatuses: statuses("C"),
  });
  assert.equal(result.protectedRecordCount, 6);
  assert.equal(result.reviewRecordCount, 6);
  assert.ok(result.records.every((row) => row.sales_count_during_attempt === 1));
  assert.ok(result.records.every((row) => row.review_reason === "SHOPLING_NOT_SELLING_C"));
});

test("legacy ignored pipeline evidence is fail-closed and consumes no attempt", () => {
  const result = plan({
    marketLedgerRows: ledgers("legacy_ignored", "legacy_ignored"),
  });
  assert.equal(result.reviewRecordCount, 6);
  assert.ok(result.records.every((row) => row.state === "EXCEPTION"));
  assert.ok(result.records.every((row) => row.attempt_count === 0));
  assert.ok(
    result.records.every((row) => row.review_reason === "PIPELINE_REGISTRATION_UNVERIFIED"),
  );
});

test("stale sales evidence keeps registration in review even when Shopling is selling", () => {
  const result = plan({
    salesRows: [
      sale({
        evaluated_at: "2026-10-20T00:00:00.000Z",
        updated_at: "2026-10-20T00:00:00.000Z",
      }),
    ],
  });
  assert.equal(result.reviewRecordCount, 6);
  assert.ok(
    result.records.every((row) => row.review_reason === "SALES_EVIDENCE_MISSING_OR_STALE"),
  );
});

test("existing identities are not overwritten by the bootstrap reconciler", () => {
  const result = plan({
    existingLifecycleRows: SEO_LISTING_SHADOW_EXPECTED_PROFILES.map((profile) => ({
      owner_id: "11111111-1111-1111-1111-111111111111",
      market_account_key: profile,
      launch_item_id: "launch-1",
    })),
  });
  assert.equal(result.productsSkippedExisting, 1);
  assert.deepEqual(result.records, []);
});

test("an incomplete six-channel identity is reported and never guessed", () => {
  const result = plan({ marketLedgerRows: ledgers().slice(0, 5) });
  assert.equal(result.productsNeedingReview, 1);
  assert.deepEqual(result.records, []);
  assert.equal(result.productReviews[0].reason, "REGISTRATION_IDENTITY_INCOMPLETE");
});
