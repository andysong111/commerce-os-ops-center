import test from "node:test";
import assert from "node:assert/strict";
import { simulatePurchaseStrategies } from "../src/lib/purchaseStrategyLab.ts";
import {
  PURCHASE_STRATEGY_LAB_SAMPLE_BUDGET_KRW,
  purchaseStrategyLabSampleRows,
} from "../src/lib/purchaseStrategyLabSample.ts";

function row(overrides = {}) {
  return {
    barcode: "TEST-1",
    name: "테스트 상품",
    modelNo: "MODEL-1",
    purchaseStatus: "발주 추천",
    originalPurchaseStatus: "발주 추천",
    entrySignals: [],
    recommendedQuantity: 10,
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
      recommendedQuantity: 10,
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
