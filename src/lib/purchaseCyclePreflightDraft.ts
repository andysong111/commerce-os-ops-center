import {
  storeValidatedMonthlyPurchaseDraft,
  type FastPurchaseInternalDraft,
} from "@/lib/fastPurchaseInternalDraft";
import { loadInternalChinaMonthlyPurchaseClose } from "@/lib/internalChinaMonthlyPurchaseClose";
import { loadPurchaseCyclePreflight } from "@/lib/purchaseCyclePreflight";
import {
  preparePurchaseCycleDraft,
  purchaseCycleDraftConfirmation,
  purchaseCycleDraftPreflightOptions,
  type PurchaseCycleDraftRequest,
} from "@/lib/purchaseCyclePreflightDraftCore";
import type { PurchaseQuantityOverride } from "@/lib/purchaseCyclePreflightCore";
import { normalizePurchaseOrderQuantity } from "@/lib/purchaseCashflowAllocation";
import { regenerateValidatedMonthlyPurchaseDraft } from "@/lib/purchaseCycleDraftRegeneration";
import {
  confirmSourcingBudgetPlan,
  loadSourcingBudgetPlan,
  returnableSourcingBudgetKrw,
  type SourcingBudgetConfirmationResult,
} from "@/lib/sourcingBudgetPlan";

export type InlinePurchaseCycleDraftRecalculationRequest = {
  targetDate: string;
  cashLimitKrw: number | null;
  sourcingBudgetPercent: number;
  allowOpenBudgetPreview: boolean;
  replaceDraftId: string;
  excludedBarcodes: string[];
  quantityOverrides: PurchaseQuantityOverride[];
};

export async function recalculatePurchaseCycleDraftInline(
  input: InlinePurchaseCycleDraftRecalculationRequest,
) {
  const requestBase: PurchaseCycleDraftRequest = {
    targetDate: input.targetDate,
    cashLimitKrw: input.cashLimitKrw,
    sourcingBudgetPercent: input.sourcingBudgetPercent,
    preferredSourcingConceptIds: [],
    sourcingStorageSizeByConceptId: {},
    sourcingVariantSelections: [],
    allowOpenBudgetPreview: input.allowOpenBudgetPreview,
    expectedSourceFingerprint: "",
    expectedPlanFingerprint: "",
    expectedSourcingSourceFingerprint: null,
    expectedSourcingPlanFingerprint: null,
    expectedSourcingDecisionFingerprint: null,
    confirmation: "",
    replaceDraftId: input.replaceDraftId,
    excludedBarcodes: input.excludedBarcodes,
    quantityOverrides: input.quantityOverrides.map((row) => ({
      barcode: row.barcode,
      targetQuantity: normalizePurchaseOrderQuantity(row.targetQuantity),
    })),
  };
  const report = await loadPurchaseCyclePreflight(
    purchaseCycleDraftPreflightOptions(requestBase),
  );
  const request: PurchaseCycleDraftRequest = {
    ...requestBase,
    expectedSourceFingerprint: report.sourceFingerprint,
    expectedPlanFingerprint: report.planFingerprint,
    confirmation: purchaseCycleDraftConfirmation(report),
  };
  const prepared = preparePurchaseCycleDraft(report, request, null, {
    preserveExistingSourcingOnly: true,
  });
  if (await loadInternalChinaMonthlyPurchaseClose(prepared.cycleMonth)) {
    throw new Error(`FAST_PURCHASE_MONTHLY_CYCLE_CLOSED:${prepared.cycleMonth}`);
  }
  const replacement = await regenerateValidatedMonthlyPurchaseDraft({
    ...prepared,
    expectedDraftId: input.replaceDraftId,
  });
  return {
    draft: replacement.draft,
    previousDraftId: replacement.previousDraftId,
    supersededLineCount: replacement.supersededLineCount,
    selectedCount: report.selected.length,
    preservedSourcingCount: report.preservedReplacementLines.length,
    addedCount: report.replacementAudit?.added.length ?? 0,
    removedCount: report.replacementAudit?.removed.length ?? 0,
    changedCount: report.replacementAudit?.quantityChanged.length ?? 0,
    estimatedSpendKrw: report.estimatedSpendKrw,
    externalOrderExecuted: false as const,
  };
}

