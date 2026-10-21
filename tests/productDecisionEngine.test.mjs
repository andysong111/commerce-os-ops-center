import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  calculateProductDecisionPlan,
  calculateProductDemand,
} from "../src/lib/productDecisionEngine/index.ts";
import { calculateNetRequirement } from "../src/lib/productDecisionEngine/netRequirement.ts";
import { allocatePurchasePortfolio } from "../src/lib/productDecisionEngine/portfolio.ts";
import {
  SALES_ORDER_RULE_VERSION,
  calculateSalesOrderRecommendation,
} from "../src/lib/productDecisionEngine/salesOrder.ts";

const risingUnits = [120, 80, 60, 50, 40, 30, 20, 20, 20, 20, 20, 20];
const risingRevenue = Array.from({ length: 12 }, () => 120_000);
const strategyAsOf = "2026-10-22T00:00:00.000Z";
const completedStrategyMonths = [
  "2025-10",
  "2025-11",
  "2025-12",
  "2026-01",
  "2026-02",
  "2026-03",
  "2026-04",
  "2026-05",
  "2026-06",
  "2026-07",
  "2026-08",
  "2026-09",
];

function strategyCalendarSales(revenues, units = 20) {
  return completedStrategyMonths.map((month, index) => ({
    month,
    units: Array.isArray(units) ? units[index] ?? 0 : units,
    revenue: revenues[index] ?? 0,
  }));
}

function strategySalesInput(overrides = {}) {
  return {
    monthlyUnits: Array.from({ length: 12 }, () => 20),
    monthlyRevenue: Array.from({ length: 12 }, () => 120_000),
    unitCost: 300,
    weightedClaimRate: 1,
    salesPowerFactor: 0.8,
    calendarMonthlySales: strategyCalendarSales(
      Array.from({ length: 12 }, () => 50_000),
    ),
    strategyAsOf,
    ...overrides,
  };
}

test("sales engine preserves the existing on-demand rising-product calculation", () => {
  const result = calculateSalesOrderRecommendation({
    monthlyUnits: risingUnits,
    monthlyRevenue: risingRevenue,
    unitCost: 300,
    weightedClaimRate: 1,
    salesPowerFactor: 0.9,
  });

  assert.equal(result.ruleVersion, SALES_ORDER_RULE_VERSION);
  assert.equal(result.group, "발주 추천");
  assert.equal(result.trendLabel, "급상승");
  assert.equal(result.rawRecommendedQuantity, 108);
  assert.equal(result.recommendedQuantity, 108);
  assert.equal(result.forecastUnits, 108);
  assert.equal(result.priorityScore, 97);
  assert.equal(result.confidence, 1);
});

test("sales engine keeps low-sample products in manual review and empty products in data shortage", () => {
  const lowSample = calculateSalesOrderRecommendation({
    monthlyUnits: [4, 3],
    monthlyRevenue: [4_000, 3_000],
    unitCost: 300,
    weightedClaimRate: 1,
    salesPowerFactor: 0.3,
  });
  assert.equal(lowSample.group, "소량 검토");
  assert.equal(lowSample.recommendedQuantity, 3);
  assert.equal(lowSample.confidence, 0.45);

  const empty = calculateSalesOrderRecommendation({
    monthlyUnits: [],
    monthlyRevenue: [],
    unitCost: 0,
    weightedClaimRate: 0,
    salesPowerFactor: 0,
  });
  assert.equal(empty.group, "데이터 부족");
  assert.equal(empty.recommendedQuantity, 0);
  assert.deepEqual(empty.missingData, ["판매 이력", "원가"]);
});

test("claim risk can block an otherwise stable reorder", () => {
  const result = calculateSalesOrderRecommendation({
    monthlyUnits: Array.from({ length: 12 }, () => 50),
    monthlyRevenue: Array.from({ length: 12 }, () => 50_000),
    unitCost: 300,
    weightedClaimRate: 25,
    salesPowerFactor: 0.9,
  });
  assert.equal(result.recommendedQuantity, 28);
  assert.equal(result.group, "발주 보류");
});

