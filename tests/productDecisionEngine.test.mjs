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
