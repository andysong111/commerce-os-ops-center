import {
  allocatePurchaseCashflow,
  normalizePurchaseOrderQuantity,
  purchaseOrderQuantityUnit,
} from "./purchaseCashflowAllocation.ts";
import { comparePurchaseStrategyPriority } from "./productDecisionEngine/purchaseStrategyPolicy.ts";

export const PURCHASE_STRATEGY_LAB_SCENARIOS = [
  "CURRENT",
  "RECENT_PROTECTED",
  "BALANCED_LOW_COST",
] as const;

export type PurchaseStrategyLabScenarioId =
  (typeof PURCHASE_STRATEGY_LAB_SCENARIOS)[number];

export type PurchaseStrategyLabRow = {
  barcode: string;
  name: string;
  modelNo: string | null;
  purchaseStatus: string;
  originalPurchaseStatus: string;
  entrySignals: string[];
  recommendedQuantity: number;
  preGateRecommendedQuantity: number;
  moq: number;
  cartonQuantity: number;
  unitCostKrw: number;
  priorityScore: number;
  revenueQualifiedMonthCount: number;
  averageMonthlyRevenueKrw: number;
  risingStrength: "NONE" | "MILD" | "MODERATE" | "STRONG";
  permanentlyDiscontinued: boolean;
  operationallyReady: boolean;
  inventoryMode: string;
};

export type PurchaseStrategyLabConfig = {
  budgetKrw: number;
  recentMinimumRatio: number;
  stockoutMinimumRatio: number;
  cheapUnitCostThresholdKrw: number;
  cheapMinimumQuantity: number;
  optionFamilyMinimumQuantity: number;
};

export type PurchaseStrategyLabAllocation = {
  barcode: string;
  targetQuantity: number;
  allocatedQuantity: number;
  estimatedCostKrw: number;
  includedByRecentSignal: boolean;
  reasons: string[];
};

export type PurchaseStrategyLabScenario = {
  id: PurchaseStrategyLabScenarioId;
  label: string;
  description: string;
  allocations: PurchaseStrategyLabAllocation[];
  selectedSkuCount: number;
  totalQuantity: number;
  estimatedSpendKrw: number;
  remainingBudgetKrw: number;
  recentSignalSkuCount: number;
  optionFamilySkuCount: number;
  reviewRequiredSkuCount: number;
};

const RECENT_SIGNAL_KEYS = new Set([
  "MONTHLY_REVENUE_40000",
  "RECENT_RISING",
  "STOCKOUT_DEMAND_RECOVERY",
]);

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

function roundUp(value: number, unit: number) {
  return Math.max(0, Math.ceil(value / unit) * unit);
}

function recentSignals(row: PurchaseStrategyLabRow) {
  return row.entrySignals.filter((signal) => RECENT_SIGNAL_KEYS.has(signal));
}

function hasRecentSignal(row: PurchaseStrategyLabRow) {
  return recentSignals(row).length > 0;
}

function targetQuantity(row: PurchaseStrategyLabRow) {
  return normalizePurchaseOrderQuantity(
    row.recommendedQuantity,
    row.cartonQuantity,
  );
}

function experimentalTargetQuantity(row: PurchaseStrategyLabRow) {
  const canonicalTarget = targetQuantity(row);
  if (canonicalTarget > 0 || !hasRecentSignal(row)) return canonicalTarget;
  return normalizePurchaseOrderQuantity(
    row.preGateRecommendedQuantity,
    row.cartonQuantity,
  );
}

function normalizedRows(rows: PurchaseStrategyLabRow[]) {
  const byBarcode = new Map<string, PurchaseStrategyLabRow>();
  for (const source of rows) {
    const barcode = String(source.barcode ?? "").trim().toUpperCase();
    if (!barcode || byBarcode.has(barcode)) continue;
    byBarcode.set(barcode, {
      ...source,
      barcode,
      entrySignals: [...source.entrySignals],
      recommendedQuantity: quantity(source.recommendedQuantity),
      preGateRecommendedQuantity: quantity(
        source.preGateRecommendedQuantity,
      ),
      moq: Math.max(1, quantity(source.moq) || 1),
      cartonQuantity: Math.max(1, quantity(source.cartonQuantity) || 1),
      unitCostKrw: money(source.unitCostKrw),
      priorityScore: Math.max(0, number(source.priorityScore)),
      revenueQualifiedMonthCount: quantity(
        source.revenueQualifiedMonthCount,
      ),
      averageMonthlyRevenueKrw: money(source.averageMonthlyRevenueKrw),
    });
  }
  return [...byBarcode.values()];
}

