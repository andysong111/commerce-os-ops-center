export const PURCHASE_V2_RULE_VERSION =
  "commerce-os-purchase-v2.0.0-cash-and-stock-control";
export const PURCHASE_V2_COVERAGE_DAYS = 44;
export const PURCHASE_V2_LEAD_DAYS = 14;
export const PURCHASE_V2_ORDER_CYCLE_DAYS = 30;
export const PURCHASE_V2_DEFAULT_COST_MULTIPLIER = 1.03;
export const PURCHASE_V2_DEFAULT_MINIMUM_LINE_KRW = 5_000;

export type PurchaseV2Pattern =
  | "GROWTH"
  | "STABLE_CORE"
  | "GENERAL"
  | "DECLINING"
  | "DORMANT";

export type PurchaseV2InventorySource =
  | "EXACT_AFTER_STOCKOUT_RESET"
  | "ESTIMATED_BAND"
  | "UNKNOWN";

export type PurchaseV2Decision =
  | "ORDER"
  | "SMALL_REVIEW"
  | "INVENTORY_REVIEW"
  | "HOLD"
  | "DATA_HOLD";

export type PurchaseV2PriceEffect =
  | "DISCOUNT_DRIVEN_GROWTH"
  | "PRICE_POWER_CONFIRMED"
  | "PRICE_RISE_ABSORBED"
  | "PRICE_DROP_WITHOUT_GROWTH"
  | "NEUTRAL"
  | "INSUFFICIENT";

export type PurchaseV2ProductInput = {
  barcode: string;
  name: string;
  modelNo?: string | null;
  monthlyUnits: number[];
  monthlyRevenue: number[];
  unitCostKrw: number;
  inventorySource: PurchaseV2InventorySource;
  inventoryLowQuantity?: number | null;
  inventoryHighQuantity?: number | null;
  openCommitmentQuantity?: number | null;
  recent30StockoutDays?: number | null;
  feedbackMultiplier?: number | null;
};

export type PurchaseV2ScoreBreakdown = {
  stockoutRisk: number;
  stability: number;
  growth: number;
  cashEfficiency: number;
  confidence: number;
  total: number;
};

export type PurchaseV2ProductResult = {
  barcode: string;
  name: string;
  modelNo: string | null;
  ruleVersion: string;
  pattern: PurchaseV2Pattern;
  decision: PurchaseV2Decision;
  monthlyUnits: number[];
  monthlyRevenue: number[];
  observedRecent30Units: number;
  restoredRecent30Units: number;
  stockoutDemandRecovered: number;
  recent30StockoutDays: number;
  currentAverageSellPriceKrw: number;
  priorAverageSellPriceKrw: number;
  priceChangeRate: number | null;
  priceEffect: PurchaseV2PriceEffect;
  feedbackMultiplier: number;
  forecast30Quantity: number;
  target14Quantity: number;
  target30Quantity: number;
  target44Quantity: number;
  inventorySource: PurchaseV2InventorySource;
  inventoryLowQuantity: number;
  inventoryHighQuantity: number;
  openCommitmentQuantity: number;
  lowScenarioNeed: number;
  highScenarioNeed: number;
  urgentNeedQuantity: number;
  normal30NeedQuantity: number;
  recommendedQuantity: number;
  referenceNeedQuantity: number;
  minimumLineReview: boolean;
  expectedProductCostKrw: number;
  grossProfitPerUnitKrw: number;
  score: PurchaseV2ScoreBreakdown;
  reasons: string[];
};

export type PurchaseV2AllocationRound =
  | "URGENT_14_DAY"
  | "STABLE_CORE_30_DAY"
  | "GROWTH_30_DAY"
  | "FULL_44_DAY";

export type PurchaseV2AllocatedProduct = PurchaseV2ProductResult & {
  allocatedQuantity: number;
  expectedAllocatedProductCostKrw: number;
  budgetReduced: boolean;
  allocations: Record<PurchaseV2AllocationRound, number>;
};