test("verified stockout restores demand when zero sales hide a strong recent month", () => {
  const result = calculateSalesOrderRecommendation({
    monthlyUnits: [0, 0, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0],
    monthlyRevenue: [0, 0, 0, 80_000, 0, 0, 0, 0, 0, 0, 0, 0],
    unitCost: 500,
    weightedClaimRate: 1,
    salesPowerFactor: 0.4,
    inventoryKnown: true,
    availableQuantity: 0,
    incomingQuantity: 0,
    ledgerCommitment: 0,
  });

  assert.equal(result.group, "발주 추천");
  assert.equal(result.recoveredStockoutDemandUnits, 20);
  assert.equal(result.recommendedQuantity, 20);
  assert.deepEqual(result.entrySignals, ["STOCKOUT_DEMAND_RECOVERY"]);
});

test("stockout recovery requires confirmed zero stock and no incoming commitment", () => {
  const base = {
    monthlyUnits: [0, 0, 0, 20],
    monthlyRevenue: [0, 0, 0, 80_000],
    unitCost: 500,
    weightedClaimRate: 1,
    salesPowerFactor: 0.4,
    inventoryKnown: true,
    availableQuantity: 0,
  };
  const unknown = calculateSalesOrderRecommendation({
    ...base,
    inventoryKnown: false,
  });
  const incoming = calculateSalesOrderRecommendation({
    ...base,
    ledgerCommitment: 10,
  });

  assert.equal(unknown.group, "발주 보류");
  assert.equal(incoming.group, "발주 보류");
  assert.equal(unknown.entrySignals.length, 0);
  assert.equal(incoming.entrySignals.length, 0);
});

test("rising sales or at least 40000 won monthly revenue enters the purchase list", () => {
  const rising = calculateSalesOrderRecommendation({
    monthlyUnits: [8, 4, 2, 2],
    monthlyRevenue: [20_000, 10_000, 5_000, 5_000],
    unitCost: 300,
    weightedClaimRate: 1,
    salesPowerFactor: 0.3,
  });
  const revenue = calculateSalesOrderRecommendation({
    monthlyUnits: [4, 3],
    monthlyRevenue: [40_000, 30_000],
    unitCost: 300,
    weightedClaimRate: 1,
    salesPowerFactor: 0.3,
  });

  assert.equal(rising.group, "발주 추천");
  assert.ok(rising.entrySignals.includes("RECENT_RISING"));
  assert.equal(revenue.group, "발주 추천");
  assert.deepEqual(revenue.entrySignals, ["MONTHLY_REVENUE_40000"]);
});

test("claim safety still blocks products that meet demand entry signals", () => {
  const result = calculateSalesOrderRecommendation({
    monthlyUnits: [20, 10, 5],
    monthlyRevenue: [50_000, 25_000, 12_500],
    unitCost: 300,
    weightedClaimRate: 25,
    salesPowerFactor: 0.9,
  });

  assert.ok(result.entrySignals.length > 0);
  assert.equal(result.group, "발주 보류");
});

test("legacy non-strategy claim handling still lowers quantity and priority", () => {
  const base = {
    monthlyUnits: Array.from({ length: 12 }, () => 20),
    monthlyRevenue: Array.from({ length: 12 }, () => 120_000),
    unitCost: 300,
    salesPowerFactor: 0.8,
  };
  const clean = calculateSalesOrderRecommendation({
    ...base,
    weightedClaimRate: 1,
  });
  const risky = calculateSalesOrderRecommendation({
    ...base,
    weightedClaimRate: 12,
  });

  assert.equal(clean.strategy, null);
  assert.equal(risky.strategy, null);
  assert.ok(risky.rawRecommendedQuantity < clean.rawRecommendedQuantity);
  assert.ok(risky.priorityScore < clean.priorityScore);
  assert.ok(risky.reasons.some((reason) => reason.includes("권장수량을 감액")));
});

