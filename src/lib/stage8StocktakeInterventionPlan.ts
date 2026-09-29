import { createHash } from "node:crypto";
import {
  loadLegacyVerifiedCostReadiness,
  type LegacyVerifiedCostReadinessRow,
} from "@/lib/stage8LegacyVerifiedCostReadiness";

const TARGET_SPEND_COVERAGE = 0.8;

export type StocktakeInterventionPlanRow = {
  sequence: number;
  barcode: string;
  name: string;
  modelNo: string | null;
  recommendedQty: number;
  conservativeExpectedCost: number;
  purchaseCostTrustSource: string;
  purchaseUnitCostKrw: number;
  inventoryState: "INITIAL_ZERO_UNVERIFIED" | "UNVERIFIED";
  requestedOperatorInput: "PHYSICAL_QUANTITY";
  canary: boolean;
};

export type StocktakeInterventionPlan = {
  generatedAt: string;
  state: "READY_FOR_OPERATOR_COUNT" | "NO_SAFE_CANDIDATE" | "BLOCKED";
  message: string;
  sourceFingerprint: string;
  planFingerprint: string;
  purchaseCandidateCount: number;
  costTrustedCandidateCount: number;
  eligibleStocktakeCount: number;
  minimalPriorityCountFor80PctTrustedSpend: number;
  minimalPrioritySpendCoverage: number;
  totalEligibleConservativeSpend: number;
  firstCanaryBarcode: string | null;
  requestedOperatorFields: ["barcode", "physicalQuantity"];
  stocktakeWritesEnabled: false;
  purchaseWritesEnabled: false;
  rows: StocktakeInterventionPlanRow[];
};

function fingerprint(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

function minimalCoverage(
  rows: LegacyVerifiedCostReadinessRow[],
  target = TARGET_SPEND_COVERAGE,
) {
  const ordered = [...rows].sort(
    (left, right) =>
      right.effectivePurchaseExpectedCost - left.effectivePurchaseExpectedCost ||
      right.shadowExpectedCost - left.shadowExpectedCost ||
      left.barcode.localeCompare(right.barcode),
  );
  const total = ordered.reduce(
    (sum, row) => sum + row.effectivePurchaseExpectedCost,
    0,
  );
  if (!(total > 0)) {
    return { rows: [] as LegacyVerifiedCostReadinessRow[], spend: 0, total: 0 };
  }
  const targetSpend = total * target;
  let spend = 0;
  const selected: LegacyVerifiedCostReadinessRow[] = [];
  for (const row of ordered) {
    selected.push(row);
    spend += row.effectivePurchaseExpectedCost;
    if (spend >= targetSpend) break;
  }
  return { rows: selected, spend, total };
}

export async function loadStocktakeInterventionPlan(): Promise<StocktakeInterventionPlan> {
  const readiness = await loadLegacyVerifiedCostReadiness();
  const eligible = readiness.rows.filter(
    (row) =>
      row.immediateStocktakeEligible &&
      row.purchaseCostTrusted &&
      !row.inventoryVerified &&
      !row.inventoryRequiresReview &&
      row.effectivePurchaseUnitCostKrw > 0,
  );
  const coverage = minimalCoverage(eligible);
  const selectedBarcodes = new Set(coverage.rows.map((row) => row.barcode));
  const firstCanary = coverage.rows[0] ?? null;
  const rows = eligible
    .sort(
      (left, right) =>
        Number(selectedBarcodes.has(right.barcode)) -
          Number(selectedBarcodes.has(left.barcode)) ||
        right.effectivePurchaseExpectedCost - left.effectivePurchaseExpectedCost ||
        left.barcode.localeCompare(right.barcode),
    )
    .map(
      (row, index): StocktakeInterventionPlanRow => ({
        sequence: index + 1,
        barcode: row.barcode,
        name: row.name,
        modelNo: row.modelNo,
        recommendedQty: row.recommendedQty,
        conservativeExpectedCost: row.effectivePurchaseExpectedCost,
        purchaseCostTrustSource: row.purchaseCostTrustSource,
        purchaseUnitCostKrw: row.effectivePurchaseUnitCostKrw,
        inventoryState: row.initialZeroUnverified
          ? "INITIAL_ZERO_UNVERIFIED"
          : "UNVERIFIED",
        requestedOperatorInput: "PHYSICAL_QUANTITY",
        canary: row.barcode === firstCanary?.barcode,
      }),
    );
  const structuralReady = readiness.state === "READY";
  const state: StocktakeInterventionPlan["state"] = !structuralReady
    ? "BLOCKED"
    : rows.length
      ? "READY_FOR_OPERATOR_COUNT"
      : "NO_SAFE_CANDIDATE";
  const planFingerprint = fingerprint({
    sourceFingerprint: readiness.fingerprint,
    targetSpendCoverage: TARGET_SPEND_COVERAGE,
    firstCanaryBarcode: firstCanary?.barcode ?? null,
    rows: rows.map((row) => ({
      barcode: row.barcode,
      recommendedQty: row.recommendedQty,
      conservativeExpectedCost: row.conservativeExpectedCost,
      purchaseUnitCostKrw: row.purchaseUnitCostKrw,
      inventoryState: row.inventoryState,
      canary: row.canary,
    })),
  });

  return {
    generatedAt: new Date().toISOString(),
    state,
    message:
      state === "READY_FOR_OPERATOR_COUNT"
        ? "발주사이클의 필수 단계가 아닌 선택형 오류 교정 후보입니다. 기본 운영은 PROVISIONAL 추정재고로 계속 진행하고, 실제 품절 시 SOLD_OUT_RESET=0 이후 중국 확정입고와 판매를 누적합니다."
        : state === "NO_SAFE_CANDIDATE"
          ? "현재 비용신뢰와 재고조건을 동시에 만족하는 실사 후보가 없습니다."
          : "상위 비용신뢰 게이트가 BLOCKED라 실사 요청을 만들지 않습니다.",
    sourceFingerprint: readiness.fingerprint,
    planFingerprint,
    purchaseCandidateCount: readiness.purchaseCandidateCount,
    costTrustedCandidateCount: readiness.costTrustedPurchaseCandidateCount,
    eligibleStocktakeCount: rows.length,
    minimalPriorityCountFor80PctTrustedSpend: coverage.rows.length,
    minimalPrioritySpendCoverage: coverage.spend,
    totalEligibleConservativeSpend: coverage.total,
    firstCanaryBarcode: firstCanary?.barcode ?? null,
    requestedOperatorFields: ["barcode", "physicalQuantity"],
    stocktakeWritesEnabled: false,
    purchaseWritesEnabled: false,
    rows,
  };
}
