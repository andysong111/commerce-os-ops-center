import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ABLY_FREE_SHIPPING_DEDUCTION_KRW,
  ABLY_SHOPLING_MALL_KEY,
  PRICE_GRADE_CADENCE,
  PURCHASE_BUDGET_REVENUE_POLICY_VERSION,
  PURCHASE_RECOMMENDATION_CADENCE,
  applyAblyShippingDeductionToGrossRevenue,
  calendarMonthNormalRevenue,
  calendarMonthPurchaseBudgetRevenue,
  calendarMonthRange,
  monthlyPurchaseCycleFor,
  purchaseBudgetRevenuePolicyApplies,
} from "../src/lib/monthlyPurchasePolicy.ts";

const [liveRoute, liveControl, fastDraft, canonicalShadow, scheduler, monthRevenueSource] =
  await Promise.all([
    readFile("src/app/api/product-decision-agent/live-refresh/route.ts", "utf8"),
    readFile(
      "src/app/product-decision-agent/live-refresh/LiveRefreshControl.tsx",
      "utf8",
    ),
    readFile("src/lib/fastPurchaseInternalDraft.ts", "utf8"),
    readFile("src/lib/stage8CanonicalPurchaseShadow.ts", "utf8"),
    readFile(
      "supabase/migrations/202608280009_ops_adaptive_dispatcher.sql",
      "utf8",
    ),
    readFile("src/lib/shopling/calendarMonthRevenue.ts", "utf8"),
  ]);

test("purchase cycle follows Seoul calendar month and budgets from the prior full month", () => {
  const august = monthlyPurchaseCycleFor("2026-08-11T17:32:00+09:00");
  assert.equal(august.cycleMonth, "2026-08");
  assert.equal(august.budgetMonth, "2026-07");
  assert.deepEqual(august.budgetRange, {
    start: "2026-07-01",
    end: "2026-07-31",
  });

  const march = monthlyPurchaseCycleFor("2026-03-05T09:00:00+09:00");
  assert.equal(march.budgetMonth, "2026-02");
  assert.deepEqual(calendarMonthRange("2026-02"), {
    start: "2026-02-01",
    end: "2026-02-28",
  });
});

test("calendar-month normal revenue excludes other months, cancelled rows and duplicates", () => {
  const rows = [
    {
      ord_no: "O1",
      opt_id: "1",
      mall_ord_seq: "1",
      mall_ord_dt: "20260705120000",
      ord_status: "배송완료",
      mall_ord_cnt: "2",
      mall_unit_price: "10000",
    },
    {
      ord_no: "O1",
      opt_id: "1",
      mall_ord_seq: "1",
      mall_ord_dt: "20260705120000",
      ord_status: "배송완료",
      mall_ord_cnt: "2",
      mall_unit_price: "10000",
    },
    {
      ord_no: "O2",
      opt_id: "2",
      mall_ord_seq: "1",
      mall_ord_dt: "20260710120000",
      ord_status: "주문취소",
      mall_ord_cnt: "1",
      mall_unit_price: "7000",
    },
    {
      ord_no: "O3",
      opt_id: "3",
      mall_ord_seq: "1",
      mall_ord_dt: "20260801120000",
      ord_status: "배송완료",
      mall_ord_cnt: "1",
      mall_unit_price: "9000",
    },
  ];
  assert.equal(calendarMonthNormalRevenue(rows, "2026-07"), 20_000);
});

test("ABLY free-shipping reserve applies to every funding-basis month", () => {
  assert.equal(ABLY_SHOPLING_MALL_KEY, "SMALL_00112");
  assert.equal(ABLY_FREE_SHIPPING_DEDUCTION_KRW, 3_000);
  assert.equal(PURCHASE_BUDGET_REVENUE_POLICY_VERSION, "ably-free-shipping-v2-frozen-gross");
  assert.equal(purchaseBudgetRevenuePolicyApplies("2026-08"), true);
  assert.equal(purchaseBudgetRevenuePolicyApplies("2026-09"), true);
  assert.throws(() => purchaseBudgetRevenuePolicyApplies("2026-13"));
});

test("ABLY multi-line order deducts shipping once while keeping all normal line revenue", () => {
  const rows = [
    {
      ord_no: "ABLY-1", opt_id: "A", mall_ord_seq: "1",
      mall_ord_dt: "20260905120000", ord_status: "배송완료",
      mall_ord_cnt: "1", mall_unit_price: "10000", mall_key: ABLY_SHOPLING_MALL_KEY,
    },
    {
      ord_no: "ABLY-1", opt_id: "B", mall_ord_seq: "2",
      mall_ord_dt: "20260905120000", ord_status: "배송완료",
      mall_ord_cnt: "2", mall_unit_price: "5000", mall_key: ABLY_SHOPLING_MALL_KEY,
    },
  ];
  const result = calendarMonthPurchaseBudgetRevenue(rows, "2026-09");
  assert.equal(result.grossRevenueKrw, 20_000);
  assert.equal(result.ablyGrossRevenueKrw, 20_000);
  assert.equal(result.ablyOrderCount, 1);
  assert.equal(result.ablyShippingDeductionKrw, 3_000);
  assert.equal(result.revenueKrw, 17_000);
  assert.equal(calendarMonthNormalRevenue(rows, "2026-09"), 17_000);
});

