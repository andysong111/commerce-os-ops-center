import assert from "node:assert/strict";
import test from "node:test";
import { previousCalendarMonth, calendarMonthRange, purchaseBudgetRevenuePolicyApplies } from "../src/lib/monthlyPurchasePolicy.ts";

test("monthly cycle rejects nonexistent months rather than rolling into another price/funding scope", () => {
  for (const value of ["2026-00", "2026-13", "2026-99", "2026-1", "2026-09 "]) {
    for (const fn of [previousCalendarMonth, calendarMonthRange, purchaseBudgetRevenuePolicyApplies]) {
      assert.throws(() => fn(value), /MONTHLY_PURCHASE_MONTH_INVALID/);
    }
  }
});

test("valid year rollover and leap-year month boundaries are unchanged", () => {
  assert.equal(previousCalendarMonth("2026-01"), "2025-12");
  assert.deepEqual(calendarMonthRange("2024-02"), { start: "2024-02-01", end: "2024-02-29" });
  assert.deepEqual(calendarMonthRange("2026-02"), { start: "2026-02-01", end: "2026-02-28" });
  assert.equal(purchaseBudgetRevenuePolicyApplies("2026-12"), true);
});