function priority(left: PurchaseStrategyLabRow, right: PurchaseStrategyLabRow) {
  return (
    comparePurchaseStrategyPriority(left, right) ||
    left.barcode.localeCompare(right.barcode)
  );
}

function protectionWeight(row: PurchaseStrategyLabRow) {
  if (row.entrySignals.includes("STOCKOUT_DEMAND_RECOVERY")) return 4;
  if (row.entrySignals.includes("MONTHLY_REVENUE_40000")) return 3;
  if (row.entrySignals.includes("RECENT_RISING")) return 2;
  return row.purchaseStatus === "발주 추천" ? 1 : 0;
}

function allocationSummary(
  id: PurchaseStrategyLabScenarioId,
  rows: PurchaseStrategyLabRow[],
  allocations: PurchaseStrategyLabAllocation[],
  budgetKrw: number,
): PurchaseStrategyLabScenario {
  const rowByBarcode = new Map(rows.map((row) => [row.barcode, row]));
  const selected = allocations.filter((row) => row.allocatedQuantity > 0);
  const familyCounts = new Map<string, number>();
  for (const allocation of selected) {
    const modelNo = rowByBarcode.get(allocation.barcode)?.modelNo;
    if (!modelNo) continue;
    familyCounts.set(modelNo, (familyCounts.get(modelNo) ?? 0) + 1);
  }
  const optionFamilySkuCount = selected.filter((allocation) => {
    const modelNo = rowByBarcode.get(allocation.barcode)?.modelNo;
    return Boolean(modelNo && (familyCounts.get(modelNo) ?? 0) > 1);
  }).length;
  const estimatedSpendKrw = selected.reduce(
    (sum, row) => sum + row.estimatedCostKrw,
    0,
  );
  const labels: Record<
    PurchaseStrategyLabScenarioId,
    Pick<PurchaseStrategyLabScenario, "label" | "description">
  > = {
    CURRENT: {
      label: "현재 운영 방식 재현",
      description:
        "완료월 실적 우선순위와 CORE·SUPPORT·CANARY 순차 현금배분을 그대로 재현합니다.",
    },
    RECENT_PROTECTED: {
      label: "최근매출·품절 보호",
      description:
        "최근 매출·상승·품절회복 신호를 완료월 게이트보다 먼저 보호하고 포트폴리오에 고르게 배분합니다.",
    },
    BALANCED_LOW_COST: {
      label: "색상균형·저가 최소수량",
      description:
        "최근매출 보호에 같은 모델의 색상별 최소수량과 저가 상품 최소수량을 함께 적용합니다.",
    },
  };

  return {
    id,
    ...labels[id],
    allocations,
    selectedSkuCount: selected.length,
    totalQuantity: selected.reduce(
      (sum, row) => sum + row.allocatedQuantity,
      0,
    ),
    estimatedSpendKrw,
    remainingBudgetKrw: Math.max(0, budgetKrw - estimatedSpendKrw),
    recentSignalSkuCount: selected.filter((allocation) => {
      const row = rowByBarcode.get(allocation.barcode);
      return row ? hasRecentSignal(row) : false;
    }).length,
    optionFamilySkuCount,
    reviewRequiredSkuCount: selected.filter(
      (allocation) => !rowByBarcode.get(allocation.barcode)?.operationallyReady,
    ).length,
  };
}

