import assert from "node:assert/strict";
import test from "node:test";

import {
  selectLatestSeoReadyProducts,
  summarizeSeoListingCanaryReadiness,
  summarizeSeoRegistrationOutcomes,
  summarizeSeoListingLifecycle,
  summarizeSeoVerifiedExposureProgress,
} from "../src/lib/seoListingAutomationDashboard.ts";

function job(overrides = {}) {
  return {
    run_id: "seo-run-00000001",
    launch_item_id: "launch-1",
    model_number: "AAA001",
    product_name: "테스트 상품",
    status: "ready",
    registration_status: "idle",
    run_created_at: "2026-10-15T00:00:00.000Z",
    created_at: "2026-10-15T00:00:00.000Z",
    ...overrides,
  };
}

test("only the latest RUN per canonical product can enter the ready pool", () => {
  const ready = selectLatestSeoReadyProducts([
    job({ run_id: "seo-run-old00001", run_created_at: "2026-10-14T00:00:00.000Z" }),
    job({ run_id: "seo-run-new00001", run_created_at: "2026-10-15T00:00:00.000Z" }),
  ]);
  assert.equal(ready.length, 1);
  assert.equal(ready[0].runId, "seo-run-new00001");
});

test("a newer active or completed RUN prevents an older idle RUN from being auto-selected", () => {
  for (const registrationStatus of ["queued", "running", "success"]) {
    const ready = selectLatestSeoReadyProducts([
      job({ run_id: `seo-run-old-${registrationStatus}`, run_created_at: "2026-10-14T00:00:00.000Z" }),
      job({
        run_id: `seo-run-new-${registrationStatus}`,
        run_created_at: "2026-10-15T00:00:00.000Z",
        registration_status: registrationStatus,
      }),
    ]);
    assert.deepEqual(ready, []);
  }
});

test("lifecycle summary ignores malformed states but retains review count", () => {
  const summary = summarizeSeoListingLifecycle([
    { state: "LIVE", requires_review: false },
    { state: "LIVE", requires_review: true },
    { state: "UNKNOWN", requires_review: true },
  ]);
  assert.equal(summary.counts.LIVE, 2);
  assert.equal(summary.counts.EXCEPTION, 0);
  assert.equal(summary.requiresReviewCount, 2);
});

test("verified exposure progress counts one product once across market listings", () => {
  const summary = summarizeSeoVerifiedExposureProgress([
    {
      launch_item_id: "launch-1",
      state: "LIVE",
      evidence: { verifiedExposureDays: 12 },
    },
    {
      launch_item_id: "launch-1",
      state: "LIVE",
      evidence: { verifiedExposureDays: 55 },
    },
    {
      launch_item_id: "launch-2",
      state: "LIVE",
      evidence: { verifiedExposureDays: 31 },
    },
  ]);
  assert.deepEqual(summary, {
    trackedProductCount: 2,
    maxVerifiedExposureDays: 55,
    dueSoonProductCount: 1,
    progressBands: {
      days0To29: 0,
      days30To49: 1,
      days50To59: 1,
      days60Plus: 0,
    },
  });
});

test("verified exposure progress ignores protected products and treats malformed evidence as zero", () => {
  const summary = summarizeSeoVerifiedExposureProgress([
    {
      launch_item_id: "launch-protected",
      state: "PROTECTED",
      evidence: { verifiedExposureDays: 59 },
    },
    {
      launch_item_id: "launch-live",
      state: "LIVE",
      evidence: { verifiedExposureDays: "invalid" },
    },
    {
      launch_item_id: "",
      state: "LIVE",
      evidence: { verifiedExposureDays: 60 },
    },
  ]);
  assert.equal(summary.trackedProductCount, 1);
  assert.equal(summary.maxVerifiedExposureDays, 0);
  assert.equal(summary.progressBands.days0To29, 1);
  assert.equal(summary.dueSoonProductCount, 0);
});

function lifecycleCanaryRow(overrides = {}) {
  return {
    id: "record-1",
    launch_item_id: "launch-1",
    market_account_key: "market-1",
    model_number: "AAA001",
    product_name: "시험 상품",
    goods_key: "goods-1",
    current_run_id: "run-canary-1",
    last_verified_live_at: "2026-12-28T02:30:00.000Z",
    state: "LIVE",
    exposure_verified: true,
    requires_review: false,
    sales_count_during_attempt: 0,
    evidence: {
      verifiedExposureDays: 60,
      shoplingSaleStatus: "B",
      externalMarketWrite: false,
    },
    ...overrides,
  };
}

