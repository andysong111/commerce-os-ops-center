export const PURCHASE_STRATEGY_POLICY_VERSION =
  "commerce-os-purchase-strategy-policy-v1.0.0";

export const DEFAULT_MONTHLY_REVENUE_THRESHOLD_KRW = 40_000;
export const MIN_MONTHLY_REVENUE_THRESHOLD_KRW = 10_000;
export const MAX_MONTHLY_REVENUE_THRESHOLD_KRW = 10_000_000;
export const MONTHLY_REVENUE_THRESHOLD_STEP_KRW = 1_000;

const ANALYSIS_WINDOW_MONTHS = 12;
const RISING_WINDOW_MONTHS = 3;
const NEW_PRODUCT_PROTECTION_DAYS = 365;
const BASE_COVERAGE_MONTHS = 1.5;
const AUTOMATIC_COVERAGE_CAP_MONTHS = 4;
const HIGH_VALUE_AVERAGE_SELLING_PRICE_KRW = 20_000;
const CONSISTENT_PERFORMER_MONTH_FLOOR = 8;
const HERO_RECENT_REVENUE_THRESHOLD_MULTIPLIER = 3;

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000;
const KOREA_TIME_OFFSET_MILLISECONDS = 9 * 60 * 60 * 1_000;

export type RisingStrength = "NONE" | "MILD" | "MODERATE" | "STRONG";

export type CalendarMonthSales = {
  month: string;
  units: number;
  revenue: number;
};

export type PurchaseStrategyPolicyInput = {
  monthlyRevenueThresholdKrw?: unknown;
  newProductProtectionDays?: unknown;
  baseCoverageMonths?: unknown;
  risingCoverageMonths?: {
    MILD?: unknown;
    MODERATE?: unknown;
    STRONG?: unknown;
  };
  automaticCoverageCapMonths?: unknown;
  manualHeroMaxCoverageMonths?: unknown;
};

export type PurchaseStrategyPolicy = Readonly<{
  policyVersion: string;
  monthlyRevenueThresholdKrw: number;
  analysisWindowMonths: 12;
  risingWindowMonths: 3;
  newProductProtectionDays: number;
  baseCoverageMonths: number;
  risingCoverageMonths: Readonly<{
    MILD: number;
    MODERATE: number;
    STRONG: number;
  }>;
  consistentPerformerCoverageMonths: number;
  automaticCoverageCapMonths: number;
  manualReviewCoverageMonths: readonly [number, number];
  consistentPerformerQualifiedMonthFloor: 8;
  highValueAverageSellingPriceKrw: 20_000;
}>;

export type PurchaseHistoryAnalysis = {
  completedMonths: CalendarMonthSales[];
  qualifiedMonthCount: number;
  qualificationLabel: string;
  latestQualifiedMonth: string | null;
  recentThreeQualifiedMonthCount: number;
  previousThreeQualifiedMonthCount: number;
  recentThreeAverageRevenue: number;
  previousThreeAverageRevenue: number;
  recentToPreviousRevenueGrowthRate: number;
  risingStrength: RisingStrength;
  averageSellingPriceKrw: number;
  consistentPerformer: boolean;
  heroProduct: boolean;
};

export type PurchaseStrategyEvaluationInput = {
  monthlySales: CalendarMonthSales[];
  monthlyDemandUnits: number;
  asOf: string | Date;
  policy?: PurchaseStrategyPolicyInput | PurchaseStrategyPolicy;
  firstSaleAt?: string | Date | null;
  launchedAt?: string | Date | null;
  recent60DayUnits?: number;
  claimRatePercent?: number;
  weightedClaimRate?: number;
  leadTimeDays?: number;
  permanentlyDiscontinued?: boolean;
};

