import {
  calculateNetRequirement,
  type NetRequirementResult,
} from "./netRequirement.ts";
import {
  allocatePurchasePortfolio,
  type PortfolioAllocationResult,
} from "./portfolio.ts";
import {
  calculateSalesOrderRecommendation,
  type SalesOrderInput,
  type SalesOrderResult,
} from "./salesOrder.ts";

export type ProductDecisionEngineProductInput = SalesOrderInput & {
  barcode: string;
  name: string;
  inventoryKnown: boolean;
  availableQuantity?: number;
  reservedQuantity?: number;
  incomingQuantity?: number;
  ledgerCommitment?: number;
};

export type ProductDemandCalculation = {
  input: ProductDecisionEngineProductInput;
  sales: SalesOrderResult;
  netRequirement: NetRequirementResult;
};

export type ProductDecisionPlanInput = {
  generatedAt: string;
  recent30DayRevenue: number;
  purchaseCostMultiplier?: number;
  minimumOrderAmount?: number;
  products: ProductDecisionEngineProductInput[];
};

export type ProductDecisionPlanItem = ProductDemandCalculation & {
  finalGroup: SalesOrderResult["group"];
  finalQuantity: number;
  expectedCost: number;
  minimumOrderQuantity: number;
  minimumApplied: boolean;
  minimumReview: boolean;
  budgetReduced: boolean;
};

export type ProductDecisionPlan = {
  generatedAt: string;
  ruleVersion: string;
  grossBudget: number;
  productOrderBudget: number;
  purchaseCostMultiplier: number;
  remainingBudget: number;
  expectedSpend: number;
  groupCounts: PortfolioAllocationResult["groupCounts"];
  products: ProductDecisionPlanItem[];
};

export function calculateProductDemand(
  input: ProductDecisionEngineProductInput,
): ProductDemandCalculation {
  const sales = calculateSalesOrderRecommendation(input);
  const netRequirement = calculateNetRequirement({
    demandTarget: sales.rawRecommendedQuantity,
    originalGroup: sales.group,
    inventoryKnown: input.inventoryKnown,
    availableQuantity: input.availableQuantity,
    reservedQuantity: input.reservedQuantity,
    incomingQuantity: input.incomingQuantity,
    ledgerCommitment: input.ledgerCommitment,
    moq: input.moq,
    cartonQuantity: input.cartonQuantity,
  });

  return { input, sales, netRequirement };
}

/**
 * 기존 발주 추천 Site의 계산 순서를 그대로 분리한 순수 엔진이다.
 * 판매기반 수요 계산 → 재고·미입고 차감 → 최소주문·예산 배분 순서이며
 * 데이터베이스, 외부 API, 승인, 주문 실행을 전혀 호출하지 않는다.
 */
export function calculateProductDecisionPlan(
  input: ProductDecisionPlanInput,
): ProductDecisionPlan {
  const demandCalculations = input.products.map(calculateProductDemand);
  const allocation = allocatePurchasePortfolio({
    recent30DayRevenue: input.recent30DayRevenue,
    purchaseCostMultiplier: input.purchaseCostMultiplier,
    minimumOrderAmount: input.minimumOrderAmount,
    items: demandCalculations.map((entry) => ({
      barcode: entry.input.barcode,
      group: entry.netRequirement.group,
      netRequiredQuantity: entry.netRequirement.recommendedQuantity,
      unitCost: entry.input.unitCost,
      totalScore: entry.sales.priorityScore,
      moq: entry.input.moq,
      cartonQuantity: entry.input.cartonQuantity,
    })),
  });
  const allocationByBarcode = new Map(
    allocation.items.map((item) => [item.barcode, item]),
  );

  const products = demandCalculations.map((entry) => {
    const allocated = allocationByBarcode.get(entry.input.barcode);
    if (!allocated) {
      throw new Error(
        `PRODUCT_DECISION_ALLOCATION_MISSING:${entry.input.barcode}`,
      );
    }
    return {
      ...entry,
      finalGroup: allocated.finalGroup,
      finalQuantity: allocated.allocatedQuantity,
      expectedCost: allocated.expectedCost,
      minimumOrderQuantity: allocated.minimumOrderQuantity,
      minimumApplied: allocated.minimumApplied,
      minimumReview: allocated.minimumReview,
      budgetReduced: allocated.budgetReduced,
    };
  });

  return {
    generatedAt: input.generatedAt,
    ruleVersion:
      products[0]?.sales.ruleVersion ??
      "commerce-os-sales-order-v1.2.0-demand-entry-signals",
    grossBudget: allocation.grossBudget,
    productOrderBudget: allocation.productOrderBudget,
    purchaseCostMultiplier: allocation.purchaseCostMultiplier,
    remainingBudget: allocation.remainingBudget,
    expectedSpend: allocation.expectedSpend,
    groupCounts: allocation.groupCounts,
    products,
  };
}