test("new strategy turns forecast demand into coverage quantity before net stock subtraction", () => {
  const product = {
    barcode: "BSTRATEGY-1",
    name: "전략 통합 테스트",
    ...strategySalesInput({
      calendarMonthlySales: strategyCalendarSales(
        Array.from({ length: 12 }, () => 150_000),
      ),
    }),
    inventoryKnown: true,
    availableQuantity: 30,
    reservedQuantity: 5,
    incomingQuantity: 20,
    ledgerCommitment: 30,
    moq: 10,
    cartonQuantity: 12,
  };

  const demand = calculateProductDemand(product);

  assert.equal(demand.sales.forecastUnits, 22);
  assert.equal(demand.sales.strategy.history.qualificationLabel, "12/12");
  assert.equal(demand.sales.strategy.automaticCoverageMonths, 4);
  assert.equal(demand.sales.rawRecommendedQuantity, 88);
  assert.equal(demand.sales.recommendedQuantity, 96);
  assert.equal(demand.netRequirement.demandTarget, 88);
  assert.equal(demand.netRequirement.estimatedStock, 25);
  assert.equal(demand.netRequirement.incomingSnapshot, 20);
  assert.equal(demand.netRequirement.ledgerCommitment, 30);
  assert.equal(demand.netRequirement.openCommitment, 30);
  assert.equal(demand.netRequirement.securedQuantity, 55);
  assert.equal(demand.netRequirement.netRequiredRaw, 33);
  assert.equal(demand.netRequirement.recommendedQuantity, 36);
  assert.equal(demand.netRequirement.group, "발주 추천");
});

test("confirmed stock and open commitment can fully cover a strategy demand target", () => {
  const demand = calculateProductDemand({
    barcode: "BSTRATEGY-2",
    name: "전략 재고충족 테스트",
    ...strategySalesInput({
      calendarMonthlySales: strategyCalendarSales(
        Array.from({ length: 12 }, () => 150_000),
      ),
    }),
    inventoryKnown: true,
    availableQuantity: 60,
    reservedQuantity: 0,
    incomingQuantity: 28,
    ledgerCommitment: 20,
  });

  assert.equal(demand.sales.rawRecommendedQuantity, 88);
  assert.equal(demand.netRequirement.openCommitment, 28);
  assert.equal(demand.netRequirement.securedQuantity, 88);
  assert.equal(demand.netRequirement.recommendedQuantity, 0);
  assert.equal(demand.netRequirement.group, "발주 보류");
});

test("completed-month consistency, rising strength and high value raise strategy quantity and priority", () => {
  const ordinary = calculateSalesOrderRecommendation(
    strategySalesInput({
      calendarMonthlySales: strategyCalendarSales([
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40_000,
      ]),
    }),
  );
  const rising = calculateSalesOrderRecommendation(
    strategySalesInput({
      calendarMonthlySales: strategyCalendarSales([
        0, 0, 0, 0, 0, 0, 10_000, 10_000, 10_000, 60_000, 60_000, 60_000,
      ]),
    }),
  );
  const highValueHero = calculateSalesOrderRecommendation(
    strategySalesInput({
      calendarMonthlySales: strategyCalendarSales(
        Array.from({ length: 12 }, () => 300_000),
        10,
      ),
    }),
  );

  assert.equal(ordinary.strategy.history.qualificationLabel, "1/12");
  assert.equal(ordinary.strategy.history.risingStrength, "NONE");
  assert.equal(ordinary.strategy.automaticCoverageMonths, 1.5);
  assert.equal(ordinary.rawRecommendedQuantity, 33);

  assert.equal(rising.strategy.history.risingStrength, "STRONG");
  assert.equal(rising.strategy.automaticCoverageMonths, 4);
  assert.equal(rising.rawRecommendedQuantity, 88);
  assert.ok(rising.priorityScore > ordinary.priorityScore);

  assert.equal(highValueHero.strategy.history.qualificationLabel, "12/12");
  assert.equal(highValueHero.strategy.highValueConsistentProduct, true);
  assert.equal(highValueHero.strategy.highValueConsistentBonusPoints, 10);
  assert.equal(highValueHero.rawRecommendedQuantity, 88);
  assert.ok(highValueHero.priorityScore > rising.priorityScore);
});

