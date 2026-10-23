import type { SalesOrderGroup } from "./salesOrder.ts";
import { comparePurchaseStrategyPriority, type RisingStrength } from "./purchaseStrategyPolicy.ts";

export const DEFAULT_PURCHASE_COST_MULTIPLIER = 1.45;
export const MIN_PURCHASE_COST_MULTIPLIER = 1;
export const MAX_PURCHASE_COST_MULTIPLIER = 3;
export const DEFAULT_MINIMUM_ORDER_AMOUNT = 5_000;

const ORDERABLE_GROUPS = new Set<SalesOrderGroup>([
  "발주 추천",
  "소량 검토",
]);

export type PortfolioItemInput = {
  barcode: string;
  group: SalesOrderGroup;
  netRequiredQuantity: number;
  unitCost: number;
  totalScore: number;
  revenueQualifiedMonthCount?: number;
  averageMonthlyRevenueKrw?: number;
  risingStrength?: RisingStrength;
  moq?: number;
  cartonQuantity?: number;
};

export type PortfolioItemResult = PortfolioItemInput & {
  minimumOrderQuantity: number;
  targetQuantity: number;
  allocatedQuantity: number;
  finalGroup: SalesOrderGroup;
  expectedCost: number;
  minimumApplied: boolean;
  minimumReview: boolean;
  budgetReduced: boolean;
};

export type PortfolioAllocationInput = {
  recent30DayRevenue: number;
  grossBudgetOverrideKrw?: number;
  purchaseCostMultiplier?: number;
  minimumOrderAmount?: number;
  items: PortfolioItemInput[];
};

export type PortfolioAllocationResult = {
  grossBudget: number;
  purchaseCostMultiplier: number;
  productOrderBudget: number;
  remainingBudget: number;
  expectedSpend: number;
  groupCounts: Record<SalesOrderGroup, number>;
  items: PortfolioItemResult[];
};

function quantity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function normalizeMultiplier(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_PURCHASE_COST_MULTIPLIER;
  return Math.min(
    MAX_PURCHASE_COST_MULTIPLIER,
    Math.max(MIN_PURCHASE_COST_MULTIPLIER, Math.round(parsed * 100) / 100),
  );
}

export function calculateProductOrderBudget(
  grossBudget: number,
  multiplier: number,
) {
  return Math.max(
    0,
    Math.floor(Math.max(0, grossBudget) / normalizeMultiplier(multiplier)),
  );
}

function roundUpToCarton(quantityValue: number, cartonQuantity = 1) {
  const unit = Math.max(1, Math.round(cartonQuantity));
  return Math.max(0, Math.ceil(quantityValue / unit) * unit);
}

function roundDownToCarton(quantityValue: number, cartonQuantity = 1) {
  const unit = Math.max(1, Math.round(cartonQuantity));
  return Math.max(0, Math.floor(quantityValue / unit) * unit);
}

function groupRank(group: SalesOrderGroup) {
  if (group === "발주 추천") return 0;
  if (group === "소량 검토") return 1;
  return 2;
}

function emptyGroupCounts(): Record<SalesOrderGroup, number> {
  return {
    "발주 추천": 0,
    "소량 검토": 0,
    "발주 보류": 0,
    "데이터 부족": 0,
  };
}

/**
 * Legacy V1 allocator. Existing callers may pass grossBudgetOverrideKrw to
 * constrain funding, but MOQ/carton/minimum economics stay unchanged here.
 * Operational Purchase V2 uses purchaseV2.ts and deliberately ignores
 * MOQ/carton rounding.
 */