function currentScenario(
  rows: PurchaseStrategyLabRow[],
  budgetKrw: number,
) {
  const candidates = rows.filter(
    (row) =>
      row.purchaseStatus === "발주 추천" &&
      targetQuantity(row) > 0 &&
      row.unitCostKrw > 0 &&
      !row.permanentlyDiscontinued,
  );
  const allocations = allocatePurchaseCashflow(
    candidates.map((row) => ({
      barcode: row.barcode,
      priorityScore: row.priorityScore,
      revenueQualifiedMonthCount: row.revenueQualifiedMonthCount,
      averageMonthlyRevenueKrw: row.averageMonthlyRevenueKrw,
      risingStrength: row.risingStrength,
      targetQuantity: targetQuantity(row),
      unitCostKrw: row.unitCostKrw,
      moq: row.moq,
      cartonQuantity: row.cartonQuantity,
    })),
    budgetKrw,
  ).map((allocation) => ({
    barcode: allocation.barcode,
    targetQuantity: allocation.targetQuantity,
    allocatedQuantity: allocation.allocatedQuantity,
    estimatedCostKrw: allocation.estimatedCostKrw,
    includedByRecentSignal: false,
    reasons: [
      `현재 ${allocation.tier} 순차배분`,
      ...(allocation.cashAdjusted ? ["예산으로 권장수량 축소"] : []),
      ...(allocation.allocatedQuantity === 0 ? ["앞순위 배분 후 예산 부족"] : []),
    ],
  }));

  return allocationSummary("CURRENT", rows, allocations, budgetKrw);
}

type FairCandidate = {
  row: PurchaseStrategyLabRow;
  targetQuantity: number;
  allocationUnit: number;
  minimumQuantity: number;
  allocatedQuantity: number;
  reasons: string[];
  includedByRecentSignal: boolean;
};

