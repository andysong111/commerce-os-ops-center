import assert from "node:assert/strict";
import test from "node:test";

import { buildSeoListingDailyRefreshPlan } from "../src/lib/seoListingLifecycleDailyRefresh.ts";

const NOW = new Date("2026-10-29T00:00:00.000Z");

function lifecycle(overrides = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    owner_id: "22222222-2222-4222-8222-222222222222",
    launch_item_id: "launch-aaa001",
    market_account_key: "market-a",
    state: "LIVE",
    attempt_count: 1,
    current_run_id: "run-1",
    goods_key: "101001",
    live_started_at: "2026-10-01T00:00:00.000Z",
    last_verified_live_at: "2026-10-28T00:00:00.000Z",
    sales_count_during_attempt: 0,
    exposure_verified: true,
    requires_review: false,
    review_reason: null,
    evidence: {
      verifiedExposureDays: 3,
      lastVerifiedDay: "2026-10-28",
    },
    ...overrides,
  };
}

function launchItem(overrides = {}) {
  return {
    item_id: "launch-aaa001",
    barcode: "AAA001",
    option_barcodes: [],
    option_barcode_nos: [],
    updated_at: "2026-10-29T00:00:00.000Z",
    ...overrides,
  };
}

function sales(overrides = {}) {
  return {
    barcode: "AAA001",
    last_sale_at: null,
    evaluated_at: "2026-10-29T00:00:00.000Z",
    updated_at: "2026-10-29T00:00:00.000Z",
    ...overrides,
  };
}

function shopling(overrides = {}) {
  return {
    goodsKey: "101001",
    state: "READY",
    currentSaleStatus: "B",
    updated_at: "2026-10-29T00:00:00.000Z",
    ...overrides,
  };
}

function plan(overrides = {}) {
  return buildSeoListingDailyRefreshPlan({
    lifecycleRows: [lifecycle()],
    launchItems: [launchItem()],
    salesRows: [sales()],
    shoplingStatuses: [shopling()],
    now: NOW,
    ...overrides,
  });
}

test("a fresh selling readback counts one verified Seoul day", () => {
  const result = plan();
  assert.equal(result.refreshedRecordCount, 1);
  assert.equal(result.verifiedDayEventCount, 1);
  assert.equal(result.recordUpdates[0].evidence.verifiedExposureDays, 4);
  assert.equal(result.recordUpdates[0].evidence.lastVerifiedDay, "2026-10-29");
  assert.equal(result.externalMarketWrite, false);
});

test("rerunning the same Seoul day does not double-count exposure", () => {
  const result = plan({
    lifecycleRows: [
      lifecycle({
        last_verified_live_at: "2026-10-29T00:00:00.000Z",
        evidence: {
          verifiedExposureDays: 4,
          lastVerifiedDay: "2026-10-29",
        },
      }),
    ],
  });
  assert.equal(result.refreshedRecordCount, 0);
  assert.equal(result.verifiedDayEventCount, 0);
});

test("stale sales evidence fails closed and does not count a day", () => {
  const result = plan({
    salesRows: [
      sales({
        evaluated_at: "2026-10-26T23:59:59.999Z",
        updated_at: "2026-10-26T23:59:59.999Z",
      }),
    ],
  });
  assert.equal(result.verifiedDayEventCount, 0);
  assert.equal(result.reviewRecordCount, 1);
  assert.equal(
    result.recordUpdates[0].reviewReason,
    "SALES_EVIDENCE_MISSING_OR_STALE",
  );
  assert.equal(result.shadowActions.length, 0);
});

test("a verified sale protects every market listing for the product", () => {
  const result = plan({
    lifecycleRows: [
      lifecycle(),
      lifecycle({
        id: "33333333-3333-4333-8333-333333333333",
        market_account_key: "market-b",
        goods_key: "101002",
      }),
    ],
    salesRows: [sales({ last_sale_at: "2026-10-20T00:00:00.000Z" })],
    shoplingStatuses: [
      shopling(),
      shopling({ goodsKey: "101002" }),
    ],
  });
  assert.equal(result.protectedRecordCount, 1);
  assert.equal(result.recordUpdates.length, 2);
  assert.ok(result.recordUpdates.every((row) => row.state === "PROTECTED"));
  assert.ok(result.events.every((row) => row.action === "KEEP"));
});

test("the 60th verified day creates only deterministic shadow actions", () => {
  const result = plan({
    lifecycleRows: [
      lifecycle({
        evidence: {
          verifiedExposureDays: 59,
          lastVerifiedDay: "2026-10-28",
        },
      }),
    ],
  });
  assert.equal(result.shadowDueRecordCount, 1);
  assert.deepEqual(
    result.shadowActions.map((row) => row.actionType),
    ["SOLD_OUT", "DELETE"],
  );
  assert.equal(new Set(result.shadowActions.map((row) => row.dedupeKey)).size, 2);
  assert.equal(result.recordUpdates[0].state, "LIVE");
  assert.equal(result.events[0].action, "SOLD_OUT_AND_DELETE");
  assert.equal(result.externalMarketWrite, false);
});

test("Shopling conflicts never become sold-out candidates", () => {
  const result = plan({
    lifecycleRows: [
      lifecycle({
        evidence: {
          verifiedExposureDays: 59,
          lastVerifiedDay: "2026-10-28",
        },
      }),
    ],
    shoplingStatuses: [shopling({ state: "CONFLICT" })],
  });
  assert.equal(result.shadowActions.length, 0);
  assert.equal(result.reviewRecordCount, 1);
  assert.equal(result.recordUpdates[0].reviewReason, "SHOPLING_STATUS_CONFLICT");
});
