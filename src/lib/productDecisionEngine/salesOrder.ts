import {
  evaluatePurchaseStrategy,
  type CalendarMonthSales,
  type PurchaseStrategyEvaluation,
  type PurchaseStrategyPolicyInput,
} from "./purchaseStrategyPolicy.ts";

export const SALES_ORDER_RULE_VERSION =
  "commerce-os-sales-order-v2.0.0-purchase-strategy";

export const PURCHASE_MONTHLY_REVENUE_FLOOR_KRW = 40_000;
export const PURCHASE_STOCKOUT_HISTORY_UNIT_FLOOR = 10;
export const PURCHASE_STOCKOUT_LOOKBACK_BUCKETS = 5;

export type SalesOrderEntrySignal =
  | "STOCKOUT_DEMAND_RECOVERY"
  | "RECENT_RISING"
  | "MONTHLY_REVENUE_40000"
  | "HISTORICAL_REVENUE_THRESHOLD"
  | "NEW_PRODUCT_PROTECTION"
  | "HIGH_VALUE_CONSISTENT"
  | "PERMANENTLY_DISCONTINUED";

export type SalesOrderGroup =
  | "발주 추천"
  | "소량 검토"
  | "발주 보류"
  | "데이터 부족";

export type SeasonState =
  | "시즌 진입"
  | "시즌 중"
  | "시즌 종료 임박"
  | "비시즌"
  | "계절성 불명확";

export interface SalesOrderInput {
  monthlyUnits: number[];
  monthlyRevenue: number[];
  unitCost: number;
  weightedClaimRate: number;
  salesPowerFactor: number;
  moq?: number;
  cartonQuantity?: number;
  inventoryKnown?: boolean;
  availableQuantity?: number;
  incomingQuantity?: number;
  ledgerCommitment?: number;
  calendarMonthlySales?: CalendarMonthSales[];
  strategyAsOf?: string;
  strategyPolicy?: PurchaseStrategyPolicyInput;
  firstSaleAt?: string | null;
  launchedAt?: string | null;
  leadTimeDays?: number;
  permanentlyDiscontinued?: boolean;
}