export function allocatePurchasePortfolio(
  input: PortfolioAllocationInput,
): PortfolioAllocationResult {
  const recent30DayRevenue = Math.max(
    0,
    Math.round(Number(input.recent30DayRevenue) || 0),
  );
  const override = Number(input.grossBudgetOverrideKrw);
  const grossBudget = Number.isFinite(override)
    ? Math.max(0, Math.round(override))
    : Math.round(recent30DayRevenue / 2);
  const purchaseCostMultiplier = normalizeMultiplier(
    input.purchaseCostMultiplier,
  );
  const productOrderBudget = calculateProductOrderBudget(
    grossBudget,
    purchaseCostMultiplier,
  );
  const minimumOrderAmount = Math.max(
    0,
    Math.round(
      Number(input.minimumOrderAmount ?? DEFAULT_MINIMUM_ORDER_AMOUNT) || 0,
    ),
  );

  const prepared: PortfolioItemResult[] = input.items.map((source) => {
    const netRequiredQuantity = quantity(source.netRequiredQuantity);
    const unitCost = Math.max(0, Number(source.unitCost) || 0);
    const moq = Math.max(1, Math.round(source.moq ?? 1));
    const cartonQuantity = Math.max(
      1,
      Math.round(source.cartonQuantity ?? 1),
    );
    const economicRaw =
      minimumOrderAmount > 0 && unitCost > 0
        ? Math.ceil(minimumOrderAmount / unitCost)
        : 0;
    const minimumOrderQuantity = roundUpToCarton(
      Math.max(moq, economicRaw),
      cartonQuantity,
    );
    const orderable =
      ORDERABLE_GROUPS.has(source.group) && netRequiredQuantity > 0;
    const targetQuantity = orderable
      ? Math.max(netRequiredQuantity, minimumOrderQuantity)
      : 0;
    const minimumApplied = orderable && targetQuantity > netRequiredQuantity;
    const minimumReview =
      minimumApplied &&
      netRequiredQuantity > 0 &&
      targetQuantity >
        Math.max(netRequiredQuantity * 3, netRequiredQuantity + 10);
    const finalGroup =
      minimumReview && source.group === "발주 추천"
        ? ("소량 검토" as const)
        : source.group;

    return {
      ...source,
      netRequiredQuantity,
      unitCost,
      moq,
      cartonQuantity,
      minimumOrderQuantity,
      targetQuantity,
      allocatedQuantity: targetQuantity,
      finalGroup,
      expectedCost: targetQuantity * unitCost,
      minimumApplied,
      minimumReview,
      budgetReduced: false,
    };
  });

  let remainingBudget = productOrderBudget;
  const candidates = prepared
    .filter(
      (entry) =>
        ORDERABLE_GROUPS.has(entry.finalGroup) &&
        entry.unitCost > 0 &&
        entry.targetQuantity > 0,
    )
    .sort((left, right) => {
      const group = groupRank(left.finalGroup) - groupRank(right.finalGroup);
      if (group !== 0) return group;
      return comparePurchaseStrategyPriority(
        { ...left, priorityScore: left.totalScore },
        { ...right, priorityScore: right.totalScore },
      );
    });

  for (const entry of candidates) {
    const desiredCost = entry.targetQuantity * entry.unitCost;
    if (desiredCost <= remainingBudget) {
      remainingBudget -= desiredCost;
      continue;
    }

    const affordableRaw = Math.floor(remainingBudget / entry.unitCost);
    const affordable = Math.min(
      entry.targetQuantity,
      roundDownToCarton(affordableRaw, entry.cartonQuantity),
    );
    entry.allocatedQuantity =
      affordable >= entry.minimumOrderQuantity ? affordable : 0;
    entry.budgetReduced = entry.allocatedQuantity < entry.targetQuantity;
    entry.finalGroup =
      entry.allocatedQuantity > 0
        ? entry.finalGroup
        : ("발주 보류" as const);
    entry.expectedCost = entry.allocatedQuantity * entry.unitCost;
    remainingBudget = Math.max(0, remainingBudget - entry.expectedCost);
  }

  const groupCounts = emptyGroupCounts();
  let expectedSpend = 0;
  for (const entry of prepared) {
    groupCounts[entry.finalGroup] += 1;
    if (ORDERABLE_GROUPS.has(entry.finalGroup)) {
      expectedSpend += entry.expectedCost;
    }
  }

  return {
    grossBudget,
    purchaseCostMultiplier,
    productOrderBudget,
    remainingBudget,
    expectedSpend,
    groupCounts,
    items: prepared,
  };
}
