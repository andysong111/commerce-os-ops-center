import assert from "node:assert/strict";
import test from "node:test";

const { purchaseBudgetCarryoverBasis } = await import(
  new URL("../src/lib/purchaseCyclePreflightSpendCore.ts", import.meta.url)
);

const row = (draftId, snapshot) => ({
  source_event_id: `internal-china-prep:${draftId}`,
  result_snapshot: { snapshot: { draftId, ...snapshot } },
});

test("unused monthly budget accrues from the first purchase cycle through the current cycle", () => {
  const result = purchaseBudgetCarryoverBasis("2026-11", [
    row("draft-october", { cycleMonth: "2026-10", status: "DRAFT" }),
  ]);
  assert.deepEqual(result.accruedBudgetMonths, ["2026-09", "2026-10"]);
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
