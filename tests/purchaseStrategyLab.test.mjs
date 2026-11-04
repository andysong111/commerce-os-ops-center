import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  resolvePurchaseStrategyLabUnitCost,
  simulatePurchaseStrategies,
} from "../src/lib/purchaseStrategyLab.ts";
import {
  PURCHASE_STRATEGY_LAB_SAMPLE_BUDGET_KRW,
  purchaseStrategyLabSampleRows,
} from "../src/lib/purchaseStrategyLabSample.ts";

function row(overrides = {}) {
  const recommendedQuantity = overrides.recommendedQuantity ?? 10;
  return {
    barcode: "TEST-1",
    name: "테스트 상품",
    modelNo: "MODEL-1",
    purchaseStatus: "발주 추천",
    originalPurchaseStatus: "발주 추천",
    entrySignals: [],
    recommendedQuantity,
    preGateRecommendedQuantity:
      overrides.preGateRecommendedQuantity ?? recommendedQuantity,
    moq: 1,
    cartonQuantity: 1,
    unitCostKrw: 100,
    priorityScore: 0,
    revenueQualifiedMonthCount: 1,
    averageMonthlyRevenueKrw: 50_000,
    risingStrength: "NONE",
    permanentlyDiscontinued: false,
    operationallyReady: true,
    inventoryMode: "VERIFIED",
    ...overrides,
  };
}

const config = {
  budgetKrw: 1_000,
  recentMinimumRatio: 0.35,
  stockoutMinimumRatio: 0.5,
  cheapUnitCostThresholdKrw: 2_000,
  cheapMinimumQuantity: 20,
  optionFamilyMinimumQuantity: 10,
};

function scenario(result, id) {
  const found = result.find((item) => item.id === id);
  assert.ok(found, `${id} scenario must exist`);
  return found;
}

function quantity(result, scenarioId, barcode) {
  return (
    scenario(result, scenarioId).allocations.find(
      (allocation) => allocation.barcode === barcode,
    )?.allocatedQuantity ?? 0
  );
}

test("verified purchase evidence takes precedence over a higher planning estimate", () => {
  assert.equal(
    resolvePurchaseStrategyLabUnitCost({
      verifiedPurchaseCostReady: true,
      verifiedPurchaseUnitCostKrw: 1_000,
      purchaseProtectedCostKrw: 1_200,
      planningUnitCostKrw: 3_000,
      recommendedQty: 10,
      expectedCost: 35_000,
    }),
    1_200,
  );
});

test("planning and shadow costs are used only when verified evidence is unavailable", () => {
  assert.equal(
    resolvePurchaseStrategyLabUnitCost({
      verifiedPurchaseCostReady: false,
      verifiedPurchaseUnitCostKrw: 1_000,
      purchaseProtectedCostKrw: 1_200,
      planningUnitCostKrw: 3_000,
      recommendedQty: 10,
      expectedCost: 35_000,
    }),
    3_000,
  );
  assert.equal(
    resolvePurchaseStrategyLabUnitCost({
      verifiedPurchaseCostReady: false,
      planningUnitCostKrw: 0,
      recommendedQty: 10,
      expectedCost: 10_001,
    }),
    1_001,
  );
});

test("anti-starvation prevents a strong recent seller from collapsing to one 5-unit lot", () => {
  const rows = [
    row({
      barcode: "LEAD-1",
      name: "완료월 우선 상품",
      recommendedQuantity: 95,
      unitCostKrw: 10,
      revenueQualifiedMonthCount: 12,
      averageMonthlyRevenueKrw: 1_000_000,
    }),
    row({
      barcode: "BAF1-1",
      name: "허리펴는 등스트레칭기구",
      recommendedQuantity: 20,
      unitCostKrw: 10,
      revenueQualifiedMonthCount: 1,
      averageMonthlyRevenueKrw: 41_926,
      entrySignals: ["MONTHLY_REVENUE_40000", "STOCKOUT_DEMAND_RECOVERY"],
    }),
  ];

  const result = simulatePurchaseStrategies(rows, config);

  assert.equal(quantity(result, "CURRENT", "BAF1-1"), 5);
  assert.ok(quantity(result, "RECENT_PROTECTED", "BAF1-1") > 5);
  assert.ok(
    scenario(result, "RECENT_PROTECTED").estimatedSpendKrw <=
      config.budgetKrw,
  );
});

test("recent sales can restore every rabbit-brooch color hidden by the completed-month gate", () => {
  const colors = [
    ["BBA2-1", "화이트"],
    ["BBA2-2", "그레이"],
    ["BBA2-3", "라이트브라운"],
    ["BBA3-1", "브라운"],
    ["BBA3-2", "옐로우"],
    ["BBA3-3", "핑크"],
  ];
  const rows = colors.map(([barcode, color]) =>
    row({
      barcode,
      name: `토끼브로치 ${color}`,
      modelNo: "AAA092",
      purchaseStatus: barcode === "BBA3-3" ? "발주 추천" : "발주 보류",
      originalPurchaseStatus:
        barcode === "BBA3-3" ? "발주 추천" : "발주 보류",
      entrySignals: ["MONTHLY_REVENUE_40000"],
      recommendedQuantity: barcode === "BBA3-3" ? 10 : 0,
      preGateRecommendedQuantity: 10,
      unitCostKrw: 100,
      revenueQualifiedMonthCount: barcode === "BBA3-3" ? 1 : 0,
    }),
  );

  const result = simulatePurchaseStrategies(rows, {
    ...config,
    budgetKrw: 20_000,
  });
  const currentSelected = colors.filter(
    ([barcode]) => quantity(result, "CURRENT", barcode) > 0,
  );
  const balancedSelected = colors.filter(
    ([barcode]) => quantity(result, "BALANCED_LOW_COST", barcode) > 0,
  );

  assert.deepEqual(currentSelected, [["BBA3-3", "핑크"]]);
  assert.equal(balancedSelected.length, colors.length);
});

