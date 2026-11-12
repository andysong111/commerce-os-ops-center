import assert from "node:assert/strict";
import test from "node:test";

import {
  planSeoDeliveryPreparation,
  planSeoScheduledPortfolioRun,
} from "../src/lib/seoListingScheduledRun.ts";

function product(number) {
  return {
    runId: `run-${number}`,
    launchItemId: `launch-${number}`,
    modelNumber: `AAA${String(number).padStart(3, "0")}`,
    productName: `상품 ${number}`,
    runCreatedAt: "2026-10-28T00:00:00.000Z",
  };
}

function material(number, overrides = {}) {
  return {
    item_id: `material-${number}`,
    model_number: `B${String(number).padStart(3, "0")}`,
    product_name: `재료 상품 ${number}`,
    readiness_ready: true,
    option_barcodes: [`880000000${String(number).padStart(3, "0")}`],
    shopling_upload_status: "미시작",
    archived_at: null,
    updated_at: `2026-10-${String(Math.min(28, number)).padStart(2, "0")}T00:00:00.000Z`,
    summary_payload: {},
    ...overrides,
  };
}

test("delivery preparation fills a 12-product queue and dispatches only today's remaining slots", () => {
  const plan = planSeoDeliveryPreparation({
    productLaunchRows: Array.from({ length: 15 }, (_, index) => material(index + 1)),
    jobHistoryRows: [
      {
        run_id: "seo-run-ready-1",
        launch_item_id: "already-ready-1",
        status: "ready",
        registration_status: "idle",
        run_created_at: "2026-10-28T00:00:00.000Z",
      },
    ],
    lifecycleRows: [],
    scheduledBatchLimit: 3,
    scheduledRegistrationCount: 1,
  });

  assert.equal(plan.materialReadyProductCount, 15);
  assert.equal(plan.currentPreparationInventoryCount, 1);
  assert.equal(plan.queueTargetCount, 12);
  assert.equal(plan.plannedPreparationCount, 11);
  assert.equal(plan.dispatchPreparationCount, 2);
  assert.equal(plan.backlogPreparationCount, 9);
  assert.equal(plan.dailyDispatchCount, 3);
  assert.equal(plan.candidates.filter((row) => row.dispatchToday).length, 2);
});

test("delivery preparation excludes uploaded, previously attempted, lifecycle-managed, isolated, and invalid products", () => {
  const plan = planSeoDeliveryPreparation({
    productLaunchRows: [
      material(1),
      material(2, { shopling_upload_status: "완료" }),
      material(3),
      material(4),
      material(5),
      material(6, {
        summary_payload: { seoExclusion: { excluded: true } },
      }),
      material(7, { option_barcodes: [], barcode: "" }),
      material(8, { readiness_ready: false }),
    ],
    jobHistoryRows: [{ launch_item_id: "material-3", status: "failed" }],
    lifecycleRows: [{ launch_item_id: "material-4", state: "LIVE" }],
    isolatedLaunchItemIds: ["material-5"],
    scheduledBatchLimit: 3,
    scheduledRegistrationCount: 0,
  });

  assert.deepEqual(
    plan.candidates.map((row) => row.launchItemId),
    ["material-1"],
  );
  assert.equal(plan.preparationCandidateCount, 1);
});

test("delivery preparation keeps backlog work internal when dispatch is blocked and stops entirely on schema-policy failure", () => {
  const rows = Array.from({ length: 14 }, (_, index) => material(index + 1));
  const backlogOnly = planSeoDeliveryPreparation({
    productLaunchRows: rows,
    jobHistoryRows: [],
    lifecycleRows: [],
    scheduledBatchLimit: 0,
    scheduledRegistrationCount: 0,
  });
  assert.equal(backlogOnly.plannedPreparationCount, 12);
  assert.equal(backlogOnly.dispatchPreparationCount, 0);
  assert.ok(backlogOnly.candidates.every((row) => row.dispatchToday === false));

  const blocked = planSeoDeliveryPreparation({
    productLaunchRows: rows,
    jobHistoryRows: [],
    lifecycleRows: [],
    scheduledBatchLimit: 3,
    scheduledRegistrationCount: 0,
    systemBlocked: true,
  });
  assert.equal(blocked.plannedPreparationCount, 0);
  assert.equal(blocked.reasonCode, "DELIVERY_PREPARATION_SYSTEM_BLOCKED");
});