export type PurchaseV2PortfolioInput = {
  grossCashBudgetKrw: number;
  purchaseCostMultiplier?: number;
  minimumLineAmountKrw?: number;
  products: PurchaseV2ProductResult[];
};

export type PurchaseV2PortfolioResult = {
  ruleVersion: string;
  grossCashBudgetKrw: number;
  purchaseCostMultiplier: number;
  productOrderBudgetKrw: number;
  expectedProductSpendKrw: number;
  expectedAllInSpendKrw: number;
  remainingProductBudgetKrw: number;
  remainingGrossCashKrw: number;
  recommendedSkuCount: number;
  allocatedSkuCount: number;
  budgetReducedSkuCount: number;
  roundSpendKrw: Record<PurchaseV2AllocationRound, number>;
  products: PurchaseV2AllocatedProduct[];
};

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantity(value: unknown) {
  return Math.max(0, Math.round(number(value)));
}

function money(value: unknown) {
  return Math.max(0, Math.round(number(value)));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]) {
  return values.length ? sum(values) / values.length : 0;
}

function normalizedBuckets(values: number[]) {
  return Array.from({ length: 12 }, (_, index) =>
    Math.max(0, number(values[index] ?? 0)),
  );
}

function coefficientOfVariation(values: number[]) {
  const positive = values.filter((value) => value > 0);
  if (positive.length < 3) return Number.POSITIVE_INFINITY;
  const mean = average(positive);
  if (mean <= 0) return Number.POSITIVE_INFINITY;
  const variance =
    positive.reduce((total, value) => total + (value - mean) ** 2, 0) /
    positive.length;
  return Math.sqrt(variance) / mean;
}

function growthRate(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? 1 : 0;
  return current / previous - 1;
}

function averageSellPrice(revenue: number[], units: number[]) {
  const unitTotal = sum(units);
  if (unitTotal <= 0) return 0;
  return sum(revenue) / unitTotal;
}

function restoreRecent30Demand(
  observedRecent30: number,
  prior30: number,
  recent90Average: number,
  stockoutDaysInput: unknown,
) {
  const stockoutDays = clamp(quantity(stockoutDaysInput), 0, 30);
  if (stockoutDays <= 0) {
    return {
      stockoutDays,
      restoredRecent30: observedRecent30,
      recovered: 0,
    };
  }
  const availableDays = Math.max(0, 30 - stockoutDays);
  let restored = observedRecent30;
  if (availableDays >= 7 && observedRecent30 > 0) {
    const runRate = (observedRecent30 / availableDays) * 30;
    const cap = Math.max(
      observedRecent30,
      observedRecent30 * 2,
      recent90Average * 2.25,
    );
    restored = Math.min(runRate, cap);
  } else if (availableDays < 7) {
    restored = Math.max(observedRecent30, prior30, recent90Average);
  }
  restored = Math.max(observedRecent30, Math.ceil(restored));
  return {
    stockoutDays,
    restoredRecent30: restored,
    recovered: Math.max(0, restored - observedRecent30),
  };
}

function classifyPattern(units: number[], restoredRecent30: number) {
  const recent = restoredRecent30;
  const previous = units[1] ?? 0;
  const twoBack = units[2] ?? 0;
  const recentThree = average([recent, previous, twoBack]);
  const previousThree = average(units.slice(3, 6));
  const activeMonths = units.filter((value) => value > 0).length;
  const recentSix = [recent, ...units.slice(1, 6)];
  const stableCv = coefficientOfVariation(recentSix);
  const sequentialGrowth =
    twoBack > 0 && previous > twoBack * 1.08 && recent > previous * 1.08;
  const relativeGrowth =
    recent >= 5 &&
    recent >= Math.max(previous * 1.2, recentThree * 1.08) &&
    (previousThree <= 0 || recentThree >= previousThree * 1.15);

  if (sum([recent, previous, twoBack]) <= 0) return "DORMANT" as const;
  if (sequentialGrowth || relativeGrowth) return "GROWTH" as const;
  if (
    activeMonths >= 4 &&
    recentThree >= 5 &&
    stableCv <= 0.35 &&
    (previousThree <= 0 || recentThree >= previousThree * 0.82)
  ) {
    return "STABLE_CORE" as const;
  }
  if (
    previous > 0 &&
    recent <= previous * 0.75 &&
    previousThree > 0 &&
    recentThree <= previousThree * 0.82
  ) {
    return "DECLINING" as const;
  }
  return "GENERAL" as const;
}

