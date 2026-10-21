import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_MONTHLY_REVENUE_THRESHOLD_KRW,
  MAX_MONTHLY_REVENUE_THRESHOLD_KRW,
  MIN_MONTHLY_REVENUE_THRESHOLD_KRW,
  PURCHASE_STRATEGY_POLICY_VERSION,
  analyzePurchaseStrategyHistory,
  evaluatePurchaseStrategy,
  normalizeCompletedCalendarMonthSales,
  normalizePurchaseStrategyPolicy,
  serializePurchaseStrategyPolicyForFingerprint,
} from "../src/lib/productDecisionEngine/purchaseStrategyPolicy.ts";

const AS_OF = "2026-10-22T00:00:00.000Z";

function monthSales(revenues, units = 10) {
  const months = [
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
  return months.map((month, index) => ({
    month,
    units: Array.isArray(units) ? units[index] ?? 0 : units,
    revenue: revenues[index] ?? 0,
  }));
}

function evaluate(overrides = {}) {
  return evaluatePurchaseStrategy({
    monthlySales: monthSales(Array.from({ length: 12 }, () => 50_000)),
    monthlyDemandUnits: 100,
    asOf: AS_OF,
    recent60DayUnits: 20,
    ...overrides,
  });
}

test("policy normalizes the adjustable revenue threshold and serializes stably", () => {
  const defaults = normalizePurchaseStrategyPolicy();
  assert.equal(
    defaults.monthlyRevenueThresholdKrw,
    DEFAULT_MONTHLY_REVENUE_THRESHOLD_KRW,
  );
  assert.equal(defaults.policyVersion, PURCHASE_STRATEGY_POLICY_VERSION);
  assert.equal(
    normalizePurchaseStrategyPolicy({ monthlyRevenueThresholdKrw: 45_600 })
      .monthlyRevenueThresholdKrw,
    46_000,
  );
  assert.equal(
    normalizePurchaseStrategyPolicy({ monthlyRevenueThresholdKrw: -1 })
      .monthlyRevenueThresholdKrw,
    DEFAULT_MONTHLY_REVENUE_THRESHOLD_KRW,
  );
  assert.equal(
    normalizePurchaseStrategyPolicy({ monthlyRevenueThresholdKrw: 1 })
      .monthlyRevenueThresholdKrw,
    MIN_MONTHLY_REVENUE_THRESHOLD_KRW,
  );
  assert.equal(
    normalizePurchaseStrategyPolicy({
      monthlyRevenueThresholdKrw: Number.MAX_SAFE_INTEGER,
    }).monthlyRevenueThresholdKrw,
    MAX_MONTHLY_REVENUE_THRESHOLD_KRW,
  );

  const first = serializePurchaseStrategyPolicyForFingerprint({
    monthlyRevenueThresholdKrw: "40000",
  });
  const second = serializePurchaseStrategyPolicyForFingerprint({
    monthlyRevenueThresholdKrw: 40_000,
  });
  const changed = serializePurchaseStrategyPolicyForFingerprint({
    monthlyRevenueThresholdKrw: 50_000,
  });
  assert.equal(first, second);
  assert.notEqual(first, changed);
  assert.equal(JSON.parse(first).policyVersion, PURCHASE_STRATEGY_POLICY_VERSION);
});

test("history uses only the latest 12 completed calendar months", () => {
  const normalized = normalizeCompletedCalendarMonthSales(
    [
      { month: "2025-09", units: 99, revenue: 999_000 },
      { month: "2025-10", units: 3, revenue: 60_000 },
      { month: "2026-09", units: 3, revenue: 50_000 },
      { month: "2026-10", units: 999, revenue: 9_999_000 },
    ],
    AS_OF,
  );

  assert.equal(normalized.length, 12);
  assert.equal(normalized[0].month, "2025-10");
  assert.deepEqual(normalized[0], {
    month: "2025-10",
    units: 3,
    revenue: 60_000,
  });
  assert.equal(normalized.at(-1).month, "2026-09");
  assert.equal(normalized.some((row) => row.month === "2026-10"), false);
});

test("completed calendar months use Korea time across the UTC month boundary", () => {
  const normalized = normalizeCompletedCalendarMonthSales(
    [
      { month: "2026-09", units: 3, revenue: 50_000 },
      { month: "2026-10", units: 999, revenue: 9_999_000 },
    ],
    // 2026-10-01 00:30 in Korea is still September in UTC. October is the
    // current Korean calendar month and must not enter the completed window.
    "2026-09-30T15:30:00.000Z",
  );

  assert.equal(normalized[0].month, "2025-10");
  assert.equal(normalized.at(-1).month, "2026-09");
  assert.equal(normalized.some((row) => row.month === "2026-10"), false);
});

test("history fails closed for duplicate months, invalid months and an implicit clock", () => {
  assert.throws(
    () =>
      normalizeCompletedCalendarMonthSales(
        [
          { month: "2026-09", units: 1, revenue: 40_000 },
          { month: "2026-09", units: 2, revenue: 80_000 },
        ],
        AS_OF,
      ),
    /duplicate month: 2026-09/,
  );
  assert.throws(
    () =>
      normalizeCompletedCalendarMonthSales(
        [{ month: "invalid", units: 1, revenue: 40_000 }],
        AS_OF,
      ),
    /invalid month/,
  );
  assert.throws(
    () => normalizeCompletedCalendarMonthSales([], undefined),
    /asOf must be a valid explicit date/,
  );
});

test("history reports threshold hits, latest hit and threshold-sensitive count", () => {
  const monthlySales = monthSales([
    10_000,
    40_000,
    39_999,
    70_000,
    0,
    0,
    45_000,
    0,
    80_000,
    30_000,
    50_000,
    60_000,
  ]);
  const defaultAnalysis = analyzePurchaseStrategyHistory({
    monthlySales,
    asOf: AS_OF,
  });
  const raisedAnalysis = analyzePurchaseStrategyHistory({
    monthlySales,
    asOf: AS_OF,
    policy: { monthlyRevenueThresholdKrw: 60_000 },
  });

  assert.equal(defaultAnalysis.qualifiedMonthCount, 6);
  assert.equal(defaultAnalysis.qualificationLabel, "6/12");
  assert.equal(defaultAnalysis.latestQualifiedMonth, "2026-09");
  assert.equal(raisedAnalysis.qualifiedMonthCount, 3);
});

test("recent three versus previous three produces mild, moderate and strong rising tiers", () => {
  const mild = analyzePurchaseStrategyHistory({
    monthlySales: monthSales([
      0, 0, 0, 0, 0, 0, 30_000, 40_000, 30_000, 45_000, 45_000, 30_000,
    ]),
    asOf: AS_OF,
  });
  const moderate = analyzePurchaseStrategyHistory({
    monthlySales: monthSales([
      0, 0, 0, 0, 0, 0, 20_000, 40_000, 20_000, 55_000, 55_000, 20_000,
    ]),
    asOf: AS_OF,
  });
  const strong = analyzePurchaseStrategyHistory({
    monthlySales: monthSales([
      0, 0, 0, 0, 0, 0, 10_000, 10_000, 10_000, 60_000, 60_000, 60_000,
    ]),
    asOf: AS_OF,
  });

  assert.equal(mild.risingStrength, "MILD");
  assert.equal(moderate.risingStrength, "MODERATE");
  assert.equal(strong.risingStrength, "STRONG");
});

test("rising tiers select 2, 3 and 4 months of automatic coverage", () => {
  const mild = evaluate({
    monthlySales: monthSales([
      0, 0, 0, 0, 0, 0, 30_000, 40_000, 30_000, 45_000, 45_000, 30_000,
    ]),
  });
  const moderate = evaluate({
    monthlySales: monthSales([
      0, 0, 0, 0, 0, 0, 20_000, 40_000, 20_000, 55_000, 55_000, 20_000,
    ]),
  });
  const strong = evaluate({
    monthlySales: monthSales([
      0, 0, 0, 0, 0, 0, 10_000, 10_000, 10_000, 60_000, 60_000, 60_000,
    ]),
  });

  assert.equal(mild.automaticCoverageMonths, 2);
  assert.equal(mild.grossDemandTarget, 200);
  assert.equal(moderate.automaticCoverageMonths, 3);
  assert.equal(moderate.grossDemandTarget, 300);
  assert.equal(strong.automaticCoverageMonths, 4);
  assert.equal(strong.grossDemandTarget, 400);
});

test("new product protection ends at day 365 and zero recent demand blocks only ordering", () => {
  const start = "2025-10-22T00:00:00.000Z";
  const day364 = evaluate({
    asOf: "2026-10-21T00:00:00.000Z",
    firstSaleAt: start,
    recent60DayUnits: 0,
  });
  const day365 = evaluate({
    asOf: "2026-10-22T00:00:00.000Z",
    firstSaleAt: start,
    recent60DayUnits: 0,
  });

  assert.equal(day364.newProduct, true);
  assert.equal(day364.newProductAgeDays, 364);
  assert.equal(day364.recommended, false);
  assert.equal(day364.grossDemandTarget, 0);
  assert.equal(day364.automaticCoverageMonths, 1.5);
  assert.equal(day365.newProduct, false);
  assert.equal(day365.newProductAgeDays, 365);
});

test("launch date takes precedence over first sale date for protection", () => {
  const result = evaluate({
    launchedAt: "2024-01-01T00:00:00.000Z",
    firstSaleAt: "2026-01-01T00:00:00.000Z",
  });

  assert.equal(result.newProduct, false);
});

test("first sale date is the protection fallback when launch date is unavailable", () => {
  const result = evaluate({
    firstSaleAt: "2026-01-01T00:00:00.000Z",
  });

  assert.equal(result.newProduct, true);
  assert.equal(result.automaticCoverageMonths, 1.5);
});

test("new-product protection rolls over at midnight in Korea", () => {
  const launchedAt = "2025-10-21T15:00:00.000Z"; // 2025-10-22 00:00 KST
  const beforeBoundary = evaluate({
    launchedAt,
    asOf: "2026-10-21T14:59:59.999Z",
  });
  const atBoundary = evaluate({
    launchedAt,
    asOf: "2026-10-21T15:00:00.000Z",
  });

  assert.equal(beforeBoundary.newProduct, true);
  assert.equal(beforeBoundary.newProductAgeDays, 364);
  assert.equal(atBoundary.newProduct, false);
  assert.equal(atBoundary.newProductAgeDays, 365);
});

test("protected new products can replenish 1.5 months below the revenue threshold", () => {
  const result = evaluate({
    monthlySales: monthSales(Array.from({ length: 12 }, () => 10_000)),
    firstSaleAt: "2026-01-01T00:00:00.000Z",
    recent60DayUnits: 5,
    monthlyDemandUnits: 8,
  });

  assert.equal(result.history.qualifiedMonthCount, 0);
  assert.equal(result.newProduct, true);
  assert.equal(result.recommended, true);
  assert.equal(result.automaticCoverageMonths, 1.5);
  assert.equal(result.grossDemandTarget, 12);
});

test("only unprotected zero-of-twelve non-rising products become discontinuation review candidates", () => {
  const weakHistory = monthSales(Array.from({ length: 12 }, () => 10_000));
  const review = evaluate({
    monthlySales: weakHistory,
    launchedAt: "2024-01-01T00:00:00.000Z",
  });
  const protectedNew = evaluate({
    monthlySales: weakHistory,
    launchedAt: "2026-01-01T00:00:00.000Z",
  });
  const permanentlyDiscontinued = evaluate({
    monthlySales: weakHistory,
    launchedAt: "2024-01-01T00:00:00.000Z",
    permanentlyDiscontinued: true,
  });
  const qualified = evaluate({
    launchedAt: "2024-01-01T00:00:00.000Z",
  });
  const rising = evaluate({
    monthlySales: monthSales([
      0, 0, 0, 0, 0, 0, 10_000, 10_000, 10_000, 45_000, 45_000, 30_000,
    ]),
    launchedAt: "2024-01-01T00:00:00.000Z",
  });

  assert.equal(review.history.qualificationLabel, "0/12");
  assert.equal(review.history.risingStrength, "NONE");
  assert.equal(review.discontinuationReviewCandidate, true);
  assert.equal(protectedNew.discontinuationReviewCandidate, false);
  assert.equal(permanentlyDiscontinued.discontinuationReviewCandidate, false);
  assert.equal(qualified.discontinuationReviewCandidate, false);
  assert.notEqual(rising.history.risingStrength, "NONE");
  assert.equal(rising.discontinuationReviewCandidate, false);
});

test("permanent discontinuation overrides new, rising and hero signals", () => {
  const result = evaluate({
    permanentlyDiscontinued: true,
    firstSaleAt: "2026-01-01T00:00:00.000Z",
    monthlySales: monthSales(Array.from({ length: 12 }, () => 300_000)),
    recent60DayUnits: 100,
  });

  assert.equal(result.decision, "DISCONTINUED");
  assert.equal(result.recommended, false);
  assert.equal(result.automaticCoverageMonths, 0);
  assert.equal(result.grossDemandTarget, 0);
  assert.equal(result.manualCoverageReview.required, false);
});

test("claim rate only lowers priority while high-value consistent sales add a bonus", () => {
  const highValueSales = monthSales(
    Array.from({ length: 12 }, () => 250_000),
    10,
  );
  const clean = evaluate({ monthlySales: highValueSales, claimRatePercent: 1 });
  const risky = evaluate({ monthlySales: highValueSales, claimRatePercent: 12 });
  const lowValue = evaluate({
    monthlySales: monthSales(Array.from({ length: 12 }, () => 50_000), 10),
    claimRatePercent: 1,
  });

  assert.equal(clean.highValueConsistentProduct, true);
  assert.equal(clean.highValueConsistentBonusPoints, 10);
  assert.equal(clean.claimPenaltyPoints, 0);
  assert.equal(clean.priorityScoreAdjustment, 10);
  assert.equal(risky.claimPenaltyPoints, 20);
  assert.equal(risky.priorityScoreAdjustment, -10);
  assert.equal(lowValue.highValueConsistentProduct, false);
  assert.equal(lowValue.highValueConsistentBonusPoints, 0);
});

test("hero products stay at four automatic months and expose five-to-six-month manual review", () => {
  const result = evaluate({
    monthlySales: monthSales(Array.from({ length: 12 }, () => 150_000)),
    monthlyDemandUnits: 25,
  });

  assert.equal(result.history.heroProduct, true);
  assert.equal(result.automaticCoverageMonths, 4);
  assert.equal(result.grossDemandTarget, 100);
  assert.equal(result.manualCoverageReview.required, true);
  assert.deepEqual(result.manualCoverageReview.availableCoverageMonths, [5, 6]);
  assert.equal(result.manualCoverageReview.suggestedCoverageMonths, 6);
});

test("threshold-level consistency alone does not label a product as a high-revenue hero", () => {
  const result = evaluate({
    monthlySales: monthSales(Array.from({ length: 12 }, () => 40_000)),
    monthlyDemandUnits: 25,
  });

  assert.equal(result.history.consistentPerformer, true);
  assert.equal(result.history.heroProduct, false);
  assert.equal(result.automaticCoverageMonths, 1.5);
  assert.equal(result.manualCoverageReview.required, false);
});

test("ordinary qualified products use 1.5 months and the gross target excludes stock math", () => {
  const result = evaluate({
    monthlySales: monthSales([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40_000,
    ]),
    monthlyDemandUnits: 11,
  });

  assert.equal(result.automaticCoverageMonths, 1.5);
  assert.equal(result.grossDemandTarget, 17);
  assert.equal(result.recommended, true);
  assert.equal("availableQuantity" in result, false);
});

test("policy evaluation is deterministic, leaves its input unchanged and has no external side effects", async () => {
  const monthlySales = monthSales(Array.from({ length: 12 }, () => 50_000));
  const input = Object.freeze({
    monthlySales: Object.freeze(
      monthlySales.map((row) => Object.freeze({ ...row })),
    ),
    monthlyDemandUnits: 10,
    asOf: AS_OF,
    recent60DayUnits: 20,
  });

  assert.deepEqual(evaluatePurchaseStrategy(input), evaluatePurchaseStrategy(input));

  const source = await readFile(
    "src/lib/productDecisionEngine/purchaseStrategyPolicy.ts",
    "utf8",
  );
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /supabase|process\.env/i);
  assert.doesNotMatch(source, /Date\.now\s*\(|new Date\(\s*\)/);
  assert.doesNotMatch(source, /\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
});
