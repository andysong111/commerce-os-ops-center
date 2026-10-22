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
import {
  loadPurchaseDraftOperatorAdjustments,
  regenerateManualMonthlyPurchaseDraft,
  regenerateValidatedMonthlyPurchaseDraft,
} from "@/lib/purchaseCycleDraftRegeneration";
import { mergePurchaseDraftOperatorAdjustments } from "@/lib/purchaseCycleDraftRegenerationCore";
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
  replaceQuantityOverrides?: boolean;
};

export async function recalculatePurchaseCycleDraftInline(
  input: InlinePurchaseCycleDraftRecalculationRequest,
) {
  const persistedAdjustments = await loadPurchaseDraftOperatorAdjustments(input.replaceDraftId);
  const incomingAdjustments = {
    excludedBarcodes: [...input.excludedBarcodes],
    quantityOverrides: input.quantityOverrides.map((row) => ({
    barcode: row.barcode,
    targetQuantity: normalizePurchaseOrderQuantity(row.targetQuantity),
    })),
  };
  const {
    excludedBarcodes,
    quantityOverrides,
  } = mergePurchaseDraftOperatorAdjustments(
    persistedAdjustments,
    incomingAdjustments,
    { replaceQuantityOverrides: input.replaceQuantityOverrides === true },
  );
  const finalQuantityOverrideBarcodes = new Set(
    quantityOverrides.map((row) => row.barcode),
  );
  const releasedQuantityOverrideBarcodes = input.replaceQuantityOverrides === true
    ? persistedAdjustments.quantityOverrides
        .map((row) => row.barcode)
        .filter((barcode) => !finalQuantityOverrideBarcodes.has(barcode))
    : [];
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
    excludedBarcodes,
    quantityOverrides,
  };
  const report = await loadPurchaseCyclePreflight(
    purchaseCycleDraftPreflightOptions(requestBase),
  );
  const selectedBarcodes = new Set(report.selected.map((row) => row.barcode));
  const unresolvedReleasedBarcodes = releasedQuantityOverrideBarcodes.filter(
    (barcode) => !selectedBarcodes.has(barcode),
  );
  if (unresolvedReleasedBarcodes.length > 0) {
    throw new Error(
      `RELEASED_QUANTITY_TARGET_NOT_RECOMMENDED:${unresolvedReleasedBarcodes.join(",")}`,
    );
  }
  const request: PurchaseCycleDraftRequest = {
    ...requestBase,
    expectedSourceFingerprint: report.sourceFingerprint,
    expectedPlanFingerprint: report.planFingerprint,
    confirmation: purchaseCycleDraftConfirmation(report),
  };
  let prepared: ReturnType<typeof preparePurchaseCycleDraft>;
  try {
    prepared = preparePurchaseCycleDraft(report, request, null, {
      preserveExistingSourcingOnly: true,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message.split(":", 1)[0] : "";
    if (
      code !== "PURCHASE_CYCLE_DRAFT_NOT_READY" ||
      (excludedBarcodes.length === 0 && quantityOverrides.length === 0)
    ) {
      throw error;
    }
    const fallback = await regenerateManualMonthlyPurchaseDraft({
      expectedDraftId: input.replaceDraftId,
      excludedBarcodes,
      quantityOverrides,
    });
    return {
      draft: fallback.draft,
      previousDraftId: fallback.previousDraftId,
      supersededLineCount: fallback.supersededLineCount,
      selectedCount: fallback.draft.lineCount,
      preservedSourcingCount: 0,
      addedCount: fallback.addedCount,
      removedCount: fallback.removedCount,
      changedCount: fallback.changedCount,
      estimatedSpendKrw: 0,
      manualFallbackUsed: true as const,
      externalOrderExecuted: false as const,
    };
  }
  if (await loadInternalChinaMonthlyPurchaseClose(prepared.cycleMonth)) {
    throw new Error(`FAST_PURCHASE_MONTHLY_CYCLE_CLOSED:${prepared.cycleMonth}`);
  }
  const replacement = await regenerateValidatedMonthlyPurchaseDraft({
    ...prepared,
    expectedDraftId: input.replaceDraftId,
    operatorExcludedBarcodes: excludedBarcodes,
    operatorQuantityOverrides: quantityOverrides,
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
    manualFallbackUsed: false as const,
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
        operatorExcludedBarcodes: request.excludedBarcodes,
        operatorQuantityOverrides: request.quantityOverrides,
      })
    : null;
  const draft = replacement
    ? replacement.draft
    : await storeValidatedMonthlyPurchaseDraft({
        ...prepared,
        dataMode: "PURCHASE_PREFLIGHT",
        allowAdoptExistingReservedDraft: false,
        operatorExcludedBarcodes: request.excludedBarcodes,
        operatorQuantityOverrides: request.quantityOverrides,
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