function priceAdjustment(
  units: number[],
  revenue: number[],
  restoredRecent30: number,
) {
  const currentAverage = averageSellPrice(
    revenue.slice(0, 1),
    units.slice(0, 1),
  );
  const priorAverage = averageSellPrice(
    revenue.slice(1, 3),
    units.slice(1, 3),
  );
  if (currentAverage <= 0 || priorAverage <= 0) {
    return {
      currentAverage,
      priorAverage,
      priceChangeRate: null,
      multiplier: 1,
      effect: "INSUFFICIENT" as const,
    };
  }
  const priceChangeRate = currentAverage / priorAverage - 1;
  const priorUnits = average(units.slice(1, 3));
  const unitGrowth = growthRate(restoredRecent30, priorUnits);

  if (priceChangeRate <= -0.1 && unitGrowth >= 0.1) {
    return {
      currentAverage,
      priorAverage,
      priceChangeRate,
      multiplier: 0.9,
      effect: "DISCOUNT_DRIVEN_GROWTH" as const,
    };
  }
  if (priceChangeRate >= 0.1 && unitGrowth >= -0.05) {
    return {
      currentAverage,
      priorAverage,
      priceChangeRate,
      multiplier: 1.08,
      effect: "PRICE_POWER_CONFIRMED" as const,
    };
  }
  if (priceChangeRate >= 0.1 && unitGrowth >= -0.2) {
    return {
      currentAverage,
      priorAverage,
      priceChangeRate,
      multiplier: 1,
      effect: "PRICE_RISE_ABSORBED" as const,
    };
  }
  if (priceChangeRate <= -0.1 && unitGrowth <= 0) {
    return {
      currentAverage,
      priorAverage,
      priceChangeRate,
      multiplier: 0.95,
      effect: "PRICE_DROP_WITHOUT_GROWTH" as const,
    };
  }
  return {
    currentAverage,
    priorAverage,
    priceChangeRate,
    multiplier: 1,
    effect: "NEUTRAL" as const,
  };
}

function baseForecast(
  pattern: PurchaseV2Pattern,
  units: number[],
  restoredRecent30: number,
) {
  const previousTwo = average(units.slice(1, 3));
  const recentThree = average([restoredRecent30, ...units.slice(1, 3)]);
  const recentSix = average([restoredRecent30, ...units.slice(1, 6)]);
  const fourToSix = average(units.slice(3, 6));
  const annual = average([restoredRecent30, ...units.slice(1, 12)]);

  if (pattern === "GROWTH") {
    const value =
      restoredRecent30 * 0.55 + previousTwo * 0.3 + fourToSix * 0.15;
    return Math.max(
      restoredRecent30,
      Math.min(value * 1.1, Math.max(restoredRecent30, recentThree * 1.5)),
    );
  }
  if (pattern === "STABLE_CORE") {
    return recentThree * 0.6 + recentSix * 0.3 + annual * 0.1;
  }
  if (pattern === "DECLINING") {
    return Math.min(
      restoredRecent30,
      restoredRecent30 * 0.6 + previousTwo * 0.3 + fourToSix * 0.1,
    );
  }
  if (pattern === "DORMANT") return 0;
  return (
    restoredRecent30 * 0.4 +
    previousTwo * 0.3 +
    fourToSix * 0.2 +
    annual * 0.1
  );
}