export interface SalesOrderResult {
  ruleVersion: string;
  group: SalesOrderGroup;
  priorityScore: number;
  forecastUnits: number;
  rawRecommendedQuantity: number;
  recommendedQuantity: number;
  oneMonthGrowthRate: number;
  twoMonthGrowthRate: number;
  recentThreeMonthAverage: number;
  activeSalesMonths: number;
  trendLabel: "급상승" | "상승" | "유지" | "하락" | "급하락";
  seasonState: SeasonState;
  confidence: number;
  entrySignals: SalesOrderEntrySignal[];
  recoveredStockoutDemandUnits: number;
  weightedClaimRate: number;
  averageSellingPriceKrw: number;
  strategy: PurchaseStrategyEvaluation | null;
  reasons: string[];
  missingData: string[];
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]) {
  return values.length ? sum(values) / values.length : 0;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function growth(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function quantity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

export function roundOrderQuantity(
  quantity: number,
  moq = 1,
  cartonQuantity = 1,
) {
  if (quantity <= 0) return 0;
  const minimum = Math.max(1, Math.round(moq));
  const unit = Math.max(1, Math.round(cartonQuantity));
  return Math.ceil(Math.max(quantity, minimum) / unit) * unit;
}

function seasonState(units: number[]): SeasonState {
  const total = sum(units);
  const active = units.filter((value) => value > 0).length;
  if (total <= 0 || active < 6) return "계절성 불명확";

  const sorted = [...units].sort((left, right) => right - left);
  const concentration = sum(sorted.slice(0, 3)) / total;
  if (concentration < 0.55) return "계절성 불명확";

  const recent = units[0] ?? 0;
  const recentThree = average(units.slice(0, 3));
  const previousThree = average(units.slice(3, 6));
  const annualAverage = average(units);

  if (
    recentThree >= annualAverage * 1.35 &&
    recentThree >= previousThree * 1.15
  ) {
    return recent >= recentThree ? "시즌 중" : "시즌 진입";
  }
  if (
    previousThree >= annualAverage * 1.35 &&
    recentThree <= previousThree * 0.72
  ) {
    return "시즌 종료 임박";
  }
  if (recentThree <= annualAverage * 0.55) return "비시즌";
  return "계절성 불명확";
}

function trendLabel(oneMonth: number, twoMonth: number, sample: number) {
  if (sample < 10) return "유지" as const;
  if (oneMonth >= 30 && twoMonth >= 15) return "급상승" as const;
  if (oneMonth >= 10 || twoMonth >= 10) return "상승" as const;
  if (oneMonth <= -30 && twoMonth <= -15) return "급하락" as const;
  if (oneMonth <= -10 || twoMonth <= -10) return "하락" as const;
  return "유지" as const;
}

export function calculateSalesOrderRecommendation(
  input: SalesOrderInput,
): SalesOrderResult {
  const units = Array.from({ length: 12 }, (_, index) =>
    Math.max(0, Number(input.monthlyUnits[index] ?? 0)),
  );
  const revenue = Array.from({ length: 12 }, (_, index) =>
    Math.max(0, Number(input.monthlyRevenue[index] ?? 0)),
  );

  const recentOne = units[0];
  const previousOne = units[1];
  const recentTwoAverage = average(units.slice(0, 2));
  const priorTwoAverage = average(units.slice(2, 4));
  const recentTwoToThreeAverage = average(units.slice(1, 3));
  const recentFourToSixAverage = average(units.slice(3, 6));
  const annualAverage = average(units);
  const recentThreeMonthAverage = average(units.slice(0, 3));
  const recent60Units = sum(units.slice(0, 2));
  const recent90Units = sum(units.slice(0, 3));
  const annualUnits = sum(units);
  const activeSalesMonths = units.filter((value) => value > 0).length;

  const oneMonthGrowthRate = growth(recentOne, previousOne);
  const twoMonthGrowthRate = growth(recentTwoAverage, priorTwoAverage);
  const trend = trendLabel(oneMonthGrowthRate, twoMonthGrowthRate, recent60Units);
  const season = seasonState(units);
  const recentHistoryUnits = units
    .slice(1, PURCHASE_STOCKOUT_LOOKBACK_BUCKETS + 1)
    .filter((value) => value > 0);
  const recentHistoryRevenue = revenue.slice(
    1,
    PURCHASE_STOCKOUT_LOOKBACK_BUCKETS + 1,
  );
  const confirmedSoldOut =
    input.inventoryKnown === true &&
    quantity(input.availableQuantity) === 0 &&
    quantity(input.incomingQuantity) === 0 &&
    quantity(input.ledgerCommitment) === 0;
  const strongRecentHistory =
    Math.max(0, ...recentHistoryUnits) >=
      PURCHASE_STOCKOUT_HISTORY_UNIT_FLOOR ||
    Math.max(0, ...recentHistoryRevenue) >=
      PURCHASE_MONTHLY_REVENUE_FLOOR_KRW;
  const stockoutDemandRecovery =
    confirmedSoldOut && recentOne === 0 && strongRecentHistory;
  const recoveredStockoutDemandUnits = stockoutDemandRecovery
    ? Math.max(1, Math.ceil(average(recentHistoryUnits)))
    : 0;
  const risingEntry = trend === "상승" || trend === "급상승";
  const monthlyRevenueEntry = revenue[0] >= PURCHASE_MONTHLY_REVENUE_FLOOR_KRW;
  const entrySignals: SalesOrderEntrySignal[] = [
    ...(stockoutDemandRecovery
      ? (["STOCKOUT_DEMAND_RECOVERY"] as const)
      : []),
    ...(risingEntry ? (["RECENT_RISING"] as const) : []),
    ...(monthlyRevenueEntry
      ? (["MONTHLY_REVENUE_40000"] as const)
      : []),
  ];

  const weightedBase =
    recentOne * 0.4 +
    recentTwoToThreeAverage * 0.3 +
    recentFourToSixAverage * 0.2 +
    annualAverage * 0.1;

  let trendMultiplier = 1;
  if (recent60Units >= 10) {
    if (oneMonthGrowthRate >= 10 && twoMonthGrowthRate >= 5) {
      trendMultiplier = 1.2;
    } else if (oneMonthGrowthRate >= 10 || twoMonthGrowthRate >= 10) {
      trendMultiplier = 1.1;
    } else if (oneMonthGrowthRate <= -10 && twoMonthGrowthRate <= -10) {
      trendMultiplier = 0.7;
    } else if (oneMonthGrowthRate <= -10 || twoMonthGrowthRate <= -10) {
      trendMultiplier = 0.85;
    }
  }

  const seasonMultiplier =
    season === "시즌 진입"
      ? 1.1
      : season === "시즌 중"
        ? 1.05
        : season === "시즌 종료 임박"
          ? 0.7
          : season === "비시즌"
            ? 0.5
            : 1;

  const strategyEnabled =
    Array.isArray(input.calendarMonthlySales) && Boolean(input.strategyAsOf);
  const legacyClaimMultiplier =
    input.weightedClaimRate >= 20
      ? 0.5
      : input.weightedClaimRate >= 10
        ? 0.7
        : input.weightedClaimRate >= 5
          ? 0.85
          : 1;
  const claimMultiplier = strategyEnabled ? 1 : legacyClaimMultiplier;

  const safetyMultiplier = recent90Units > 0 ? 1.1 : 1;
  const normalForecast = Math.max(
    0,
    weightedBase *
      trendMultiplier *
      seasonMultiplier *
      claimMultiplier *
      safetyMultiplier,
  );
  const recoveredForecast = stockoutDemandRecovery
    ? recoveredStockoutDemandUnits * seasonMultiplier * claimMultiplier
    : 0;
  const forecast = Math.max(normalForecast, recoveredForecast);

  const rising = trend === "상승" || trend === "급상승";
  const falling = trend === "하락" || trend === "급하락";
  const cap = falling
    ? recentOne
    : recentThreeMonthAverage * (rising ? 1.5 : 1.3);
  const recoveredCap = recoveredStockoutDemandUnits * 1.3;
  const capped = stockoutDemandRecovery
    ? Math.min(forecast, Math.max(1, recoveredCap))
    : recent90Units <= 0
      ? 0
      : Math.min(forecast, Math.max(0, cap));
  const legacyRawRecommendedQuantity = Math.max(0, Math.ceil(capped));
  const strategy =
    strategyEnabled && input.strategyAsOf
      ? evaluatePurchaseStrategy({
          monthlySales: input.calendarMonthlySales ?? [],
          monthlyDemandUnits: Math.max(0, Math.ceil(forecast)),
          asOf: input.strategyAsOf,
          policy: input.strategyPolicy,
          firstSaleAt: input.firstSaleAt,
          launchedAt: input.launchedAt,
          recent60DayUnits: recent60Units,
          weightedClaimRate: input.weightedClaimRate,
          leadTimeDays: input.leadTimeDays,
          permanentlyDiscontinued: input.permanentlyDiscontinued,
        })
      : null;
  if (strategy?.history.qualifiedMonthCount) {
    entrySignals.push("HISTORICAL_REVENUE_THRESHOLD");
  }
  if (strategy?.newProduct) entrySignals.push("NEW_PRODUCT_PROTECTION");
  if (strategy?.highValueConsistentProduct) {
    entrySignals.push("HIGH_VALUE_CONSISTENT");
  }
  if (strategy?.permanentlyDiscontinued) {
    entrySignals.push("PERMANENTLY_DISCONTINUED");
  }
  const rawRecommendedQuantity = strategy
    ? strategy.grossDemandTarget
    : legacyRawRecommendedQuantity;
  const recommendedQuantity = roundOrderQuantity(
    rawRecommendedQuantity,
    input.moq,
    input.cartonQuantity,
  );

  const missingData: string[] = [];
  if (annualUnits <= 0) missingData.push("판매 이력");
  if (input.unitCost <= 0) missingData.push("원가");

  let confidence = 1;
  if (activeSalesMonths < 3) confidence -= 0.35;
  else if (activeSalesMonths < 6) confidence -= 0.15;
  if (recent60Units < 10) confidence -= 0.2;
  if (input.unitCost <= 0) confidence -= 0.1;
  confidence = round(clamp(confidence, 0.25, 1), 2);

  const recentRevenue = sum(revenue.slice(0, 3));
  const averageSellPrice =
    recent90Units > 0 ? recentRevenue / recent90Units : 0;
  const grossMarginRate =
    averageSellPrice > 0 && input.unitCost > 0
      ? (averageSellPrice - input.unitCost) / averageSellPrice
      : 0;
  const marginScore =
    grossMarginRate >= 0.45
      ? 15
      : grossMarginRate >= 0.3
        ? 12
        : grossMarginRate > 0
          ? 8
          : 3;
  const trendScore =
    trend === "급상승"
      ? 25
      : trend === "상승"
        ? 20
        : trend === "유지"
          ? 13
          : trend === "하락"
            ? 6
            : 2;
  const consistencyScore = Math.round(
    clamp(activeSalesMonths / 12, 0, 1) * 15,
  );
  const claimScore = strategy
    ? 10
    : input.weightedClaimRate < 3
      ? 10
      : input.weightedClaimRate < 7
        ? 7
        : input.weightedClaimRate < 12
          ? 4
          : 1;
  const salesPowerScore = Math.round(
    clamp(input.salesPowerFactor, 0, 1) * 35,
  );
  const strategyQualificationScore = strategy
    ? Math.min(24, strategy.history.qualifiedMonthCount * 2) +
      (strategy.history.risingStrength === "STRONG"
        ? 15
        : strategy.history.risingStrength === "MODERATE"
          ? 10
          : strategy.history.risingStrength === "MILD"
            ? 5
            : 0) +
      strategy.priorityScoreAdjustment
    : 0;
  const priorityScore = Math.max(0, Math.round(
    (salesPowerScore +
      trendScore +
      consistencyScore +
      claimScore +
      marginScore) *
      confidence +
      strategyQualificationScore,
  ));

  let group: SalesOrderGroup;
  if (strategy?.decision === "DISCONTINUED") group = "발주 보류";
  else if (strategy && !strategy.recommended) group = "발주 보류";
  else if (strategy?.recommended && recommendedQuantity > 0) {
    group = "발주 추천";
  } else if (annualUnits <= 0) group = "데이터 부족";
  else if (recommendedQuantity <= 0 || input.weightedClaimRate >= 20) {
    group = "발주 보류";
  } else if (entrySignals.length > 0) {
    group = "발주 추천";
  } else if (recent90Units <= 0) {
    group = "발주 보류";
  } else if (
    activeSalesMonths < 3 ||
    recent60Units < 10 ||
    confidence < 0.65
  ) {
    group = "소량 검토";
  } else {
    group = "발주 추천";
  }

  const reasons: string[] = [];
  reasons.push(
    `요청시점 최근 판매에 가중치를 둔 다음 30일 예상판매량은 약 ${Math.max(0, Math.round(forecast))}개입니다.`,
  );
  if (recent60Units < 10 && entrySignals.length === 0) {
    reasons.push("최근 60일 판매 표본이 적어 소량 검토로 제한했습니다.");
  } else if (recent60Units < 10) {
    reasons.push("최근 판매 표본은 적지만 별도 발주 진입 신호를 확인했습니다.");
  } else if (trend === "급상승" || trend === "상승") {
    reasons.push(
      `최근 판매 흐름이 ${trend}이지만 1회 증액 상한을 적용했습니다.`,
    );
  } else if (trend === "급하락" || trend === "하락") {
    reasons.push(
      `최근 판매 흐름이 ${trend}하여 권장수량을 보수적으로 줄였습니다.`,
    );
  } else {
    reasons.push("최근 판매 흐름이 안정적이어서 10% 안전여유를 적용했습니다.");
  }
  if (stockoutDemandRecovery) {
    reasons.push(
      `확인재고 0개 상태에서 최근 판매가 0으로 눌렸지만 직전 판매 이력이 강해 월수요 ${recoveredStockoutDemandUnits}개를 복원했습니다.`,
    );
  }
  if (monthlyRevenueEntry) {
    reasons.push(
      `최근 30일 매출이 ${PURCHASE_MONTHLY_REVENUE_FLOOR_KRW.toLocaleString("ko-KR")}원 이상이라 발주후보에 포함했습니다.`,
    );
  }
  if (season !== "계절성 불명확") {
    reasons.push(`최근 12개 30일 구간 패턴을 ${season}으로 판단했습니다.`);
  }
  if (input.weightedClaimRate >= 5) {
    reasons.push(
      strategy
        ? "클레임 위험은 권장수량을 줄이지 않고 우선순위 감점으로만 반영했습니다."
        : "클레임 위험을 반영해 권장수량을 감액했습니다.",
    );
  }
  if (strategy) reasons.push(...strategy.reasons);

  return {
    ruleVersion: SALES_ORDER_RULE_VERSION,
    group,
    priorityScore,
    forecastUnits: Math.max(0, Math.ceil(forecast)),
    rawRecommendedQuantity,
    recommendedQuantity,
    oneMonthGrowthRate: round(oneMonthGrowthRate),
    twoMonthGrowthRate: round(twoMonthGrowthRate),
    recentThreeMonthAverage: round(recentThreeMonthAverage),
    activeSalesMonths,
    trendLabel: trend,
    seasonState: season,
    confidence,
    entrySignals,
    recoveredStockoutDemandUnits,
    weightedClaimRate: round(input.weightedClaimRate, 2),
    averageSellingPriceKrw: Math.round(averageSellPrice),
    strategy,
    reasons: [...new Set(reasons)].slice(0, 8),
    missingData,
  };
}