test("claim penalty lowers only integrated strategy priority without shrinking quantity", () => {
  const calendarMonthlySales = strategyCalendarSales(
    Array.from({ length: 12 }, () => 300_000),
    10,
  );
  const clean = calculateSalesOrderRecommendation(
    strategySalesInput({ calendarMonthlySales, weightedClaimRate: 1 }),
  );
  const risky = calculateSalesOrderRecommendation(
    strategySalesInput({ calendarMonthlySales, weightedClaimRate: 12 }),
  );

  assert.equal(clean.strategy.highValueConsistentBonusPoints, 10);
  assert.equal(clean.strategy.claimPenaltyPoints, 0);
  assert.equal(risky.strategy.highValueConsistentBonusPoints, 10);
  assert.equal(risky.strategy.claimPenaltyPoints, 20);
  assert.equal(risky.rawRecommendedQuantity, clean.rawRecommendedQuantity);
  assert.ok(risky.priorityScore < clean.priorityScore);
  assert.equal(clean.priorityScore - risky.priorityScore, 20);
  assert.equal(risky.weightedClaimRate, 12);
  assert.ok(
    risky.reasons.some((reason) =>
      reason.includes("우선순위 감점으로만 반영"),
    ),
  );
});

test("adjusted revenue threshold controls integrated strategy eligibility", () => {
  const accepted = calculateSalesOrderRecommendation(strategySalesInput());
  const held = calculateSalesOrderRecommendation(
    strategySalesInput({
      strategyPolicy: { monthlyRevenueThresholdKrw: 60_000 },
    }),
  );

  assert.equal(accepted.strategy.history.qualificationLabel, "12/12");
  assert.equal(accepted.group, "발주 추천");
  assert.equal(held.strategy.history.qualificationLabel, "0/12");
  assert.equal(held.strategy.recommended, false);
  assert.equal(held.rawRecommendedQuantity, 0);
  assert.equal(held.group, "발주 보류");
});

test("permanent discontinuation overrides strong sales, rising and new-product protection", () => {
  const result = calculateSalesOrderRecommendation(
    strategySalesInput({
      calendarMonthlySales: strategyCalendarSales(
        Array.from({ length: 12 }, () => 300_000),
      ),
      firstSaleAt: "2026-01-01T00:00:00.000Z",
      permanentlyDiscontinued: true,
    }),
  );

  assert.equal(result.strategy.decision, "DISCONTINUED");
  assert.equal(result.strategy.permanentlyDiscontinued, true);
  assert.equal(result.rawRecommendedQuantity, 0);
  assert.equal(result.recommendedQuantity, 0);
  assert.equal(result.group, "발주 보류");
  assert.ok(result.entrySignals.includes("PERMANENTLY_DISCONTINUED"));
});

test("net requirement subtracts confirmed stock and the larger single incoming ledger value", () => {
  const result = calculateNetRequirement({
    demandTarget: 100,
    originalGroup: "발주 추천",
    inventoryKnown: true,
    availableQuantity: 40,
    reservedQuantity: 5,
    incomingQuantity: 20,
    ledgerCommitment: 30,
    moq: 10,
    cartonQuantity: 12,
  });

  assert.equal(result.estimatedStock, 35);
  assert.equal(result.openCommitment, 30);
  assert.equal(result.securedQuantity, 65);
  assert.equal(result.netRequiredRaw, 35);
  assert.equal(result.recommendedQuantity, 36);

  const unknownInventory = calculateNetRequirement({
    demandTarget: 100,
    originalGroup: "발주 추천",
    inventoryKnown: false,
    availableQuantity: 40,
    incomingQuantity: 20,
    ledgerCommitment: 30,
  });
  assert.equal(unknownInventory.estimatedStock, 0);
  assert.equal(unknownInventory.openCommitment, 30);
  assert.equal(unknownInventory.netRequiredRaw, 70);
});

