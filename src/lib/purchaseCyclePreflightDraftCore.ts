import type { FastPurchaseInternalDraftLine } from "@/lib/fastPurchaseInternalDraft";
import type { PurchaseCyclePreflightReport } from "@/lib/purchaseCyclePreflightCore";

const FINGERPRINT = /^sha256:[a-f0-9]{64}$/;

export type PurchaseCycleDraftRequest = {
  targetDate: string;
  allowOpenBudgetPreview?: boolean;
  expectedSourceFingerprint: string;
  expectedPlanFingerprint: string;
  confirmation: string;
  replaceDraftId?: string | null;
};

export function purchaseCycleDraftPreflightOptions(
  request: PurchaseCycleDraftRequest,
) {
  return {
    targetDate: request.targetDate,
    cashLimitKrw: null,
    maxSkus: 100,
    maxUnitsPerSku: 9_999,
    allowOpenBudgetPreview: request.allowOpenBudgetPreview === true,
    replaceDraftId: request.replaceDraftId ?? null,
  };
}

export function purchaseCycleDraftConfirmation(
  report: PurchaseCyclePreflightReport,
) {
  if (report.replacementDraftId) {
    const audit = report.replacementAudit;
    if (!audit?.complete) throw new Error("PURCHASE_DRAFT_REPLACEMENT_AUDIT_REQUIRED");
    return `REGENERATE_PURCHASE_DRAFT_${report.targetCycleMonth}_${report.selected.length}SKU_${report.estimatedSpendKrw}KRW_ADD${audit.added.length}_REMOVE${audit.removed.length}_CHANGE${audit.quantityChanged.length}_${report.replacementDraftId}`;
  }
  return `CREATE_PURCHASE_DRAFT_${report.targetCycleMonth}_${report.selected.length}SKU_${report.estimatedSpendKrw}KRW`;
}

export function preparePurchaseCycleDraft(
  report: PurchaseCyclePreflightReport,
  request: PurchaseCycleDraftRequest,
): {
  cycleMonth: string;
  sourceFingerprint: string;
  lines: FastPurchaseInternalDraftLine[];
} {
  if (
    request.targetDate !== report.targetDate ||
    request.expectedSourceFingerprint !== report.sourceFingerprint ||
    request.expectedPlanFingerprint !== report.planFingerprint ||
    (request.replaceDraftId ?? null) !== (report.replacementDraftId ?? null) ||
    !FINGERPRINT.test(request.expectedSourceFingerprint) ||
    !FINGERPRINT.test(request.expectedPlanFingerprint)
  ) {
    throw new Error("PURCHASE_CYCLE_DRAFT_SOURCE_CHANGED");
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
  if (request.confirmation !== purchaseCycleDraftConfirmation(report)) {
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
      referenceDemandQuantity: row.quantity,
      note: `발주 사전점검 · ${row.costEvidenceSource} · 계획재고 ${row.inventoryQuantity} · 미입고 ${row.openCommitment}`,
    })),
  };
}