function patternScores(pattern: PurchaseV2Pattern) {
  if (pattern === "GROWTH") return { stability: 8, growth: 20 };
  if (pattern === "STABLE_CORE") return { stability: 20, growth: 8 };
  if (pattern === "GENERAL") return { stability: 9, growth: 6 };
  if (pattern === "DECLINING") return { stability: 3, growth: 1 };
  return { stability: 0, growth: 0 };
}

function stockoutRiskScore(daysCover: number, exactZero: boolean) {
  if (exactZero) return 30;
  if (daysCover <= 7) return 28;
  if (daysCover <= 14) return 23;
  if (daysCover <= 30) return 13;
  if (daysCover <= 44) return 7;
  return 2;
}

export function calculatePurchaseV2Product(
  input: PurchaseV2ProductInput,
  minimumLineAmountKrw = PURCHASE_V2_DEFAULT_MINIMUM_LINE_KRW,
): PurchaseV2ProductResult {
  const monthlyUnits = normalizedBuckets(input.monthlyUnits);
  const monthlyRevenue = normalizedBuckets(input.monthlyRevenue);
  const observedRecent30Units = quantity(monthlyUnits[0]);
  const recent90Average = average(monthlyUnits.slice(0, 3));
  const restored = restoreRecent30Demand(
    observedRecent30Units,
    monthlyUnits[1] ?? 0,
    recent90Average,
    input.recent30StockoutDays,
  );
  const pattern = classifyPattern(monthlyUnits, restored.restoredRecent30);
  const price = priceAdjustment(
    monthlyUnits,
    monthlyRevenue,
    restored.restoredRecent30,
  );
  const feedbackMultiplier = clamp(
    number(input.feedbackMultiplier) || 1,
    0.75,
    1.25,
  );
  const forecastRaw =
    baseForecast(pattern, monthlyUnits, restored.restoredRecent30) *
    price.multiplier *
    feedbackMultiplier;
  const forecast30Quantity = Math.max(0, Math.ceil(forecastRaw));
  const target14Quantity = Math.ceil(
    (forecast30Quantity * PURCHASE_V2_LEAD_DAYS) / 30,
  );
  const target30Quantity = forecast30Quantity;
  const target44Quantity = Math.ceil(
    (forecast30Quantity * PURCHASE_V2_COVERAGE_DAYS) / 30,
  );

  const inventoryLowQuantity = quantity(input.inventoryLowQuantity);
  const inventoryHighQuantity = Math.max(
    inventoryLowQuantity,
    quantity(input.inventoryHighQuantity ?? input.inventoryLowQuantity),
  );
  const openCommitmentQuantity = quantity(input.openCommitmentQuantity);
  const lowScenarioNeed = Math.max(
    0,
    target44Quantity - inventoryLowQuantity - openCommitmentQuantity,
  );
  const highScenarioNeed = Math.max(
    0,
    target44Quantity - inventoryHighQuantity - openCommitmentQuantity,
  );
  const securedHigh = inventoryHighQuantity + openCommitmentQuantity;
  const urgentNeedQuantity = Math.max(0, target14Quantity - securedHigh);
  const normal30NeedQuantity = Math.max(0, target30Quantity - securedHigh);

  let decision: PurchaseV2Decision = "HOLD";
  let recommendedQuantity = 0;
  const referenceNeedQuantity = Math.max(lowScenarioNeed, highScenarioNeed);
  if (pattern === "DORMANT" || target44Quantity <= 0) {
    decision = "HOLD";
  } else if (money(input.unitCostKrw) <= 0) {
    decision = "DATA_HOLD";
  } else if (input.inventorySource === "UNKNOWN") {
    decision = "INVENTORY_REVIEW";
  } else if (lowScenarioNeed > 0 && highScenarioNeed > 0) {
    recommendedQuantity = Math.min(lowScenarioNeed, highScenarioNeed);
    decision = "ORDER";
  } else if (lowScenarioNeed === 0 && highScenarioNeed === 0) {
    decision = "HOLD";
  } else {
    decision = "INVENTORY_REVIEW";
  }

  const unitCostKrw = money(input.unitCostKrw);
  const minimumLineReview =
    decision === "ORDER" &&
    recommendedQuantity > 0 &&
    recommendedQuantity * unitCostKrw < Math.max(0, minimumLineAmountKrw);
  if (minimumLineReview) decision = "SMALL_REVIEW";

  const sellPrice =
    price.currentAverage > 0 ? price.currentAverage : price.priorAverage;
  const grossProfitPerUnitKrw = Math.max(0, sellPrice - unitCostKrw);
  const dailyDemand = forecast30Quantity / 30;
  const daysCover =
    dailyDemand > 0
      ? (inventoryHighQuantity + openCommitmentQuantity) / dailyDemand
      : 999;
  const exactZero =
    input.inventorySource === "EXACT_AFTER_STOCKOUT_RESET" &&
    inventoryHighQuantity <= 0;
  const stockoutRisk = stockoutRiskScore(daysCover, exactZero);
  const patternScore = patternScores(pattern);
  const cashReturnRate =
    unitCostKrw > 0 ? grossProfitPerUnitKrw / unitCostKrw : 0;
  const cashEfficiency = Math.round(clamp(cashReturnRate / 1.5, 0, 1) * 20);
  const activeMonths = monthlyUnits.filter((value) => value > 0).length;
  let confidenceFactor = 0.35;
  if (activeMonths >= 3) confidenceFactor += 0.15;
  if (activeMonths >= 6) confidenceFactor += 0.15;
  if (sum(monthlyUnits.slice(0, 2)) >= 10) confidenceFactor += 0.1;
  if (input.inventorySource === "EXACT_AFTER_STOCKOUT_RESET") {
    confidenceFactor += 0.15;
  } else if (input.inventorySource === "ESTIMATED_BAND") {
    confidenceFactor += 0.08;
  }
  if (price.currentAverage > 0 && price.priorAverage > 0) confidenceFactor += 0.1;
  const confidence = Math.round(clamp(confidenceFactor, 0, 1) * 10);
  const totalScore = Math.round(
    stockoutRisk +
      patternScore.stability +
      patternScore.growth +
      cashEfficiency +
      confidence,
  );

  const reasons: string[] = [];
  if (restored.recovered > 0) {
    reasons.push(
      `최근 30일 중 품절 ${restored.stockoutDays}일을 반영해 관측 ${observedRecent30Units}개를 잠재수요 ${restored.restoredRecent30}개로 복원했습니다.`,
    );
  }
  if (pattern === "GROWTH") {
    reasons.push("현재 매출 규모가 작아도 최근 연속 상승을 성장형으로 보호했습니다.");
  } else if (pattern === "STABLE_CORE") {
    reasons.push("최근 여러 구간에서 일정 판매를 유지해 핵심 안정형으로 분류했습니다.");
  } else if (pattern === "DECLINING") {
    reasons.push("최근 하락을 빠르게 반영해 과거 평균의 영향과 발주량을 줄였습니다.");
  }
  if (price.effect === "DISCOUNT_DRIVEN_GROWTH") {
    reasons.push("가격 인하 뒤 판매증가라 자연성장을 전부 인정하지 않고 감액했습니다.");
  } else if (price.effect === "PRICE_POWER_CONFIRMED") {
    reasons.push("가격을 올렸는데도 판매가 유지돼 강한 수요 신호로 반영했습니다.");
  }
  reasons.push(
    `30일 예상 ${forecast30Quantity}개를 14일 리드타임+30일 발주주기, 총 44일 목표 ${target44Quantity}개로 환산했습니다.`,
  );
  reasons.push(
    `재고 ${inventoryLowQuantity}~${inventoryHighQuantity}개와 미입고 ${openCommitmentQuantity}개를 차감했습니다.`,
  );
  if (minimumLineReview) {
    reasons.push("필요수량을 늘리지는 않고 5,000원 미만 소액 주문으로만 검토 표시했습니다.");
  }

  return {
    barcode: String(input.barcode ?? "").trim().toUpperCase(),
    name: String(input.name ?? "").trim() || String(input.barcode ?? ""),
    modelNo: String(input.modelNo ?? "").trim() || null,
    ruleVersion: PURCHASE_V2_RULE_VERSION,
    pattern,
    decision,
    monthlyUnits,
    monthlyRevenue,
    observedRecent30Units,
    restoredRecent30Units: restored.restoredRecent30,
    stockoutDemandRecovered: restored.recovered,
    recent30StockoutDays: restored.stockoutDays,
    currentAverageSellPriceKrw: money(price.currentAverage),
    priorAverageSellPriceKrw: money(price.priorAverage),
    priceChangeRate:
      price.priceChangeRate === null ? null : round(price.priceChangeRate),
    priceEffect: price.effect,
    feedbackMultiplier: round(feedbackMultiplier),
    forecast30Quantity,
    target14Quantity,
    target30Quantity,
    target44Quantity,
    inventorySource: input.inventorySource,
    inventoryLowQuantity,
    inventoryHighQuantity,
    openCommitmentQuantity,
    lowScenarioNeed,
    highScenarioNeed,
    urgentNeedQuantity: Math.min(referenceNeedQuantity, urgentNeedQuantity),
    normal30NeedQuantity: Math.min(referenceNeedQuantity, normal30NeedQuantity),
    recommendedQuantity,
    referenceNeedQuantity,
    minimumLineReview,
    expectedProductCostKrw: recommendedQuantity * unitCostKrw,
    grossProfitPerUnitKrw: money(grossProfitPerUnitKrw),
    score: {
      stockoutRisk,
      stability: patternScore.stability,
      growth: patternScore.growth,
      cashEfficiency,
      confidence,
      total: totalScore,
    },
    reasons: reasons.slice(0, 6),
  };
}