test("ABLY reserve counts unique normal orders and ignores cancelled/refunded rows", () => {
  const rows = [
    {
      ord_no: "ABLY-1", opt_id: "A", mall_ord_seq: "1",
      mall_ord_dt: "20260905120000", ord_status: "배송완료",
      mall_ord_cnt: "1", mall_unit_price: "12000", mall_key: ABLY_SHOPLING_MALL_KEY,
    },
    {
      ord_no: "ABLY-2", opt_id: "B", mall_ord_seq: "1",
      mall_ord_dt: "20260906120000", ord_status: "배송완료",
      mall_ord_cnt: "1", mall_unit_price: "8000", mall_key: ABLY_SHOPLING_MALL_KEY,
    },
    {
      ord_no: "ABLY-CANCEL", opt_id: "C", mall_ord_seq: "1",
      mall_ord_dt: "20260907120000", ord_status: "주문취소",
      mall_ord_cnt: "1", mall_unit_price: "9000", mall_key: ABLY_SHOPLING_MALL_KEY,
    },
    {
      ord_no: "OTHER-1", opt_id: "D", mall_ord_seq: "1",
      mall_ord_dt: "20260908120000", ord_status: "배송완료",
      mall_ord_cnt: "1", mall_unit_price: "10000", mall_key: "SMALL_00012",
    },
  ];
  const result = calendarMonthPurchaseBudgetRevenue(rows, "2026-09");
  assert.equal(result.grossRevenueKrw, 30_000);
  assert.equal(result.ablyGrossRevenueKrw, 20_000);
  assert.equal(result.ablyOrderCount, 2);
  assert.equal(result.ablyShippingDeductionKrw, 6_000);
  assert.equal(result.revenueKrw, 24_000);
});

test("August ABLY shipping is deducted because August funds the September cycle", () => {
  const rows = [{
    ord_no: "ABLY-AUG", opt_id: "A", mall_ord_seq: "1",
    mall_ord_dt: "20260805120000", ord_status: "배송완료",
    mall_ord_cnt: "1", mall_unit_price: "10000", mall_key: ABLY_SHOPLING_MALL_KEY,
  }];
  const result = calendarMonthPurchaseBudgetRevenue(rows, "2026-08");
  assert.equal(result.policyApplied, true);
  assert.equal(result.ablyOrderCount, 1);
  assert.equal(result.ablyShippingDeductionKrw, 3_000);
  assert.equal(result.revenueKrw, 7_000);
});

test("ABLY shipping deduction can reduce the whole funding basis but never below zero", () => {
  const rows = [{
    ord_no: "ABLY-LOW", opt_id: "A", mall_ord_seq: "1",
    mall_ord_dt: "20260905120000", ord_status: "배송완료",
    mall_ord_cnt: "1", mall_unit_price: "2000", mall_key: ABLY_SHOPLING_MALL_KEY,
  }];
  const result = calendarMonthPurchaseBudgetRevenue(rows, "2026-09");
  assert.equal(result.ablyShippingDeductionKrw, 3_000);
  assert.equal(result.revenueKrw, 0);
});

test("policy migration subtracts ABLY shipping from the already-frozen gross instead of replacing that gross", () => {
  const frozenGross = 9_286_447;
  const currentApiGross = 9_185_357;
  const result = applyAblyShippingDeductionToGrossRevenue(frozenGross, 189);
  assert.equal(result.ablyShippingDeductionKrw, 567_000);
  assert.equal(result.revenueKrw, 8_719_447);
  assert.notEqual(result.grossRevenueKrw, currentApiGross);
  assert.match(monthRevenueSource, /readLegacyFrozenGrossRevenue/);
  assert.match(monthRevenueSource, /grossRevenueSource = legacyFrozen/);
  assert.match(monthRevenueSource, /"legacy-frozen-cache"/);
});

test("purchase recommendation is monthly while grade and price cadence remains daily", () => {
  assert.equal(PURCHASE_RECOMMENDATION_CADENCE, "MONTHLY");
  assert.equal(PRICE_GRADE_CADENCE, "DAILY");
  assert.match(liveRoute, /loadMonthlyPurchaseCycleGate/);
  assert.match(liveRoute, /monthlyPolicy\.locked/);
  assert.match(liveControl, /monthlyLocked/);
  assert.match(liveControl, /월 1회/);
  assert.match(fastDraft, /FAST_PURCHASE_MONTHLY_CYCLE_ALREADY_USED/);
  assert.match(fastDraft, /draft\.cycleMonth === cycleMonth/);
});

test("operational purchase allocation uses previous calendar-month revenue, not rolling revenue for its funding cap", () => {
  assert.match(canonicalShadow, /loadCalendarMonthNormalRevenue\(cycle\.budgetMonth\)/);
  assert.match(canonicalShadow, /recent30Revenue: purchaseBudgetMonthRevenue/);
  assert.match(canonicalShadow, /budgetBasis:/);
  assert.match(canonicalShadow, /1일~말일 정상매출/);
});

test("daily sales and price-grade pipelines remain independent from the monthly purchase lock", () => {
  for (const task of [
    "product-master-shopling-sales-incremental",
    "product-master-shopling-sales-events",
    "receipt-live-price-proposals",
    "price-grade-receipt-shadow-bootstrap",
  ]) {
    assert.match(scheduler, new RegExp(task));
  }
  assert.match(scheduler, /workload_class in \('critical', 'operational', 'diagnostic', 'maintenance'\)/);
});
