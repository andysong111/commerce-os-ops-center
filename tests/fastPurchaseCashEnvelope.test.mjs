import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  allocatePurchasePortfolio,
  calculateProductOrderBudget,
} from "../src/lib/productDecisionEngine/portfolio.ts";

const items = [
  {
    barcode: "BAA1-1",
    group: "발주 추천",
    netRequiredQuantity: 60,
    unitCost: 1_000,
    totalScore: 100,
    moq: 1,
    cartonQuantity: 1,
  },
  {
    barcode: "BAA1-2",
    group: "발주 추천",
    netRequiredQuantity: 60,
    unitCost: 1_000,
    totalScore: 80,
    moq: 1,
    cartonQuantity: 1,
  },
  {
    barcode: "BAA1-3",
    group: "소량 검토",
    netRequiredQuantity: 40,
    unitCost: 1_000,
    totalScore: 999,
    moq: 1,
    cartonQuantity: 1,
  },
];

test("legacy explicit cash envelope still overrides only the gross funding cap", () => {
  const result = allocatePurchasePortfolio({
    recent30DayRevenue: 9_000_000,
    grossBudgetOverrideKrw: 152_250,
    purchaseCostMultiplier: 1.45,
    minimumOrderAmount: 0,
    items,
  });
  assert.equal(result.grossBudget, 152_250);
  assert.equal(result.paymentFeeMultiplier, 1.008);
  assert.equal(result.productOrderBudget, 103_960);
  assert.equal(result.expectedSpend, 103_000);
  assert.deepEqual(
    result.items.map((row) => [row.barcode, row.allocatedQuantity]),
    [
      ["BAA1-1", 60],
      ["BAA1-2", 43],
      ["BAA1-3", 0],
    ],
  );
});

test("legacy cash envelope preserves existing group priority before score", () => {
  const result = allocatePurchasePortfolio({
    recent30DayRevenue: 9_000_000,
    grossBudgetOverrideKrw: 91_350,
    purchaseCostMultiplier: 1.45,
    minimumOrderAmount: 0,
    items,
  });
  assert.equal(result.productOrderBudget, 62_376);
  assert.equal(result.items[0].allocatedQuantity, 60);
  assert.equal(result.items[1].allocatedQuantity, 2);
  assert.equal(result.items[2].allocatedQuantity, 0);
});

test("omitting legacy cash envelope keeps the original revenue based budget", () => {
  const result = allocatePurchasePortfolio({
    recent30DayRevenue: 304_500,
    purchaseCostMultiplier: 1.45,
    minimumOrderAmount: 0,
    items: [],
  });
  assert.equal(result.grossBudget, 152_250);
  assert.equal(
    result.productOrderBudget,
    calculateProductOrderBudget(152_250, 1.45, 1.008),
  );
});

test("operational cash workspace uses purchase V2 and immutable finalization", async () => {
  const layout = await readFile("src/app/china-order-manager/layout.tsx", "utf8");
  const page = await readFile(
    "src/app/china-order-manager/cash-envelope/page.tsx",
    "utf8",
  );
  const panel = await readFile(
    "src/components/china-order-manager/InternalChinaCashEnvelopePanel.tsx",
    "utf8",
  );
  const calculation = await readFile(
    "src/lib/fastPurchaseCashEnvelope.ts",
    "utf8",
  );
  const finalizeRoute = await readFile(
    "src/app/api/fast-purchase/finalized/route.ts",
    "utf8",
  );
  const finalizedBanner = await readFile(
    "src/components/china-order-manager/FinalizedPurchaseRecommendationBanner.tsx",
    "utf8",
  );

  assert.match(layout, /FinalizedPurchaseRecommendationBanner/);
  assert.match(page, /현금 제약 발주 V2/);
  assert.match(page, /MOQ와 박스입수는 발주수량 계산에서 사용하지 않습니다/);
  assert.match(panel, /V2 현금 기준 발주권장안 계산/);
  assert.match(panel, /이 예산·발주안 확정/);
  assert.match(panel, /44일 목표/);
  assert.match(calculation, /calculatePurchaseV2Product/);
  assert.match(calculation, /allocatePurchaseV2Portfolio/);
  assert.doesNotMatch(calculation, /allocatePurchasePortfolio\s*\(/);
  assert.doesNotMatch(calculation, /planningRow\?\.moq|planningRow\?\.cartonQuantity/);
  assert.match(finalizeRoute, /savePurchaseRecommendationFinalization/);
  assert.match(finalizedBanner, /1688 주문수량 펼치기/);
});

test("calculation endpoint remains same-origin and does not directly order or pay", async () => {
  const route = await readFile(
    "src/app/api/fast-purchase/cash-envelope/route.ts",
    "utf8",
  );
  assert.match(route, /isSameOriginOpsRequest/);
  assert.doesNotMatch(route, /1688.*(?:POST|PUT|PATCH|DELETE)/i);
  assert.doesNotMatch(route, /method:\s*["'](?:PUT|PATCH|DELETE)["']/i);
});