export type PurchaseStrategyEvaluation = {
  policy: PurchaseStrategyPolicy;
  policyFingerprintInput: string;
  history: PurchaseHistoryAnalysis;
  newProduct: boolean;
  newProductAgeDays: number | null;
  protectedUntil: string | null;
  recent60DayUnits: number;
  permanentlyDiscontinued: boolean;
  discontinuationReviewCandidate: boolean;
  recommended: boolean;
  decision: "RECOMMEND" | "HOLD" | "DISCONTINUED";
  automaticCoverageMonths: number;
  leadTimeDays: number;
  leadTimeFloorMonths: number;
  coverageReason:
    | "BASE"
    | "NEW_PRODUCT"
    | "RISING_MILD"
    | "RISING_MODERATE"
    | "RISING_STRONG"
    | "CONSISTENT_PERFORMER"
    | "LEAD_TIME_FLOOR"
    | "NO_DEMAND"
    | "DISCONTINUED";
  manualCoverageReview: {
    required: boolean;
    availableCoverageMonths: readonly [number, number];
    suggestedCoverageMonths: number | null;
  };
  normalizedClaimRatePercent: number;
  claimPenaltyPoints: number;
  highValueConsistentBonusPoints: number;
  priorityScoreAdjustment: number;
  highValueConsistentProduct: boolean;
  monthlyDemandUnits: number;
  grossDemandTarget: number;
  reasons: string[];
};

function finiteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]) {
  return values.length > 0 ? sum(values) / values.length : 0;
}

function normalizedNonNegativeNumber(value: unknown) {
  return Math.max(0, finiteNumber(value));
}

function normalizedQuantity(value: unknown) {
  return Math.round(normalizedNonNegativeNumber(value));
}

function normalizedMoney(value: unknown) {
  return Math.round(normalizedNonNegativeNumber(value));
}

function normalizedThreshold(value: unknown) {
  const parsed = finiteNumber(value, DEFAULT_MONTHLY_REVENUE_THRESHOLD_KRW);
  const positive =
    parsed > 0 ? parsed : DEFAULT_MONTHLY_REVENUE_THRESHOLD_KRW;
  const clamped = clamp(
    positive,
    MIN_MONTHLY_REVENUE_THRESHOLD_KRW,
    MAX_MONTHLY_REVENUE_THRESHOLD_KRW,
  );
  return clamp(
    Math.round(clamped / MONTHLY_REVENUE_THRESHOLD_STEP_KRW) *
      MONTHLY_REVENUE_THRESHOLD_STEP_KRW,
    MIN_MONTHLY_REVENUE_THRESHOLD_KRW,
    MAX_MONTHLY_REVENUE_THRESHOLD_KRW,
  );
}

function normalizedPolicyNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = finiteNumber(value, fallback);
  return clamp(parsed > 0 ? parsed : fallback, minimum, maximum);
}

/**
 * Returns a JSON-safe policy object with a fixed key order. The rule version
 * pins all non-user-adjustable constants while the normalized threshold pins
 * the current operator setting.
 */
export function normalizePurchaseStrategyPolicy(
  input: PurchaseStrategyPolicyInput = {},
): PurchaseStrategyPolicy {
  const automaticCoverageCapMonths = normalizedPolicyNumber(
    input.automaticCoverageCapMonths,
    AUTOMATIC_COVERAGE_CAP_MONTHS,
    0.5,
    4,
  );
  const baseCoverageMonths = Math.min(
    automaticCoverageCapMonths,
    normalizedPolicyNumber(
      input.baseCoverageMonths,
      BASE_COVERAGE_MONTHS,
      0.5,
      4,
    ),
  );
  const mild = clamp(
    normalizedPolicyNumber(
      input.risingCoverageMonths?.MILD,
      2,
      baseCoverageMonths,
      automaticCoverageCapMonths,
    ),
    baseCoverageMonths,
    automaticCoverageCapMonths,
  );
  const moderate = clamp(
    normalizedPolicyNumber(
      input.risingCoverageMonths?.MODERATE,
      3,
      mild,
      automaticCoverageCapMonths,
    ),
    mild,
    automaticCoverageCapMonths,
  );
  const strong = clamp(
    normalizedPolicyNumber(
      input.risingCoverageMonths?.STRONG,
      4,
      moderate,
      automaticCoverageCapMonths,
    ),
    moderate,
    automaticCoverageCapMonths,
  );
  const manualHeroMaxCoverageMonths = normalizedPolicyNumber(
    input.manualHeroMaxCoverageMonths,
    6,
    automaticCoverageCapMonths,
    6,
  );
  const risingCoverageMonths = Object.freeze({
    MILD: mild,
    MODERATE: moderate,
    STRONG: strong,
  });
  const manualReviewCoverageMonths = Object.freeze([
    Math.min(5, manualHeroMaxCoverageMonths),
    manualHeroMaxCoverageMonths,
  ] as const);

  return Object.freeze({
    policyVersion: PURCHASE_STRATEGY_POLICY_VERSION,
    monthlyRevenueThresholdKrw: normalizedThreshold(
      input.monthlyRevenueThresholdKrw,
    ),
    analysisWindowMonths: ANALYSIS_WINDOW_MONTHS,
    risingWindowMonths: RISING_WINDOW_MONTHS,
    newProductProtectionDays: Math.round(
      normalizedPolicyNumber(
        input.newProductProtectionDays,
        NEW_PRODUCT_PROTECTION_DAYS,
        1,
        1_095,
      ),
    ),
    baseCoverageMonths,
    risingCoverageMonths,
    consistentPerformerCoverageMonths: automaticCoverageCapMonths,
    automaticCoverageCapMonths,
    manualReviewCoverageMonths,
    consistentPerformerQualifiedMonthFloor:
      CONSISTENT_PERFORMER_MONTH_FLOOR,
    highValueAverageSellingPriceKrw:
      HIGH_VALUE_AVERAGE_SELLING_PRICE_KRW,
  });
}

