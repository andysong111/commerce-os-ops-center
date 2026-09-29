import type { FastPurchaseInternalDraftLine } from "@/lib/fastPurchaseInternalDraft";
import type { PurchaseCyclePreflightReport } from "@/lib/purchaseCyclePreflightCore";

const FINGERPRINT = /^sha256:[a-f0-9]{64}$/;

export type PurchaseCycleDraftRequest = {
  targetDate: string;
  expectedSourceFingerprint: string;
  expectedPlanFingerprint: string;
  confirmation: string;
};

export function purchaseCycleDraftConfirmation(
  report: PurchaseCyclePreflightReport,
) {
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
    !FINGERPRINT.test(request.expectedSourceFingerprint) ||
    !FINGERPRINT.test(request.expectedPlanFingerprint)
  ) {
    throw new Error("PURCHASE_CYCLE_DRAFT_SOURCE_CHANGED");
  }
  if (
    report.previewReady !== true ||
    report.blockers.length > 0 ||
    report.selected.length < 1 ||
    report.selected.length > 100 ||
    report.estimatedSpendKrw <= 0 ||
    report.estimatedSpendKrw > report.effectiveBudgetKrw
  ) {
    throw new Error("PURCHASE_CYCLE_DRAFT_NOT_READY");
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
