import assert from "node:assert/strict";
import test from "node:test";

const { purchaseBudgetCarryoverBasis, purchaseBudgetRevenueAccrualSummary } = await import(
  new URL("../src/lib/purchaseCyclePreflightSpendCore.ts", import.meta.url)
);

test("ABLY shipping reserve is deducted before each month's 50% budget accrual", () => {
  const result = purchaseBudgetRevenueAccrualSummary([
    {
      month: "2026-09",
      grossRevenueKrw: 7_833_827,
      revenueKrw: 7_194_827,
      ablyOrderCount: 213,
      ablyShippingDeductionKrw: 639_000,
    },
  ]);
  assert.deepEqual(result, {
    grossNormalRevenueKrw: 7_833_827,
    adjustedNormalRevenueKrw: 7_194_827,
    ablyOrderCount: 213,
    ablyShippingDeductionKrw: 639_000,
    accruedBudgetKrw: 3_597_414,
  });
});

const row = (draftId, snapshot) => ({
  source_event_id: `internal-china-prep:${draftId}`,
  result_snapshot: { snapshot: { draftId, ...snapshot } },
});

test("unused budget accrues from the October 2026 purchase-run launch through the current cycle", () => {
  const result = purchaseBudgetCarryoverBasis("2026-11", [
    row("draft-october", { cycleMonth: "2026-10", status: "DRAFT" }),
  ]);
  assert.deepEqual(result.accruedBudgetMonths, ["2026-09", "2026-10"]);
  assert.equal(result.recordedSpendKrw, 0);
});

test("October launch uses September sales only and ignores retired September draft spend", () => {
  const result = purchaseBudgetCarryoverBasis("2026-10", [
    row("retired-september-order", {
      cycleMonth: "2026-09",
      status: "ORDERED",
      actualOrderPaidKrwAtInternalFx: 1_119_847,
    }),
    row("october-preview", { cycleMonth: "2026-10", status: "DRAFT" }),
  ]);
  assert.deepEqual(result.accruedBudgetMonths, ["2026-09"]);
  assert.equal(result.accrualStartMonth, "2026-09");
  assert.equal(result.accrualEndMonth, "2026-09");
  assert.equal(result.recordedSpendKrw, 0);
});

test("only actual ORDERED drafts reduce carryover and two runs in one month both count", () => {
  const result = purchaseBudgetCarryoverBasis("2026-10", [
    row("draft-a", { cycleMonth: "2026-10", status: "ORDERED", actualOrderPaidKrwAtInternalFx: 120_000 }),
    row("draft-b", { cycleMonth: "2026-10", status: "ORDERED", actualOrderPaidKrwAtInternalFx: 80_000 }),
    row("draft-preview", { cycleMonth: "2026-10", status: "DRAFT" }),
  ]);
  assert.deepEqual(result.accruedBudgetMonths, ["2026-09"]);
  assert.equal(result.recordedSpendKrw, 200_000);
});

test("legacy ordered snapshot derives spend only from complete price evidence", () => {
  const result = purchaseBudgetCarryoverBasis("2026-10", [
    row("legacy", {
      cycleMonth: "2026-10",
      status: "ORDERED",
      exchangeRateKrwPerCny: 230,
      internalOrderCostMultiplier: 1.45,
      lines: [{ quantity: 10, unitPriceCny: 2, domesticChinaFreightCny: 5 }],
    }),
  ]);
  assert.equal(result.recordedSpendKrw, Math.round(25 * 230 * 1.45));
  assert.throws(
    () => purchaseBudgetCarryoverBasis("2026-10", [
      row("broken", {
        cycleMonth: "2026-10",
        status: "ORDERED",
        exchangeRateKrwPerCny: 230,
        internalOrderCostMultiplier: 1.45,
        lines: [{ quantity: 10, unitPriceCny: 0 }],
      }),
    ]),
    /CYCLE_SPEND_AMOUNT_UNVERIFIED/,
  );
});
