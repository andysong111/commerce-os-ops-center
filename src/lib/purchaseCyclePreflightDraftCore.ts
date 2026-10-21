import { createHash } from "node:crypto";
import type { FastPurchaseInternalDraftLine } from "@/lib/fastPurchaseInternalDraft";
import type {
  PurchaseCyclePreflightReport,
  PurchaseQuantityOverride,
} from "@/lib/purchaseCyclePreflightCore";
import type {
  SourcingBudgetPlan,
  SourcingVariantSelectionInput,
} from "@/lib/sourcingBudgetPlan";

const FINGERPRINT = /^sha256:[a-f0-9]{64}$/;

const hash = (value: unknown) =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

export function sourcingBudgetDecisionFingerprint(plan: SourcingBudgetPlan) {
  type DecisionLine = {
    conceptId: string;
    variantKey: string | null;
    saleOption: string | null;
    chinaOption: string | null;
    storageSize: "S" | "L" | null;
    quantity: number | null;
  };
  const selected: DecisionLine[] = [];
  for (const row of plan.allocation.selected) {
    if (Array.isArray(row.selectedVariants) && row.selectedVariants.length > 0) {
      for (const variant of row.selectedVariants) {
        selected.push({
          conceptId: row.conceptId,
          variantKey: variant.variantKey,
          saleOption: variant.saleOption,
          chinaOption: variant.chinaOption,
          storageSize: variant.storageSize,
          quantity: variant.quantity,
        });
      }
    } else {
      selected.push({
        conceptId: row.conceptId,
        variantKey: null,
        saleOption: null,
        chinaOption: null,
        storageSize: row.storageSize ?? null,
        quantity: row.quantity ?? null,
      });
    }
  }
  selected.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return hash({
    targetCycleMonth: plan.targetCycleMonth,
    totalCashKrw: plan.totalCashKrw,
    sourcingBudgetPercent: plan.sourcingBudgetPercent,
    sourcingBudgetKrw: plan.sourcingBudgetKrw,
    selected,
  });
}

function sortedStrings(values: string[] | undefined) {
  return [...(values ?? [])].sort();
}

function sortedQuantityOverrides(values: PurchaseQuantityOverride[] | undefined) {
  return [...(values ?? [])]
    .map(({ barcode, targetQuantity }) => ({ barcode, targetQuantity }))
    .sort((left, right) => left.barcode.localeCompare(right.barcode));
}

function sortedStorageEntries(values: Record<string, "S" | "L"> | undefined) {
  return Object.entries(values ?? {}).sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  ));
}

function sortedVariantSelections(values: SourcingVariantSelectionInput[] | undefined) {
  return (values ?? [])
    .map(({ conceptId, variantKey, storageSize }) => [conceptId, variantKey, storageSize] as const)
    .sort((left, right) => {
      for (let index = 0; index < left.length; index += 1) {
        if (left[index] < right[index]) return -1;
        if (left[index] > right[index]) return 1;
      }
      return 0;
    });
}

function sameSourcingSelection(
  plan: SourcingBudgetPlan,
  request: PurchaseCycleDraftRequest,
) {
  return (
    JSON.stringify(sortedStrings(plan.preferredConceptIds)) ===
      JSON.stringify(sortedStrings(request.preferredSourcingConceptIds)) &&
    JSON.stringify(sortedStorageEntries(plan.storageSizeByConceptId)) ===
      JSON.stringify(sortedStorageEntries(request.sourcingStorageSizeByConceptId)) &&
    JSON.stringify(sortedVariantSelections(plan.variantSelections)) ===
      JSON.stringify(sortedVariantSelections(request.sourcingVariantSelections))
  );
}

export type PurchaseCycleDraftRequest = {
  targetDate: string;
  cashLimitKrw?: number | null;
  sourcingBudgetPercent?: number;
  preferredSourcingConceptIds?: string[];
  sourcingStorageSizeByConceptId?: Record<string, "S" | "L">;
  sourcingVariantSelections?: SourcingVariantSelectionInput[];
  allowOpenBudgetPreview?: boolean;
  expectedSourceFingerprint: string;
  expectedPlanFingerprint: string;
  expectedSourcingSourceFingerprint?: string | null;
  expectedSourcingPlanFingerprint?: string | null;
  expectedSourcingDecisionFingerprint?: string | null;
  confirmation: string;
  replaceDraftId?: string | null;
  excludedBarcodes?: string[];
  quantityOverrides?: PurchaseQuantityOverride[];
};

export function purchaseCycleDraftPreflightOptions(
  request: PurchaseCycleDraftRequest,
) {
  return {
    targetDate: request.targetDate,
    cashLimitKrw: request.cashLimitKrw ?? null,
    sourcingBudgetPercent: request.sourcingBudgetPercent ?? 0,
    maxSkus: 100,
    maxUnitsPerSku: 9_999,
    allowOpenBudgetPreview: request.allowOpenBudgetPreview === true,
    replaceDraftId: request.replaceDraftId ?? null,
    excludedBarcodes: request.excludedBarcodes ?? [],
    quantityOverrides: request.quantityOverrides ?? [],
  };
}