function relistRows({
  currentRunId = "run-old",
  nextEligibleAt = "2026-10-27T00:00:00.000Z",
  deleted = true,
  deleteReadbackAt = "2026-07-29T00:00:00.000Z",
} = {}) {
  return Array.from({ length: 6 }, (_, index) => ({
    launch_item_id: "launch-1",
    market_account_key: `market-${index + 1}`,
    goods_key: `old-goods-${index + 1}`,
    current_run_id: currentRunId,
    state: "COOLDOWN",
    attempt_count: 1,
    next_eligible_at: nextEligibleAt,
    sales_count_during_attempt: 0,
    exposure_verified: true,
    evidence: {
      previousListingDeleted: deleted,
      previousListingDeleteReadbackVerifiedAt: deleteReadbackAt,
    },
  }));
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

test("90-day relist enters the fresh six-product-code pipeline only after exact old-code deletion readback", () => {
  const plan = planSeoScheduledPortfolioRun({
    readyProducts: [product(1)],
    lifecycleRows: relistRows(),
    safeBatchCount: 10,
    capacityBlocked: false,
    shoplingProductDbSafeNewProductCount: 10,
    shoplingProductDbBlocked: false,
    now: new Date("2026-10-28T00:00:00.000Z"),
  });
  assert.deepEqual(plan.selectedProducts.map((row) => row.runId), ["run-1"]);
  assert.equal(plan.relistDueCount, 1);
  assert.equal(plan.relistFreshCodeReadyCount, 1);
  assert.equal(plan.relistFreshCodeSelectedCount, 1);
  assert.equal(plan.relistFreshCodeBlockedCount, 0);
  assert.equal(plan.reasonCode, "SCHEDULED_RUN_READY");
});

test("90-day relist fails closed when old deletion readback is missing", () => {
  const plan = planSeoScheduledPortfolioRun({
    readyProducts: [product(1)],
    lifecycleRows: relistRows({ deleted: false, deleteReadbackAt: "" }),
    safeBatchCount: 10,
    capacityBlocked: false,
    shoplingProductDbSafeNewProductCount: 10,
    shoplingProductDbBlocked: false,
    now: new Date("2026-10-28T00:00:00.000Z"),
  });
  assert.deepEqual(plan.selectedProducts, []);
  assert.equal(plan.relistFreshCodeReadyCount, 0);
  assert.equal(plan.relistFreshCodeBlockedCount, 1);
  assert.equal(plan.reasonCode, "RELIST_FRESH_CODE_PREPARATION_REQUIRED");
});

test("90-day relist rejects the previous SEO RUN and a RUN created before cooldown ended", () => {
  const previousRun = {
    ...product(1),
    runId: "run-old",
  };
  const earlyRun = {
    ...product(1),
    runCreatedAt: "2026-10-26T23:59:59.000Z",
  };
  for (const readyProduct of [previousRun, earlyRun]) {
    const plan = planSeoScheduledPortfolioRun({
      readyProducts: [readyProduct],
      lifecycleRows: relistRows(),
      safeBatchCount: 10,
      capacityBlocked: false,
      shoplingProductDbSafeNewProductCount: 10,
      shoplingProductDbBlocked: false,
      now: new Date("2026-10-28T00:00:00.000Z"),
    });
    assert.deepEqual(plan.selectedProducts, []);
    assert.equal(plan.reasonCode, "RELIST_FRESH_CODE_PREPARATION_REQUIRED");
  }
});

test("fresh-code relist still needs six Shopling slots plus the configured safety reserve", () => {
  const plan = planSeoScheduledPortfolioRun({
    readyProducts: [product(1)],
    lifecycleRows: relistRows(),
    safeBatchCount: 10,
    capacityBlocked: false,
    shoplingProductDbSafeNewProductCount: 0,
    shoplingProductDbBlocked: true,
    shoplingProductDbReasonCode: "SHOPLING_PRODUCT_DB_AT_OR_OVER_LIMIT",
    now: new Date("2026-10-28T00:00:00.000Z"),
  });
  assert.deepEqual(plan.selectedProducts, []);
  assert.equal(plan.relistFreshCodeReadyCount, 1);
  assert.equal(plan.relistFreshCodeSelectedCount, 0);
  assert.equal(plan.reasonCode, "SHOPLING_PRODUCT_DB_AT_OR_OVER_LIMIT");
});