function fairScenario(
  id: "RECENT_PROTECTED" | "BALANCED_LOW_COST",
  rows: PurchaseStrategyLabRow[],
  config: PurchaseStrategyLabConfig,
) {
  const familySignalCounts = new Map<string, number>();
  for (const row of rows) {
    if (!row.modelNo || !hasRecentSignal(row)) continue;
    familySignalCounts.set(
      row.modelNo,
      (familySignalCounts.get(row.modelNo) ?? 0) + 1,
    );
  }

  const candidates: FairCandidate[] = rows
    .filter(
      (row) =>
        !row.permanentlyDiscontinued &&
        row.unitCostKrw > 0 &&
        experimentalTargetQuantity(row) > 0 &&
        (row.purchaseStatus === "발주 추천" || hasRecentSignal(row)),
    )
    .map((row) => {
      let target = experimentalTargetQuantity(row);
      const unit = purchaseOrderQuantityUnit(row.cartonQuantity);
      const executableMinimum = roundUp(row.moq, unit);
      let configuredMinimum = 0;
      const signals = recentSignals(row);
      const includedByRecentSignal =
        row.purchaseStatus !== "발주 추천" && signals.length > 0;
      const reasons: string[] = [];

      if (
        id === "BALANCED_LOW_COST" &&
        row.unitCostKrw <= config.cheapUnitCostThresholdKrw
      ) {
        configuredMinimum = Math.max(
          configuredMinimum,
          roundUp(config.cheapMinimumQuantity, unit),
        );
        reasons.push(`저가 상품 최소 ${config.cheapMinimumQuantity}개`);
      }

      if (
        id === "BALANCED_LOW_COST" &&
        row.modelNo &&
        (familySignalCounts.get(row.modelNo) ?? 0) >= 2 &&
        signals.length > 0
      ) {
        configuredMinimum = Math.max(
          configuredMinimum,
          roundUp(config.optionFamilyMinimumQuantity, unit),
        );
        reasons.push(
          `동일 모델 색상별 최소 ${config.optionFamilyMinimumQuantity}개`,
        );
      }

      target = Math.max(target, executableMinimum, configuredMinimum);
      const baseMinimum = executableMinimum;
      let minimum = Math.max(
        baseMinimum,
        Math.min(target, configuredMinimum),
      );

      if (signals.length > 0) {
        const ratio = row.entrySignals.includes("STOCKOUT_DEMAND_RECOVERY")
          ? config.stockoutMinimumRatio
          : config.recentMinimumRatio;
        minimum = Math.max(minimum, roundUp(target * ratio, unit));
        reasons.push(
          includedByRecentSignal
            ? "최근매출 신호로 완료월 게이트 보정"
            : "최근매출·품절 신호 최소수량 보호",
        );
      }

      return {
        row,
        targetQuantity: target,
        allocationUnit: unit,
        minimumQuantity: Math.min(target, minimum),
        allocatedQuantity: 0,
        reasons,
        includedByRecentSignal,
      };
    })
    .sort(
      (left, right) =>
        protectionWeight(right.row) - protectionWeight(left.row) ||
        priority(left.row, right.row),
    );

  let remaining = Math.max(0, Math.floor(config.budgetKrw));

  // Give each candidate one executable lot before any row can consume its
  // whole protected floor. This is the anti-starvation behavior missing from
  // the production sequential allocator.
  for (const candidate of candidates) {
    const seedQuantity = Math.min(
      candidate.targetQuantity,
      roundUp(candidate.row.moq, candidate.allocationUnit),
    );
    const lotCost = seedQuantity * candidate.row.unitCostKrw;
    if (lotCost > remaining) continue;
    candidate.allocatedQuantity = seedQuantity;
    remaining -= candidate.allocatedQuantity * candidate.row.unitCostKrw;
  }

  function allocateLowestCoverage(limit: "minimum" | "target") {
    while (remaining > 0) {
      const affordable = candidates
        .filter((candidate) => {
          const cap =
            limit === "minimum"
              ? candidate.minimumQuantity
              : candidate.targetQuantity;
          return (
            candidate.allocatedQuantity > 0 &&
            candidate.allocatedQuantity < cap &&
            candidate.allocationUnit * candidate.row.unitCostKrw <= remaining
          );
        })
        .sort((left, right) => {
          const leftCap =
            limit === "minimum"
              ? left.minimumQuantity
              : left.targetQuantity;
          const rightCap =
            limit === "minimum"
              ? right.minimumQuantity
              : right.targetQuantity;
          const coverageDifference =
            left.allocatedQuantity / Math.max(1, leftCap) -
            right.allocatedQuantity / Math.max(1, rightCap);
          return (
            coverageDifference ||
            protectionWeight(right.row) - protectionWeight(left.row) ||
            priority(left.row, right.row)
          );
        });
      const candidate = affordable[0];
      if (!candidate) break;
      const cap =
        limit === "minimum"
          ? candidate.minimumQuantity
          : candidate.targetQuantity;
      const added = Math.min(
        candidate.allocationUnit,
        cap - candidate.allocatedQuantity,
      );
      if (added <= 0) break;
      candidate.allocatedQuantity += added;
      remaining -= added * candidate.row.unitCostKrw;
    }
  }

  allocateLowestCoverage("minimum");
  allocateLowestCoverage("target");

  const allocations = candidates.map((candidate) => ({
    barcode: candidate.row.barcode,
    targetQuantity: candidate.targetQuantity,
    allocatedQuantity: candidate.allocatedQuantity,
    estimatedCostKrw:
      candidate.allocatedQuantity * candidate.row.unitCostKrw,
    includedByRecentSignal: candidate.includedByRecentSignal,
    reasons: [
      ...candidate.reasons,
      ...(candidate.allocatedQuantity < candidate.targetQuantity
        ? ["포트폴리오 균형·예산으로 권장수량 축소"]
        : []),
      ...(candidate.allocatedQuantity === 0 ? ["예산 부족"] : []),
    ],
  }));

  return allocationSummary(id, rows, allocations, config.budgetKrw);
}

export function simulatePurchaseStrategies(
  sourceRows: PurchaseStrategyLabRow[],
  sourceConfig: PurchaseStrategyLabConfig,
): PurchaseStrategyLabScenario[] {
  const rows = normalizedRows(sourceRows);
  const config: PurchaseStrategyLabConfig = {
    budgetKrw: money(sourceConfig.budgetKrw),
    recentMinimumRatio: Math.min(
      1,
      Math.max(0, number(sourceConfig.recentMinimumRatio)),
    ),
    stockoutMinimumRatio: Math.min(
      1,
      Math.max(0, number(sourceConfig.stockoutMinimumRatio)),
    ),
    cheapUnitCostThresholdKrw: money(
      sourceConfig.cheapUnitCostThresholdKrw,
    ),
    cheapMinimumQuantity: quantity(sourceConfig.cheapMinimumQuantity),
    optionFamilyMinimumQuantity: quantity(
      sourceConfig.optionFamilyMinimumQuantity,
    ),
  };

  return [
    currentScenario(rows, config.budgetKrw),
    fairScenario("RECENT_PROTECTED", rows, config),
    fairScenario("BALANCED_LOW_COST", rows, config),
  ];
}
