import assert from "node:assert/strict";
import test from "node:test";

import { planSeoScheduledPortfolioRun } from "../src/lib/seoListingScheduledRun.ts";

function product(number) {
  return {
    runId: `run-${number}`,
    launchItemId: `launch-${number}`,
    modelNumber: `AAA${String(number).padStart(3, "0")}`,
    productName: `상품 ${number}`,
    runCreatedAt: "2026-10-28T00:00:00.000Z",
  };
}

test("scheduled run selects only lifecycle-safe products within the smallest market capacity", () => {
  const plan = planSeoScheduledPortfolioRun({
    readyProducts: [product(1), product(2), product(3)],
    lifecycleRows: [
      {
        launch_item_id: "launch-2",
        state: "PROTECTED",
        attempt_count: 1,
        sales_count_during_attempt: 1,
      },
    ],
    safeBatchCount: 1,
    capacityBlocked: false,
    now: new Date("2026-10-28T00:00:00.000Z"),
  });
  assert.deepEqual(plan.selectedProducts.map((row) => row.runId), ["run-1"]);
  assert.equal(plan.eligibleRegistrationCount, 2);
  assert.equal(plan.excludedByLifecycleCount, 1);
  assert.equal(plan.limitedByCapacityCount, 1);
  assert.equal(plan.protectedProductCount, 1);
});

test("unknown or stale market capacity fails closed without consuming lifecycle attempts", () => {
  const plan = planSeoScheduledPortfolioRun({
    readyProducts: [product(1)],
    lifecycleRows: [],
    safeBatchCount: 10,
    capacityBlocked: true,
  });
  assert.deepEqual(plan.selectedProducts, []);
  assert.equal(plan.reasonCode, "MARKET_CAPACITY_BLOCKED");
  assert.equal(plan.eligibleRegistrationCount, 1);
});

test("explicit registration-only fallback selects at most three products while deletion remains outside the plan", () => {
  const plan = planSeoScheduledPortfolioRun({
    readyProducts: [product(1), product(2), product(3), product(4)],
    lifecycleRows: [],
    safeBatchCount: 0,
    capacityBlocked: true,
    allowBoundedRegistrationWithoutCapacity: true,
    fallbackBatchCount: 99,
  });
  assert.deepEqual(
    plan.selectedProducts.map((row) => row.runId),
    ["run-1", "run-2", "run-3"],
  );
  assert.equal(plan.capacityFallbackActive, true);
  assert.equal(plan.blocked, false);
  assert.equal(plan.reasonCode, "REGISTRATION_ONLY_FALLBACK_READY");
  assert.equal(plan.limitedByCapacityCount, 1);
});

test("verified 60-day no-sale exposure is reported as deletion due but never auto-selected for registration", () => {
  const plan = planSeoScheduledPortfolioRun({
    readyProducts: [product(1)],
    lifecycleRows: [
      {
        launch_item_id: "launch-1",
        state: "LIVE",
        attempt_count: 1,
        live_started_at: "2026-08-29T00:00:00.000Z",
        last_verified_live_at: "2026-10-28T00:00:00.000Z",
        sales_count_during_attempt: 0,
        exposure_verified: true,
      },
    ],
    safeBatchCount: 10,
    capacityBlocked: false,
    now: new Date("2026-10-28T00:00:00.000Z"),
  });
  assert.equal(plan.soldOutDeleteDueCount, 1);
  assert.deepEqual(plan.selectedProducts, []);
});

test("Shopling product DB limit overrides the three-product market fallback", () => {
  const plan = planSeoScheduledPortfolioRun({
    readyProducts: [product(1), product(2), product(3)],
    lifecycleRows: [],
    safeBatchCount: 0,
    capacityBlocked: true,
    allowBoundedRegistrationWithoutCapacity: true,
    shoplingProductDbSafeNewProductCount: 0,
    shoplingProductDbBlocked: true,
    shoplingProductDbReasonCode: "SHOPLING_PRODUCT_DB_AT_OR_OVER_LIMIT",
  });
  assert.deepEqual(plan.selectedProducts, []);
  assert.equal(plan.capacityFallbackActive, false);
  assert.equal(plan.blocked, true);
  assert.equal(plan.reasonCode, "SHOPLING_PRODUCT_DB_AT_OR_OVER_LIMIT");
});

test("Shopling product DB safe product count is the final registration cap", () => {
  const plan = planSeoScheduledPortfolioRun({
    readyProducts: [product(1), product(2), product(3), product(4)],
    lifecycleRows: [],
    safeBatchCount: 10,
    capacityBlocked: false,
    shoplingProductDbSafeNewProductCount: 2,
    shoplingProductDbBlocked: false,
  });
  assert.deepEqual(
    plan.selectedProducts.map((row) => row.runId),
    ["run-1", "run-2"],
  );
  assert.equal(plan.limitedByCapacityCount, 2);
  assert.equal(plan.reasonCode, "SCHEDULED_RUN_READY");
});

test("90-day relist never enters the six-new-product-code pipeline", () => {
  const plan = planSeoScheduledPortfolioRun({
    readyProducts: [product(1)],
    lifecycleRows: [
      {
        launch_item_id: "launch-1",
        state: "COOLDOWN",
        attempt_count: 1,
        next_eligible_at: "2026-10-27T00:00:00.000Z",
        sales_count_during_attempt: 0,
        exposure_verified: true,
      },
    ],
    safeBatchCount: 10,
    capacityBlocked: false,
    shoplingProductDbSafeNewProductCount: 10,
    shoplingProductDbBlocked: false,
    now: new Date("2026-10-28T00:00:00.000Z"),
  });
  assert.deepEqual(plan.selectedProducts, []);
  assert.equal(plan.relistDueCount, 1);
  assert.equal(plan.relistReuseOnlyCount, 1);
  assert.equal(plan.reasonCode, "RELIST_REUSE_PIPELINE_PENDING");
});