test("portfolio allocation applies minimum order economics before score-ordered budget allocation", () => {
  const result = allocatePurchasePortfolio({
    recent30DayRevenue: 300_000,
    purchaseCostMultiplier: 1.5,
    minimumOrderAmount: 5_000,
    items: [
      {
        barcode: "A",
        group: "발주 추천",
        netRequiredQuantity: 10,
        unitCost: 1_000,
        totalScore: 90,
      },
      {
        barcode: "B",
        group: "발주 추천",
        netRequiredQuantity: 1,
        unitCost: 100,
        totalScore: 80,
      },
      {
        barcode: "C",
        group: "발주 추천",
        netRequiredQuantity: 100,
        unitCost: 1_000,
        totalScore: 70,
      },
    ],
  });

  assert.equal(result.grossBudget, 150_000);
  assert.equal(result.productOrderBudget, 100_000);
  assert.equal(result.expectedSpend, 100_000);
  assert.equal(result.remainingBudget, 0);

  const byBarcode = new Map(result.items.map((item) => [item.barcode, item]));
  assert.equal(byBarcode.get("A").allocatedQuantity, 10);
  assert.equal(byBarcode.get("C").allocatedQuantity, 90);
  assert.equal(byBarcode.get("C").budgetReduced, true);
  assert.equal(byBarcode.get("B").minimumOrderQuantity, 50);
  assert.equal(byBarcode.get("B").minimumReview, true);
  assert.equal(byBarcode.get("B").finalGroup, "발주 보류");
});

test("full pure pipeline calculates demand, stock subtraction and final allocation without external writes", () => {
  const product = {
    barcode: "BTEST-1",
    name: "테스트 상승상품",
    monthlyUnits: risingUnits,
    monthlyRevenue: risingRevenue,
    unitCost: 300,
    weightedClaimRate: 1,
    salesPowerFactor: 0.9,
    inventoryKnown: true,
    availableQuantity: 30,
    reservedQuantity: 0,
    incomingQuantity: 20,
    ledgerCommitment: 30,
  };

  const demand = calculateProductDemand(product);
  assert.equal(demand.sales.rawRecommendedQuantity, 108);
  assert.equal(demand.netRequirement.securedQuantity, 60);
  assert.equal(demand.netRequirement.recommendedQuantity, 48);

  const plan = calculateProductDecisionPlan({
    generatedAt: "2026-08-05T10:00:00.000Z",
    recent30DayRevenue: 1_000_000,
    products: [product],
  });
  assert.equal(plan.products[0].finalGroup, "발주 추천");
  assert.equal(plan.products[0].finalQuantity, 48);
  assert.equal(plan.products[0].expectedCost, 14_400);
  assert.equal(plan.expectedSpend, 14_400);
});

test("ported engine modules remain pure and contain no database, API or execution call", async () => {
  const source = await Promise.all(
    ["salesOrder.ts", "netRequirement.ts", "portfolio.ts", "index.ts"].map(
      (name) => readFile(`src/lib/productDecisionEngine/${name}`, "utf8"),
    ),
  );
  const combined = source.join("\n");
  assert.doesNotMatch(combined, /\bfetch\s*\(/);
  assert.doesNotMatch(combined, /supabase|shopling|1688/i);
  assert.doesNotMatch(combined, /\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
  assert.doesNotMatch(combined, /process\.env/);
});