function canaryAction(actionType, overrides = {}) {
  const lifecycleRecordId = overrides.lifecycle_record_id ?? "record-1";
  return {
    id: `action-${actionType}`,
    lifecycle_record_id: lifecycleRecordId,
    market_account_key: "market-1",
    launch_item_id: "launch-1",
    run_id: "run-canary-1",
    goods_key: "goods-1",
    action_type: actionType,
    status: "shadow",
    shadow_mode: true,
    dedupe_key: `${lifecycleRecordId}-${actionType}`,
    scheduled_for: "2026-12-28T02:00:00.000Z",
    evidence: { externalMarketWrite: false },
    ...overrides,
  };
}

const CANARY_OPTIONS = {
  exposureDays: 60,
  requiredMarketListingCount: 2,
  readbackMaxAgeHours: 24,
  now: new Date("2026-12-28T03:00:00.000Z"),
};

test("canary readiness selects one complete product without enabling external writes", () => {
  const summary = summarizeSeoListingCanaryReadiness(
    [
      lifecycleCanaryRow(),
      lifecycleCanaryRow({
        id: "record-2",
        market_account_key: "market-2",
        goods_key: "goods-2",
      }),
    ],
    [
      canaryAction("SOLD_OUT"),
      canaryAction("DELETE"),
      canaryAction("SOLD_OUT", {
        id: "action-2-sold-out",
        lifecycle_record_id: "record-2",
        market_account_key: "market-2",
        goods_key: "goods-2",
      }),
      canaryAction("DELETE", {
        id: "action-2-delete",
        lifecycle_record_id: "record-2",
        market_account_key: "market-2",
        goods_key: "goods-2",
      }),
    ],
    CANARY_OPTIONS,
  );
  assert.equal(summary.dueProductCount, 1);
  assert.equal(summary.readyProductCount, 1);
  assert.equal(summary.blockedProductCount, 0);
  assert.equal(summary.selectedCandidate?.marketListingCount, 2);
  assert.equal(summary.selectedCandidate?.actionCount, 4);
  assert.equal(summary.selectedCandidate?.dedupeKeyCount, 4);
  assert.equal(summary.approvalRequired, true);
  assert.equal(summary.externalMarketWrite, false);
  assert.equal(summary.executionLocked, true);
  assert.equal(summary.autoRetryOnUncertain, false);
  assert.equal(summary.recoveryMode, "STOP_AND_CONFIRM_READBACK");
  assert.deepEqual(summary.executionSteps, [
    "RECHECK_LIVE_AND_ZERO_SALES",
    "SOLD_OUT",
    "VERIFY_SOLD_OUT_READBACK",
    "DELETE",
    "VERIFY_DELETE_READBACK",
  ]);
});

test("canary readiness fails closed when one market action pair is incomplete", () => {
  const summary = summarizeSeoListingCanaryReadiness(
    [lifecycleCanaryRow()],
    [canaryAction("SOLD_OUT")],
    { ...CANARY_OPTIONS, requiredMarketListingCount: 1 },
  );
  assert.equal(summary.dueProductCount, 1);
  assert.equal(summary.readyProductCount, 0);
  assert.equal(summary.blockedProductCount, 1);
  assert.equal(summary.selectedCandidate, null);
});

test("canary readiness fails closed on malformed sales or scheduling evidence", () => {
  const malformedSales = summarizeSeoListingCanaryReadiness(
    [lifecycleCanaryRow({ sales_count_during_attempt: "" })],
    [canaryAction("SOLD_OUT"), canaryAction("DELETE")],
    { ...CANARY_OPTIONS, requiredMarketListingCount: 1 },
  );
  assert.equal(malformedSales.dueProductCount, 0);

  const missingSchedule = summarizeSeoListingCanaryReadiness(
    [lifecycleCanaryRow()],
    [
      canaryAction("SOLD_OUT"),
      canaryAction("DELETE", { scheduled_for: null }),
    ],
    { ...CANARY_OPTIONS, requiredMarketListingCount: 1 },
  );
  assert.equal(missingSchedule.dueProductCount, 1);
  assert.equal(missingSchedule.readyProductCount, 0);
  assert.equal(missingSchedule.blockedProductCount, 1);
});

test("canary readiness excludes products with sales or review flags", () => {
  const summary = summarizeSeoListingCanaryReadiness(
    [
      lifecycleCanaryRow({ sales_count_during_attempt: 1 }),
      lifecycleCanaryRow({
        id: "record-2",
        launch_item_id: "launch-2",
        requires_review: true,
      }),
    ],
    [canaryAction("SOLD_OUT"), canaryAction("DELETE")],
    { ...CANARY_OPTIONS, requiredMarketListingCount: 1 },
  );
  assert.equal(summary.dueProductCount, 0);
  assert.equal(summary.readyProductCount, 0);
});

