import assert from "node:assert/strict";
import test from "node:test";
import { loadPurchaseCycleModule as load } from "./helpers/purchaseCycleHarness.mjs";

const historical = load("src/lib/purchaseCycleHistoricalOrderClose.ts");

function settled(overrides = {}) {
  return {
    cycleMonth: "2026-08",
    currentCycleMonth: "2026-09",
    draftCount: 1,
    orderedQuantity: 7,
    receivedQuantity: 7,
    openQuantity: 0,
    receiptState: "COMPLETE",
    landedCostState: "COMPLETE",
    fundingState: "COMPLETE",
    warnings: [],
    ...overrides,
  };
}

test("past month with real draft, full receipt, final cost and funding is read-only order settlement evidence", () => {
  assert.equal(historical.hasHistoricalOrderSettlementEvidence(settled()), true);
  assert.equal(historical.hasHistoricalOrderSettlementEvidence(settled({ receivedQuantity: 8 })), true);
});

test("current/future month, missing draft, partial receipt, unfinished close or warnings never infer order closure", () => {
  const mutations = [
    { currentCycleMonth: "2026-08" },
    { currentCycleMonth: "2026-07" },
    { draftCount: 0 },
    { orderedQuantity: 0 },
    { receivedQuantity: 6 },
    { openQuantity: 1 },
    { receiptState: "NEEDS_CHECK" },
    { landedCostState: "NEEDS_CHECK" },
    { fundingState: "NOT_AVAILABLE" },
    { warnings: ["read unavailable"] },
    { orderedQuantity: Number.NaN },
    { cycleMonth: "2026-13" },
  ];
  for (const mutation of mutations) {
    assert.equal(historical.hasHistoricalOrderSettlementEvidence(settled(mutation)), false);
  }
});

test("actual closure service uses historical settlement only for the order-stage input and performs no repair write", async () => {
  const captured = [];
  const handoff = settled();
  delete handoff.cycleMonth;
  delete handoff.currentCycleMonth;
  Object.assign(handoff, {
    priceVerification: { fingerprint: null, state: "NOT_AVAILABLE" },
  });
  const service = load("src/lib/purchaseCycleClosure.ts", {
    "@/lib/internalChinaPurchaseCycleHandoff": {
      loadInternalChinaPurchaseCycleHandoff: async () => handoff,
    },
    "@/lib/internalChinaMonthlyPurchaseClose": {
      loadInternalChinaMonthlyPurchaseClose: async () => null,
    },
    "@/lib/internalChinaMonthlyPurchaseSummary": {
      loadInternalChinaMonthlyPurchaseSummary: async () => null,
    },
    "@/lib/internalChinaReceiptFollowup": {
      loadInternalChinaReceiptFollowups: async () => [],
    },
    "@/lib/monthlyPurchasePolicy": {
      seoulCalendarMonth: () => "2026-09",
    },
    "@/lib/purchaseCycleClosureCore": {
      followingPurchaseCycleMonth: () => "2026-09",
      buildPurchaseCycleClosureReport: (input) => {
        captured.push(input);
        return input;
      },
    },
    "@/lib/purchaseCycleHistoricalOrderClose": historical,
    "@/lib/purchaseCycleStockReport": {
      loadPurchaseCycleStockReport: async () => ({ state: "BLOCKED", rows: [], blockers: [] }),
    },
  });
  const report = await service.loadPurchaseCycleClosure("2026-08");
  assert.equal(report.orderClosed, true);
  assert.equal(captured.length, 1);

  handoff.landedCostState = "NEEDS_CHECK";
  const incomplete = await service.loadPurchaseCycleClosure("2026-08");
  assert.equal(incomplete.orderClosed, false);

  handoff.landedCostState = "COMPLETE";
  const currentMonthService = load("src/lib/purchaseCycleClosure.ts", {
    "@/lib/internalChinaPurchaseCycleHandoff": { loadInternalChinaPurchaseCycleHandoff: async () => handoff },
    "@/lib/internalChinaMonthlyPurchaseClose": { loadInternalChinaMonthlyPurchaseClose: async () => null },
    "@/lib/internalChinaMonthlyPurchaseSummary": { loadInternalChinaMonthlyPurchaseSummary: async () => null },
    "@/lib/internalChinaReceiptFollowup": { loadInternalChinaReceiptFollowups: async () => [] },
    "@/lib/monthlyPurchasePolicy": { seoulCalendarMonth: () => "2026-08" },
    "@/lib/purchaseCycleClosureCore": { followingPurchaseCycleMonth: () => "2026-09", buildPurchaseCycleClosureReport: (input) => input },
    "@/lib/purchaseCycleHistoricalOrderClose": historical,
    "@/lib/purchaseCycleStockReport": { loadPurchaseCycleStockReport: async () => ({ state: "BLOCKED", rows: [], blockers: [] }) },
  });
  assert.equal((await currentMonthService.loadPurchaseCycleClosure("2026-08")).orderClosed, false);
});
