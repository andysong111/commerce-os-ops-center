import type { FastPurchaseInternalDraftLine } from "@/lib/fastPurchaseInternalDraft";
import type { PurchaseCyclePreflightReport } from "@/lib/purchaseCyclePreflightCore";
import type { SourcingBudgetPlan } from "@/lib/sourcingBudgetPlan";

const FINGERPRINT = /^sha256:[a-f0-9]{64}$/;

export type PurchaseCycleDraftRequest = {
  targetDate: string;
  cashLimitKrw?: number | null;
  sourcingBudgetPercent?: number;
  allowOpenBudgetPreview?: boolean;
  expectedSourceFingerprint: string;
  expectedPlanFingerprint: string;
  expectedSourcingSourceFingerprint?: string | null;
  expectedSourcingPlanFingerprint?: string | null;
  confirmation: string;
  replaceDraftId?: string | null;
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
  };
}

export function purchaseCycleDraftConfirmation(
  report: PurchaseCyclePreflightReport,
  sourcingPlan: SourcingBudgetPlan | null = null,
) {
  const sourcingSuffix = report.sourcingBudgetPercent > 0 && sourcingPlan
    ? `_NEWSOURCE${sourcingPlan.allocation.selected.length}SKU_${sourcingPlan.allocation.estimatedSpendKrw}KRW_${sourcingPlan.planFingerprint.slice(-12)}`
    : "";
  if (report.replacementDraftId) {
    const audit = report.replacementAudit;
    if (!audit?.complete) throw new Error("PURCHASE_DRAFT_REPLACEMENT_AUDIT_REQUIRED");
    return `REGENERATE_PURCHASE_DRAFT_${report.targetCycleMonth}_${report.selected.length}SKU_${report.estimatedSpendKrw}KRW_CASH${report.cashLimitKrw ?? "AUTO"}_SOURCING${report.sourcingBudgetPercent}PCT_ADD${audit.added.length}_REMOVE${audit.removed.length}_CHANGE${audit.quantityChanged.length}_${report.replacementDraftId}${sourcingSuffix}`;
  }
  return `CREATE_PURCHASE_DRAFT_${report.targetCycleMonth}_${report.selected.length}SKU_${report.estimatedSpendKrw}KRW_CASH${report.cashLimitKrw ?? "AUTO"}_SOURCING${report.sourcingBudgetPercent}PCT${sourcingSuffix}`;
}

export function preparePurchaseCycleDraft(
  report: PurchaseCyclePreflightReport,
  request: PurchaseCycleDraftRequest,
  sourcingPlan: SourcingBudgetPlan | null = null,
): {
  cycleMonth: string;
  sourceFingerprint: string;
  lines: FastPurchaseInternalDraftLine[];
} {
  if (
    request.targetDate !== report.targetDate ||
    (request.cashLimitKrw ?? null) !== report.cashLimitKrw ||
    (request.sourcingBudgetPercent ?? 0) !== report.sourcingBudgetPercent ||
    request.expectedSourceFingerprint !== report.sourceFingerprint ||
    request.expectedPlanFingerprint !== report.planFingerprint ||
    (request.replaceDraftId ?? null) !== (report.replacementDraftId ?? null) ||
    !FINGERPRINT.test(request.expectedSourceFingerprint) ||
    !FINGERPRINT.test(request.expectedPlanFingerprint)
  ) {
    throw new Error("PURCHASE_CYCLE_DRAFT_SOURCE_CHANGED");
  }
  if (report.sourcingBudgetPercent > 0) {
    if (
      !sourcingPlan ||
      sourcingPlan.readyForConfirmation !== true ||
      sourcingPlan.targetCycleMonth !== report.targetCycleMonth ||
      sourcingPlan.totalCashKrw !== report.effectiveCashKrw ||
      sourcingPlan.sourcingBudgetPercent !== report.sourcingBudgetPercent ||
      sourcingPlan.sourcingBudgetKrw !== report.sourcingBudgetKrw ||
      sourcingPlan.allocation.selected.length < 1 ||
      request.expectedSourcingSourceFingerprint !== sourcingPlan.sourceFingerprint ||
      request.expectedSourcingPlanFingerprint !== sourcingPlan.planFingerprint ||
      !FINGERPRINT.test(request.expectedSourcingSourceFingerprint ?? "") ||
      !FINGERPRINT.test(request.expectedSourcingPlanFingerprint ?? "")
    ) {
      throw new Error("PURCHASE_CYCLE_SOURCING_PLAN_NOT_READY");
    }
  } else if (
    request.expectedSourcingSourceFingerprint ||
    request.expectedSourcingPlanFingerprint
  ) {
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
    lines: report.selected.map((row) => ({
      barcode: row.barcode,
      modelNo: null,
      productName: row.name,
      plannedQuantity: row.quantity,
      // Provisional zero is not a physical stockout confirmation.
      stockSense: "LOW",
      referenceDemandQuantity: row.originalRecommendedQuantity,
      note: `발주 사전점검 · 신규소싱 ${report.sourcingBudgetPercent}% 제외 · ${row.costEvidenceSource} · 권장 ${row.originalRecommendedQuantity} → 현금반영 ${row.quantity} · ${row.cashflowTier} · 계획재고 ${row.inventoryQuantity} · 미입고 ${row.openCommitment}`,
    })),
  };
}