export const DEFAULT_PURCHASE_STRATEGY_POLICY =
  normalizePurchaseStrategyPolicy();

export function serializePurchaseStrategyPolicyForFingerprint(
  input: PurchaseStrategyPolicyInput | PurchaseStrategyPolicy = {},
) {
  return JSON.stringify(normalizePurchaseStrategyPolicy(input));
}

function validDate(value: string | Date | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function requiredAsOfDate(value: string | Date | undefined) {
  const date = validDate(value);
  if (!date) {
    throw new TypeError("asOf must be a valid explicit date");
  }
  return date;
}

function monthKey(year: number, zeroBasedMonth: number) {
  const date = new Date(Date.UTC(year, zeroBasedMonth, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function completedMonthKeys(asOf: Date) {
  const koreaTime = new Date(
    asOf.getTime() + KOREA_TIME_OFFSET_MILLISECONDS,
  );
  const year = koreaTime.getUTCFullYear();
  const month = koreaTime.getUTCMonth();
  return Array.from({ length: ANALYSIS_WINDOW_MONTHS }, (_, index) =>
    monthKey(year, month - ANALYSIS_WINDOW_MONTHS + index),
  );
}

function isCalendarMonthKey(value: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  return year >= 2000 && year <= 9999;
}

export function normalizeCompletedCalendarMonthSales(
  monthlySales: CalendarMonthSales[],
  asOf: string | Date,
) {
  const monthTotals = new Map<string, { units: number; revenue: number }>();
  for (const row of Array.isArray(monthlySales) ? monthlySales : []) {
    const month = String(row?.month ?? "").trim();
    if (!isCalendarMonthKey(month)) {
      throw new TypeError(`monthlySales contains an invalid month: ${month}`);
    }
    if (monthTotals.has(month)) {
      throw new TypeError(`monthlySales contains a duplicate month: ${month}`);
    }
    monthTotals.set(month, {
      units: normalizedQuantity(row.units),
      revenue: normalizedMoney(row.revenue),
    });
  }

  return completedMonthKeys(requiredAsOfDate(asOf)).map((month) => ({
    month,
    units: monthTotals.get(month)?.units ?? 0,
    revenue: monthTotals.get(month)?.revenue ?? 0,
  }));
}

function revenueGrowthRate(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? 1 : 0;
  return current / previous - 1;
}

function risingStrength(input: {
  recentQualified: number;
  previousQualified: number;
  recentAverageRevenue: number;
  previousAverageRevenue: number;
}) {
  const growth = revenueGrowthRate(
    input.recentAverageRevenue,
    input.previousAverageRevenue,
  );
  const qualifiedIncrease =
    input.recentQualified - input.previousQualified;
  if (
    qualifiedIncrease <= 0 ||
    input.recentQualified < 2 ||
    input.recentAverageRevenue <= input.previousAverageRevenue
  ) {
    return { strength: "NONE" as const, growth };
  }
  if (
    input.recentQualified === RISING_WINDOW_MONTHS &&
    qualifiedIncrease >= 2 &&
    growth >= 0.5
  ) {
    return { strength: "STRONG" as const, growth };
  }
  if (qualifiedIncrease >= 2 || growth >= 0.25) {
    return { strength: "MODERATE" as const, growth };
  }
  return { strength: "MILD" as const, growth };
}

export function analyzePurchaseStrategyHistory(input: {
  monthlySales: CalendarMonthSales[];
  asOf: string | Date;
  policy?: PurchaseStrategyPolicyInput | PurchaseStrategyPolicy;
}): PurchaseHistoryAnalysis {
  const policy = normalizePurchaseStrategyPolicy(input.policy);
  const completedMonths = normalizeCompletedCalendarMonthSales(
    input.monthlySales,
    input.asOf,
  );
  const isQualified = (row: CalendarMonthSales) =>
    row.revenue >= policy.monthlyRevenueThresholdKrw;
  const qualifiedMonthCount = completedMonths.filter(isQualified).length;
  const latestQualifiedMonth =
    [...completedMonths].reverse().find(isQualified)?.month ?? null;
  const recentThree = completedMonths.slice(-RISING_WINDOW_MONTHS);
  const previousThree = completedMonths.slice(
    -(RISING_WINDOW_MONTHS * 2),
    -RISING_WINDOW_MONTHS,
  );
  const recentThreeQualifiedMonthCount = recentThree.filter(isQualified).length;
  const previousThreeQualifiedMonthCount =
    previousThree.filter(isQualified).length;
  const recentThreeAverageRevenue = average(
    recentThree.map((row) => row.revenue),
  );
  const previousThreeAverageRevenue = average(
    previousThree.map((row) => row.revenue),
  );
  const rising = risingStrength({
    recentQualified: recentThreeQualifiedMonthCount,
    previousQualified: previousThreeQualifiedMonthCount,
    recentAverageRevenue: recentThreeAverageRevenue,
    previousAverageRevenue: previousThreeAverageRevenue,
  });
  const totalUnits = sum(completedMonths.map((row) => row.units));
  const totalRevenue = sum(completedMonths.map((row) => row.revenue));
  const consistentPerformer =
    qualifiedMonthCount >= policy.consistentPerformerQualifiedMonthFloor;
  const heroProduct =
    consistentPerformer &&
    recentThreeQualifiedMonthCount === RISING_WINDOW_MONTHS &&
    recentThreeAverageRevenue >=
      policy.monthlyRevenueThresholdKrw *
        HERO_RECENT_REVENUE_THRESHOLD_MULTIPLIER;

  return {
    completedMonths,
    qualifiedMonthCount,
    qualificationLabel: `${qualifiedMonthCount}/${ANALYSIS_WINDOW_MONTHS}`,
    latestQualifiedMonth,
    recentThreeQualifiedMonthCount,
    previousThreeQualifiedMonthCount,
    recentThreeAverageRevenue: Math.round(recentThreeAverageRevenue),
    previousThreeAverageRevenue: Math.round(previousThreeAverageRevenue),
    recentToPreviousRevenueGrowthRate:
      Math.round(rising.growth * 1_000) / 1_000,
    risingStrength: rising.strength,
    averageSellingPriceKrw:
      totalUnits > 0 ? Math.round(totalRevenue / totalUnits) : 0,
    consistentPerformer,
    heroProduct,
  };
}

function normalizedStartDate(input: PurchaseStrategyEvaluationInput) {
  return validDate(input.launchedAt) ?? validDate(input.firstSaleAt);
}

function koreaCalendarDay(value: Date) {
  const koreaTime = new Date(
    value.getTime() + KOREA_TIME_OFFSET_MILLISECONDS,
  );
  return Date.UTC(
    koreaTime.getUTCFullYear(),
    koreaTime.getUTCMonth(),
    koreaTime.getUTCDate(),
  );
}

function newProductState(
  input: PurchaseStrategyEvaluationInput,
  policy: PurchaseStrategyPolicy,
) {
  const start = normalizedStartDate(input);
  if (!start) {
    return {
      newProduct: false,
      ageDays: null,
      protectedUntil: null,
    };
  }
  const asOf = requiredAsOfDate(input.asOf);
  const startDay = koreaCalendarDay(start);
  const asOfDay = koreaCalendarDay(asOf);
  const ageDays = Math.max(0, Math.floor((asOfDay - startDay) / DAY_IN_MILLISECONDS));
  const protectedUntilDate = new Date(
    startDay + policy.newProductProtectionDays * DAY_IN_MILLISECONDS,
  );
  return {
    newProduct: ageDays < policy.newProductProtectionDays,
    ageDays,
    protectedUntil: protectedUntilDate.toISOString().slice(0, 10),
  };
}

function claimPenaltyPoints(claimRatePercent: number) {
  if (claimRatePercent >= 20) return 30;
  if (claimRatePercent >= 12) return 20;
  if (claimRatePercent >= 7) return 10;
  if (claimRatePercent >= 3) return 5;
  return 0;
}

function coverageForStrength(
  strength: RisingStrength,
  policy: PurchaseStrategyPolicy,
) {
  if (strength === "STRONG") return policy.risingCoverageMonths.STRONG;
  if (strength === "MODERATE") return policy.risingCoverageMonths.MODERATE;
  if (strength === "MILD") return policy.risingCoverageMonths.MILD;
  return policy.baseCoverageMonths;
}

export function evaluatePurchaseStrategy(
  input: PurchaseStrategyEvaluationInput,
): PurchaseStrategyEvaluation {
  const policy = normalizePurchaseStrategyPolicy(input.policy);
  const history = analyzePurchaseStrategyHistory({
    monthlySales: input.monthlySales,
    asOf: input.asOf,
    policy,
  });
  const newProduct = newProductState(input, policy);
  const derivedRecent60DayUnits = sum(
    history.completedMonths.slice(-2).map((row) => row.units),
  );
  const recent60DayUnits = normalizedQuantity(
    input.recent60DayUnits ?? derivedRecent60DayUnits,
  );
  const monthlyDemandUnits = normalizedNonNegativeNumber(
    input.monthlyDemandUnits,
  );
  const normalizedClaimRatePercent = clamp(
    normalizedNonNegativeNumber(
      input.claimRatePercent ?? input.weightedClaimRate,
    ),
    0,
    100,
  );
  const claimPenalty = claimPenaltyPoints(normalizedClaimRatePercent);
  const highValueConsistentProduct =
    history.consistentPerformer &&
    history.averageSellingPriceKrw >=
      policy.highValueAverageSellingPriceKrw;
  const highValueConsistentBonusPoints = highValueConsistentProduct ? 10 : 0;
  const priorityScoreAdjustment =
    highValueConsistentBonusPoints - claimPenalty;
  const permanentlyDiscontinued = input.permanentlyDiscontinued === true;
  const discontinuationReviewCandidate =
    !newProduct.newProduct &&
    !permanentlyDiscontinued &&
    history.qualifiedMonthCount === 0 &&
    history.risingStrength === "NONE";
  const leadTimeDays = clamp(
    normalizedNonNegativeNumber(input.leadTimeDays),
    0,
    365,
  );
  const leadTimeFloorMonths = Math.min(
    policy.automaticCoverageCapMonths,
    Math.max(
      policy.baseCoverageMonths,
      Math.ceil((leadTimeDays / 30 + 0.5) * 10) / 10,
    ),
  );

  let automaticCoverageMonths: number = coverageForStrength(
    history.risingStrength,
    policy,
  );
  let coverageReason: PurchaseStrategyEvaluation["coverageReason"] =
    history.risingStrength === "STRONG"
      ? "RISING_STRONG"
      : history.risingStrength === "MODERATE"
        ? "RISING_MODERATE"
        : history.risingStrength === "MILD"
          ? "RISING_MILD"
          : "BASE";

  if (history.heroProduct) {
    automaticCoverageMonths = policy.consistentPerformerCoverageMonths;
    coverageReason = "CONSISTENT_PERFORMER";
  }
  if (newProduct.newProduct) {
    automaticCoverageMonths = policy.baseCoverageMonths;
    coverageReason = "NEW_PRODUCT";
  }
  if (
    leadTimeFloorMonths > automaticCoverageMonths &&
    !newProduct.newProduct
  ) {
    automaticCoverageMonths = leadTimeFloorMonths;
    coverageReason = "LEAD_TIME_FLOOR";
  }
  automaticCoverageMonths = Math.min(
    policy.automaticCoverageCapMonths,
    automaticCoverageMonths,
  );

  const candidateEligible =
    monthlyDemandUnits > 0 &&
    (newProduct.newProduct ||
      history.qualifiedMonthCount > 0 ||
      history.risingStrength !== "NONE");
  let recommended = candidateEligible;
  let decision: PurchaseStrategyEvaluation["decision"] = recommended
    ? "RECOMMEND"
    : "HOLD";
  const reasons: string[] = [];

  if (newProduct.newProduct && recent60DayUnits <= 0) {
    recommended = false;
    decision = "HOLD";
    automaticCoverageMonths = policy.baseCoverageMonths;
    coverageReason = "NO_DEMAND";
    reasons.push(
      "신상품 보호는 유지하지만 최근 60일 판매가 없어 이번 자동 발주는 0개입니다.",
    );
  }
  if (monthlyDemandUnits <= 0) {
    recommended = false;
    decision = "HOLD";
    coverageReason = "NO_DEMAND";
    reasons.push("월 예상수요가 없어 이번 자동 발주는 0개입니다.");
  }
  if (permanentlyDiscontinued) {
    recommended = false;
    decision = "DISCONTINUED";
    automaticCoverageMonths = 0;
    coverageReason = "DISCONTINUED";
    reasons.push("영구 발주 제외로 지정되어 다른 조건과 관계없이 추천하지 않습니다.");
  }

  const manualCoverageReviewRequired =
    !permanentlyDiscontinued &&
    !newProduct.newProduct &&
    history.heroProduct &&
    monthlyDemandUnits > 0;
  const grossDemandTarget = recommended
    ? Math.ceil(monthlyDemandUnits * automaticCoverageMonths)
    : 0;

  if (history.qualifiedMonthCount > 0) {
    reasons.push(
      `최근 완료 12개월 중 ${history.qualifiedMonthCount}개월이 월매출 기준을 충족했습니다.`,
    );
  }
  if (history.risingStrength !== "NONE") {
    reasons.push(
      `최근 3개월 흐름을 ${history.risingStrength} 상승으로 판정했습니다.`,
    );
  }
  if (manualCoverageReviewRequired) {
    reasons.push(
      "꾸준한 효자상품이라 5~6개월분을 수동 검토할 수 있지만 자동 계산은 4개월을 넘기지 않습니다.",
    );
  }
  if (claimPenalty > 0) {
    reasons.push(`클레임률을 반영해 우선순위에서 ${claimPenalty}점을 감점했습니다.`);
  }
  if (highValueConsistentBonusPoints > 0) {
    reasons.push(
      `높은 평균 판매단가와 꾸준한 실적을 반영해 우선순위에 ${highValueConsistentBonusPoints}점을 더했습니다.`,
    );
  }

  return {
    policy,
    policyFingerprintInput: serializePurchaseStrategyPolicyForFingerprint(policy),
    history,
    newProduct: newProduct.newProduct,
    newProductAgeDays: newProduct.ageDays,
    protectedUntil: newProduct.protectedUntil,
    recent60DayUnits,
    permanentlyDiscontinued,
    discontinuationReviewCandidate,
    recommended,
    decision,
    automaticCoverageMonths,
    leadTimeDays,
    leadTimeFloorMonths,
    coverageReason,
    manualCoverageReview: {
      required: manualCoverageReviewRequired,
      availableCoverageMonths: policy.manualReviewCoverageMonths,
      suggestedCoverageMonths: manualCoverageReviewRequired
        ? policy.manualReviewCoverageMonths[1]
        : null,
    },
    normalizedClaimRatePercent,
    claimPenaltyPoints: claimPenalty,
    highValueConsistentBonusPoints,
    priorityScoreAdjustment,
    highValueConsistentProduct,
    monthlyDemandUnits,
    grossDemandTarget,
    reasons: reasons.slice(0, 8),
  };
}