export function purchaseCycleDraftConfirmation(
  report: PurchaseCyclePreflightReport,
  sourcingPlan: SourcingBudgetPlan | null = null,
) {
  const sourcingVariantCount = sourcingPlan?.allocation.selected.reduce(
    (total, row) => total + (
      Array.isArray(row.selectedVariants) ? row.selectedVariants.length : 1
    ),
    0,
  ) ?? 0;
  const sourcingSuffix = report.sourcingBudgetPercent > 0 && sourcingPlan
    ? `_NEWSOURCE${sourcingVariantCount}SKU_LIMIT${report.sourcingBudgetKrw}KRW_${sourcingBudgetDecisionFingerprint(sourcingPlan).slice(-12)}`
    : "";
  if (report.replacementDraftId) {
    const audit = report.replacementAudit;
    if (!audit?.complete) throw new Error("PURCHASE_DRAFT_REPLACEMENT_AUDIT_REQUIRED");
    return `REGENERATE_PURCHASE_DRAFT_${report.targetCycleMonth}_${audit.selectedLineCount}SKU_${report.estimatedSpendKrw}KRW_CASH${report.cashLimitKrw ?? "AUTO"}_SOURCING${report.sourcingBudgetPercent}PCT_ADD${audit.added.length}_REMOVE${audit.removed.length}_CHANGE${audit.quantityChanged.length}_${report.replacementDraftId}${sourcingSuffix}`;
  }
  return `CREATE_PURCHASE_DRAFT_${report.targetCycleMonth}_${report.selected.length}SKU_${report.estimatedSpendKrw}KRW_CASH${report.cashLimitKrw ?? "AUTO"}_SOURCING${report.sourcingBudgetPercent}PCT${sourcingSuffix}`;
}

export function purchaseCycleDraftPlannedTotals(
  report: PurchaseCyclePreflightReport,
  sourcingPlan: SourcingBudgetPlan | null = null,
) {
  const existingReorderCount = report.selected.length;
  const existingReorderQuantity = report.selected.reduce(
    (total, row) => total + row.quantity,
    0,
  );
  const preservedSourcingCount = report.preservedReplacementLines?.length ?? 0;
  const preservedSourcingQuantity = (report.preservedReplacementLines ?? []).reduce(
    (total, row) => total + row.quantity,
    0,
  );
  const newSourcingCount = sourcingPlan?.allocation.selected.reduce(
    (total, row) => total + (Array.isArray(row.selectedVariants) ? row.selectedVariants.length : 0),
    0,
  ) ?? 0;
  const newSourcingQuantity = sourcingPlan?.allocation.selected.reduce(
    (total, row) => total + (Array.isArray(row.selectedVariants)
      ? row.selectedVariants.reduce((sum, variant) => sum + variant.quantity, 0)
      : 0),
    0,
  ) ?? 0;

  return {
    existingReorderCount,
    existingReorderQuantity,
    preservedSourcingCount,
    preservedSourcingQuantity,
    newSourcingCount,
    newSourcingQuantity,
    finalLineCount: existingReorderCount + preservedSourcingCount + newSourcingCount,
    finalQuantity: existingReorderQuantity + preservedSourcingQuantity + newSourcingQuantity,
  };
}