test("canary readiness requires six exact market listings in production mode", () => {
  const incomplete = summarizeSeoListingCanaryReadiness(
    [lifecycleCanaryRow()],
    [canaryAction("SOLD_OUT"), canaryAction("DELETE")],
    {
      exposureDays: 60,
      requiredMarketListingCount: 6,
      readbackMaxAgeHours: 24,
      now: CANARY_OPTIONS.now,
    },
  );
  assert.equal(incomplete.readyProductCount, 0);
  assert.equal(
    incomplete.blockingReasonCounts.MARKET_LISTING_COUNT_MISMATCH,
    1,
  );
});

test("canary readiness blocks stale readback and active or uncertain work", () => {
  const summary = summarizeSeoListingCanaryReadiness(
    [
      lifecycleCanaryRow({
        last_verified_live_at: "2026-12-26T00:00:00.000Z",
      }),
    ],
    [
      canaryAction("SOLD_OUT"),
      canaryAction("DELETE"),
      canaryAction("DELETE", {
        id: "active-delete",
        status: "confirm_needed",
        shadow_mode: false,
        dedupe_key: "active-delete-key",
      }),
    ],
    { ...CANARY_OPTIONS, requiredMarketListingCount: 1 },
  );
  assert.equal(summary.readyProductCount, 0);
  assert.equal(summary.blockedProductCount, 1);
  assert.equal(summary.blockingReasonCounts.LIVE_READBACK_MISSING_OR_STALE, 1);
  assert.equal(
    summary.blockingReasonCounts.ACTIVE_OR_UNCERTAIN_ACTION_EXISTS,
    1,
  );
});

test("canary readiness blocks duplicated idempotency keys", () => {
  const summary = summarizeSeoListingCanaryReadiness(
    [lifecycleCanaryRow()],
    [
      canaryAction("SOLD_OUT", { dedupe_key: "same-key" }),
      canaryAction("DELETE", { dedupe_key: "same-key" }),
    ],
    { ...CANARY_OPTIONS, requiredMarketListingCount: 1 },
  );
  assert.equal(summary.readyProductCount, 0);
  assert.equal(
    summary.blockingReasonCounts.ACTION_DEDUPE_KEY_MISSING_OR_DUPLICATED,
    1,
  );
});

test("canary readiness rejects action pairs from another SEO run", () => {
  const summary = summarizeSeoListingCanaryReadiness(
    [lifecycleCanaryRow()],
    [
      canaryAction("SOLD_OUT", { run_id: "older-run" }),
      canaryAction("DELETE", { run_id: "older-run" }),
    ],
    { ...CANARY_OPTIONS, requiredMarketListingCount: 1 },
  );
  assert.equal(summary.readyProductCount, 0);
  assert.equal(
    summary.blockingReasonCounts.CURRENT_RUN_ACTION_PAIR_INCOMPLETE,
    1,
  );
});

test("canary readiness rejects a shadow action that already has execution timestamps", () => {
  const summary = summarizeSeoListingCanaryReadiness(
    [lifecycleCanaryRow()],
    [
      canaryAction("SOLD_OUT", {
        claimed_at: "2026-12-28T02:10:00.000Z",
      }),
      canaryAction("DELETE"),
    ],
    { ...CANARY_OPTIONS, requiredMarketListingCount: 1 },
  );
  assert.equal(summary.readyProductCount, 0);
  assert.equal(
    summary.blockingReasonCounts.CURRENT_RUN_ACTION_PAIR_INCOMPLETE,
    1,
  );
});

test("one-look outcome summary uses only the latest run per product", () => {
  const summary = summarizeSeoRegistrationOutcomes([
    job({
      run_id: "seo-run-old-success",
      registration_status: "success",
      run_created_at: "2026-10-14T00:00:00.000Z",
    }),
    job({
      run_id: "seo-run-new-failed",
      registration_status: "failed",
      run_created_at: "2026-10-15T00:00:00.000Z",
    }),
    job({
      run_id: "seo-run-other-running",
      launch_item_id: "launch-2",
      status: "running",
      registration_status: "idle",
    }),
  ]);
  assert.deepEqual(summary, {
    registeredProductCount: 0,
    registrationFailedProductCount: 1,
    processingProductCount: 1,
  });
});