export async function createPurchaseCyclePreflightDraft(
  request: PurchaseCycleDraftRequest,
): Promise<{
  draft: FastPurchaseInternalDraft;
  selectedCount: number;
  estimatedSpendKrw: number;
  estimatedAllInSpendKrw: number;
  regenerated: boolean;
  previousDraftId: string | null;
  supersededLineCount: number;
  sourcing: SourcingBudgetConfirmationResult | {
    ok: false;
    status: "FAILED";
    selectedCount: number;
    confirmedCount: 0;
    failure: { code: string; message: string };
    retryRequiresFreshPreflight: true;
    externalOrderExecuted: false;
  } | null;
  complete: boolean;
  externalOrderExecuted: false;
}> {
  const options = purchaseCycleDraftPreflightOptions(request);
  let report = await loadPurchaseCyclePreflight(options);
  const sourcingPlan = report.sourcingBudgetPercent > 0
    ? await loadSourcingBudgetPlan({
        targetCycleMonth: report.targetCycleMonth,
        totalCashKrw: report.effectiveCashKrw,
        sourcingBudgetPercent: report.sourcingBudgetPercent,
        sourcingBudgetKrw: report.sourcingBudgetKrw,
        preferredConceptIds: request.preferredSourcingConceptIds,
        storageSizeByConceptId: request.sourcingStorageSizeByConceptId,
        variantSelections: request.sourcingVariantSelections,
      })
    : null;
  const sourcingBudgetReturnKrw = sourcingPlan ? returnableSourcingBudgetKrw(sourcingPlan) : 0;
  if (sourcingBudgetReturnKrw > 0) {
    report = await loadPurchaseCyclePreflight({
      ...options,
      sourcingBudgetReturnKrw,
    });
  }
  const prepared = preparePurchaseCycleDraft(report, request, sourcingPlan);
  if (await loadInternalChinaMonthlyPurchaseClose(prepared.cycleMonth)) {
    throw new Error(`FAST_PURCHASE_MONTHLY_CYCLE_CLOSED:${prepared.cycleMonth}`);
  }
  const replacement = request.replaceDraftId
    ? await regenerateValidatedMonthlyPurchaseDraft({
        ...prepared,
        expectedDraftId: request.replaceDraftId,
      })
    : null;
  const draft = replacement
    ? replacement.draft
    : await storeValidatedMonthlyPurchaseDraft({
        ...prepared,
        dataMode: "PURCHASE_PREFLIGHT",
        allowAdoptExistingReservedDraft: false,
      });
  let sourcing: SourcingBudgetConfirmationResult | {
    ok: false;
    status: "FAILED";
    selectedCount: number;
    confirmedCount: 0;
    failure: { code: string; message: string };
    retryRequiresFreshPreflight: true;
    externalOrderExecuted: false;
  } | null = null;
  if (sourcingPlan) {
    try {
      sourcing = await confirmSourcingBudgetPlan({
        targetCycleMonth: report.targetCycleMonth,
        totalCashKrw: report.effectiveCashKrw,
        sourcingBudgetPercent: report.sourcingBudgetPercent,
        sourcingBudgetKrw: report.sourcingBudgetKrw,
        preferredConceptIds: request.preferredSourcingConceptIds,
        storageSizeByConceptId: request.sourcingStorageSizeByConceptId,
        variantSelections: request.sourcingVariantSelections,
        expectedSourceFingerprint: sourcingPlan.sourceFingerprint,
        expectedPlanFingerprint: sourcingPlan.planFingerprint,
      });
    } catch (error) {
      const raw = error instanceof Error ? error.message : "SOURCING_BUDGET_CONFIRM_FAILED";
      sourcing = {
        ok: false,
        status: "FAILED",
        selectedCount: sourcingPlan.allocation.selected.reduce(
          (total, row) => total + row.selectedVariants.length,
          0,
        ),
        confirmedCount: 0,
        failure: {
          code: raw.split(":", 1)[0] || "SOURCING_BUDGET_CONFIRM_FAILED",
          message: raw.slice(0, 500),
        },
        retryRequiresFreshPreflight: true,
        externalOrderExecuted: false,
      };
    }
  }
  return {
    draft,
    selectedCount: report.selected.length,
    estimatedSpendKrw: report.estimatedSpendKrw,
    estimatedAllInSpendKrw: report.estimatedAllInSpendKrw,
    regenerated: Boolean(replacement),
    previousDraftId: replacement?.previousDraftId ?? null,
    supersededLineCount: replacement?.supersededLineCount ?? 0,
    sourcing,
    complete: sourcing?.ok !== false,
    externalOrderExecuted: false,
  };
}