test("balanced strategy can raise a cheap 5-unit recommendation to the configured floor", () => {
  const result = simulatePurchaseStrategies(
    [
      row({
        barcode: "CHEAP-1",
        recommendedQuantity: 5,
        unitCostKrw: 100,
      }),
    ],
    { ...config, budgetKrw: 10_000 },
  );

  assert.equal(quantity(result, "CURRENT", "CHEAP-1"), 5);
  assert.equal(quantity(result, "BALANCED_LOW_COST", "CHEAP-1"), 20);
});

test("recent demand can recover a completed-month HOLD from the net pre-gate forecast", () => {
  const result = simulatePurchaseStrategies(
    [
      row({
        barcode: "RECENT-HOLD-1",
        purchaseStatus: "발주 보류",
        originalPurchaseStatus: "발주 보류",
        entrySignals: ["MONTHLY_REVENUE_40000"],
        recommendedQuantity: 0,
        // Stage 8 has already subtracted inventory and commitments from the
        // pre-gate forecast before handing this value to the lab.
        preGateRecommendedQuantity: 25,
        unitCostKrw: 100,
      }),
    ],
    { ...config, budgetKrw: 10_000 },
  );

  assert.equal(quantity(result, "CURRENT", "RECENT-HOLD-1"), 0);
  assert.equal(quantity(result, "RECENT_PROTECTED", "RECENT-HOLD-1"), 25);
});

test("experimental strategies never allocate a non-executable quantity below MOQ", () => {
  const source = [
    row({
      barcode: "MOQ-50",
      recommendedQuantity: 100,
      preGateRecommendedQuantity: 100,
      moq: 50,
      unitCostKrw: 100,
      entrySignals: ["MONTHLY_REVENUE_40000"],
    }),
  ];

  const underfunded = simulatePurchaseStrategies(source, {
    ...config,
    budgetKrw: 1_000,
  });
  assert.equal(quantity(underfunded, "RECENT_PROTECTED", "MOQ-50"), 0);
  assert.equal(quantity(underfunded, "BALANCED_LOW_COST", "MOQ-50"), 0);

  const funded = simulatePurchaseStrategies(source, {
    ...config,
    budgetKrw: 5_000,
  });
  assert.equal(quantity(funded, "RECENT_PROTECTED", "MOQ-50"), 50);
  assert.equal(quantity(funded, "BALANCED_LOW_COST", "MOQ-50"), 50);
});

test("simulation is deterministic, respects budget, and never mutates source rows", () => {
  const rows = [
    row({ barcode: "A-1", recommendedQuantity: 30 }),
    row({
      barcode: "B-1",
      purchaseStatus: "발주 보류",
      entrySignals: ["RECENT_RISING"],
      recommendedQuantity: 25,
    }),
  ];
  const before = structuredClone(rows);
  const first = simulatePurchaseStrategies(rows, config);
  const second = simulatePurchaseStrategies(rows, config);

  assert.deepEqual(first, second);
  assert.deepEqual(rows, before);
  for (const item of first) {
    assert.ok(item.estimatedSpendKrw <= config.budgetKrw);
  }
});

test("large portfolios recalculate without sorting the full table for every lot", () => {
  const rows = Array.from({ length: 1_000 }, (_, index) =>
    row({
      barcode: `PERF-${String(index).padStart(4, "0")}`,
      recommendedQuantity: 200,
      preGateRecommendedQuantity: 200,
      cartonQuantity: 5,
      unitCostKrw: 1,
      priorityScore: index,
    }),
  );
  const startedAt = performance.now();
  const result = simulatePurchaseStrategies(rows, {
    ...config,
    budgetKrw: 200_000,
  });
  const elapsedMilliseconds = performance.now() - startedAt;
  const balanced = scenario(result, "BALANCED_LOW_COST");

  assert.equal(balanced.selectedSkuCount, 1_000);
  assert.equal(balanced.totalQuantity, 200_000);
  assert.ok(
    elapsedMilliseconds < 3_000,
    `expected recalculation under 3000ms, received ${elapsedMilliseconds.toFixed(1)}ms`,
  );
});

test("local sample reproduces both reported failures and the balanced recovery", () => {
  const result = simulatePurchaseStrategies(purchaseStrategyLabSampleRows(), {
    ...config,
    budgetKrw: PURCHASE_STRATEGY_LAB_SAMPLE_BUDGET_KRW,
  });
  const rabbitBarcodes = [
    "BBA2-1",
    "BBA2-2",
    "BBA2-3",
    "BBA3-1",
    "BBA3-2",
    "BBA3-3",
  ];

  assert.equal(quantity(result, "CURRENT", "BAF1-1"), 5);
  assert.ok(quantity(result, "RECENT_PROTECTED", "BAF1-1") > 5);
  assert.deepEqual(
    rabbitBarcodes.filter(
      (barcode) => quantity(result, "CURRENT", barcode) > 0,
    ),
    ["BBA3-3"],
  );
  assert.equal(
    rabbitBarcodes.filter(
      (barcode) => quantity(result, "BALANCED_LOW_COST", barcode) > 0,
    ).length,
    rabbitBarcodes.length,
  );
});