export function preparePurchaseCycleDraft(
  report: PurchaseCyclePreflightReport,
  request: PurchaseCycleDraftRequest,
  sourcingPlan: SourcingBudgetPlan | null = null,
  behavior: { preserveExistingSourcingOnly?: boolean } = {},
): {
  cycleMonth: string;
  sourceFingerprint: string;
  lines: FastPurchaseInternalDraftLine[];
} {
  if (
    request.targetDate !== report.targetDate ||
    (request.cashLimitKrw ?? null) !== report.cashLimitKrw ||
    (request.sourcingBudgetPercent ?? 0) !== report.sourcingBudgetPercent ||
    request.expectedPlanFingerprint !== report.planFingerprint ||
    (request.replaceDraftId ?? null) !== (report.replacementDraftId ?? null) ||
    JSON.stringify(sortedStrings(request.excludedBarcodes)) !==
      JSON.stringify(report.operatorExcludedBarcodes) ||
    JSON.stringify(sortedQuantityOverrides(request.quantityOverrides)) !==
      JSON.stringify(report.operatorQuantityOverrides) ||
    !FINGERPRINT.test(request.expectedSourceFingerprint) ||
    !FINGERPRINT.test(request.expectedPlanFingerprint)
  ) {
    throw new Error("PURCHASE_CYCLE_DRAFT_SOURCE_CHANGED");
  }
  const preserveExistingSourcingOnly =
    behavior.preserveExistingSourcingOnly === true && Boolean(request.replaceDraftId);
  if (report.sourcingBudgetPercent > 0 && !preserveExistingSourcingOnly) {
    if (
      !sourcingPlan ||
      sourcingPlan.readyForConfirmation !== true ||
      sourcingPlan.targetCycleMonth !== report.targetCycleMonth ||
      sourcingPlan.totalCashKrw !== report.effectiveCashKrw ||
      sourcingPlan.sourcingBudgetPercent !== report.sourcingBudgetPercent ||
      sourcingPlan.sourcingBudgetKrw !== report.sourcingBudgetKrw ||
      !sameSourcingSelection(sourcingPlan, request) ||
      sourcingPlan.allocation.selected.length < 1 ||
      !FINGERPRINT.test(request.expectedSourcingSourceFingerprint ?? "") ||
      !FINGERPRINT.test(request.expectedSourcingPlanFingerprint ?? "") ||
      !FINGERPRINT.test(request.expectedSourcingDecisionFingerprint ?? "") ||
      request.expectedSourcingDecisionFingerprint !== sourcingBudgetDecisionFingerprint(sourcingPlan)
    ) {
      throw new Error("PURCHASE_CYCLE_SOURCING_PLAN_NOT_READY");
    }
  } else if (!preserveExistingSourcingOnly && (
    request.expectedSourcingSourceFingerprint ||
    request.expectedSourcingPlanFingerprint ||
    request.expectedSourcingDecisionFingerprint
  )) {
    throw new Error("PURCHASE_CYCLE_SOURCING_PLAN_UNEXPECTED");
  }
  if (
    report.previewReady !== true ||
    report.blockers.length > 0 ||
    report.candidateCoverageComplete !== true ||
    report.accountedCandidateCount !== report.candidateCount ||
    report.selected.length < 1 ||
    report.selected.length > 100 ||
    report.estimatedSpendKrw <= 0 ||
    report.estimatedSpendKrw > report.effectiveBudgetKrw
  ) {
    throw new Error("PURCHASE_CYCLE_DRAFT_NOT_READY");
  }
  if (report.replacementDraftId && report.replacementAudit?.complete !== true) {
    throw new Error("PURCHASE_DRAFT_REPLACEMENT_AUDIT_REQUIRED");
  }
  if (
    report.businessWritesEnabled !== false ||
    report.approvalEnabled !== false ||
    report.actualPurchaseExecuted !== false ||
    report.scheduledExecution !== false
  ) {
    throw new Error("PURCHASE_CYCLE_DRAFT_EXECUTION_BOUNDARY_CHANGED");
  }
  if (request.confirmation !== purchaseCycleDraftConfirmation(report, sourcingPlan)) {
    throw new Error("PURCHASE_CYCLE_DRAFT_CONFIRMATION_REQUIRED");
  }

  return {
    cycleMonth: report.targetCycleMonth,
    sourceFingerprint: report.planFingerprint,
    lines: [
      ...report.selected.map((row) => ({
      barcode: row.barcode,
      modelNo: null,
      productName: row.name,
      plannedQuantity: row.quantity,
      // Provisional zero is not a physical stockout confirmation.
      stockSense: "LOW" as const,
      referenceDemandQuantity: row.originalRecommendedQuantity,
      note: `발주 사전점검 · 정책 v${report.purchaseStrategyConfigVersion ?? "미확인"} · 최근 12개월 매출기준 ${row.revenueQualificationLabel} · 목표재고 ${row.targetCoverageMonths}개월${row.newProduct ? " · NEW" : ""}${row.risingStrength !== "NONE" ? ` · Rising ${row.risingStrength}` : ""}${row.manualHeroCoverageReview ? " · 효자상품 5~6개월 수동검토" : ""} · 클레임 ${Number.isFinite(Number(row.weightedClaimRate)) ? Number(row.weightedClaimRate).toFixed(1) : "0.0"}% · 신규소싱 ${report.sourcingBudgetPercent}% 최대 · 실제 예약 ${report.sourcingBudgetKrw - report.sourcingBudgetReturnKrw}원 · ${row.costEvidenceSource} · 권장 ${row.originalRecommendedQuantity} → 현금반영 ${row.quantity} · ${row.cashflowTier} · 계획재고 ${row.inventoryQuantity} · 미입고 ${row.openCommitment}`,
      })),
      ...(report.preservedReplacementLines ?? []).map((row) => ({
        barcode: row.barcode,
        modelNo: null,
        productName: row.name,
        plannedQuantity: row.quantity,
        stockSense: "LOW" as const,
        referenceDemandQuantity: row.quantity,
        note: "기존 Draft 신규소싱 확정 상품 유지 · 운영자 제외 시에만 제거",
      })),
    ],
  };
}