function normalizedCostMultiplier(value: unknown) {
  const parsed = number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return PURCHASE_V2_DEFAULT_COST_MULTIPLIER;
  }
  return clamp(Math.round(parsed * 100) / 100, 1, 3);
}

function emptyRoundRecord(): Record<PurchaseV2AllocationRound, number> {
  return {
    URGENT_14_DAY: 0,
    STABLE_CORE_30_DAY: 0,
    GROWTH_30_DAY: 0,
    FULL_44_DAY: 0,
  };
}

function sortByPriority(
  left: PurchaseV2AllocatedProduct,
  right: PurchaseV2AllocatedProduct,
) {
  return (
    right.score.total - left.score.total ||
    right.score.cashEfficiency - left.score.cashEfficiency ||
    left.barcode.localeCompare(right.barcode, "ko")
  );
}

export function allocatePurchaseV2Portfolio(
  input: PurchaseV2PortfolioInput,
): PurchaseV2PortfolioResult {
  const grossCashBudgetKrw = money(input.grossCashBudgetKrw);
  const purchaseCostMultiplier = normalizedCostMultiplier(
    input.purchaseCostMultiplier,
  );
  const productOrderBudgetKrw = Math.floor(
    grossCashBudgetKrw / purchaseCostMultiplier,
  );
  const minimumLineAmountKrw = money(
    input.minimumLineAmountKrw ?? PURCHASE_V2_DEFAULT_MINIMUM_LINE_KRW,
  );
  const products: PurchaseV2AllocatedProduct[] = input.products.map((product) => ({
    ...product,
    allocatedQuantity: 0,
    expectedAllocatedProductCostKrw: 0,
    budgetReduced: false,
    allocations: emptyRoundRecord(),
  }));
  let remaining = productOrderBudgetKrw;
  const roundSpendKrw = emptyRoundRecord();

  const eligible = products.filter(
    (product) =>
      product.decision === "ORDER" &&
      product.recommendedQuantity > 0 &&
      product.expectedProductCostKrw >= minimumLineAmountKrw &&
      product.expectedProductCostKrw > 0,
  );

  const allocateRound = (
    roundName: PurchaseV2AllocationRound,
    candidates: PurchaseV2AllocatedProduct[],
    target: (product: PurchaseV2AllocatedProduct) => number,
  ) => {
    for (const product of [...candidates].sort(sortByPriority)) {
      if (remaining <= 0) break;
      const unitCost =
        product.recommendedQuantity > 0
          ? product.expectedProductCostKrw / product.recommendedQuantity
          : 0;
      if (unitCost <= 0) continue;
      const desiredTotal = Math.min(
        product.recommendedQuantity,
        quantity(target(product)),
      );
      let need = Math.max(0, desiredTotal - product.allocatedQuantity);
      if (need <= 0) continue;
      const minimumFirstQuantity =
        product.allocatedQuantity > 0 || minimumLineAmountKrw <= 0
          ? 1
          : Math.ceil(minimumLineAmountKrw / unitCost);
      if (
        product.allocatedQuantity === 0 &&
        Math.min(need, Math.floor(remaining / unitCost)) < minimumFirstQuantity
      ) {
        continue;
      }
      if (product.allocatedQuantity === 0) {
        need = Math.max(need, minimumFirstQuantity);
      }
      need = Math.min(
        need,
        product.recommendedQuantity - product.allocatedQuantity,
      );
      const affordable = Math.floor(remaining / unitCost);
      const allocated = Math.max(0, Math.min(need, affordable));
      if (allocated <= 0) continue;
      const spend = Math.round(allocated * unitCost);
      product.allocatedQuantity += allocated;
      product.allocations[roundName] += allocated;
      product.expectedAllocatedProductCostKrw += spend;
      roundSpendKrw[roundName] += spend;
      remaining = Math.max(0, remaining - spend);
    }
  };

  allocateRound(
    "URGENT_14_DAY",
    eligible.filter((product) => product.urgentNeedQuantity > 0),
    (product) => product.urgentNeedQuantity,
  );
  allocateRound(
    "STABLE_CORE_30_DAY",
    eligible.filter((product) => product.pattern === "STABLE_CORE"),
    (product) =>
      Math.max(product.urgentNeedQuantity, product.normal30NeedQuantity),
  );
  allocateRound(
    "GROWTH_30_DAY",
    eligible.filter((product) => product.pattern === "GROWTH"),
    (product) =>
      Math.max(product.urgentNeedQuantity, product.normal30NeedQuantity),
  );
  allocateRound(
    "FULL_44_DAY",
    eligible,
    (product) => product.recommendedQuantity,
  );

  for (const product of products) {
    product.budgetReduced =
      product.decision === "ORDER" &&
      product.allocatedQuantity < product.recommendedQuantity;
  }
  const expectedProductSpendKrw = products.reduce(
    (total, product) => total + product.expectedAllocatedProductCostKrw,
    0,
  );
  const expectedAllInSpendKrw = Math.min(
    grossCashBudgetKrw,
    Math.round(expectedProductSpendKrw * purchaseCostMultiplier),
  );

  return {
    ruleVersion: PURCHASE_V2_RULE_VERSION,
    grossCashBudgetKrw,
    purchaseCostMultiplier,
    productOrderBudgetKrw,
    expectedProductSpendKrw,
    expectedAllInSpendKrw,
    remainingProductBudgetKrw: Math.max(0, remaining),
    remainingGrossCashKrw: Math.max(
      0,
      grossCashBudgetKrw - expectedAllInSpendKrw,
    ),
    recommendedSkuCount: products.filter(
      (product) =>
        product.decision === "ORDER" && product.recommendedQuantity > 0,
    ).length,
    allocatedSkuCount: products.filter(
      (product) => product.allocatedQuantity > 0,
    ).length,
    budgetReducedSkuCount: products.filter((product) => product.budgetReduced)
      .length,
    roundSpendKrw,
    products: products.sort((left, right) => {
      const allocated =
        Number(right.allocatedQuantity > 0) -
        Number(left.allocatedQuantity > 0);
      if (allocated !== 0) return allocated;
      return sortByPriority(left, right);
    }),
  };
}
