import {
  storeValidatedMonthlyPurchaseDraft,
  type FastPurchaseInternalDraft,
} from "@/lib/fastPurchaseInternalDraft";
import { loadPurchaseCyclePreflight } from "@/lib/purchaseCyclePreflight";
import {
  assertPurchaseCycleDraftMatchesPlannedTotals,
  canFinalizeWithExactConfirmedSourcing,
  canRecalculateWithPreservedSourcingOnly,
  preparePurchaseCycleDraft,
  purchaseCycleDraftConfirmation,
  purchaseCycleDraftPlannedTotals,
  purchaseCycleDraftPreflightOptions,
  sourcingBudgetDecisionFingerprint,
  type PurchaseCycleDraftRequest,
} from "@/lib/purchaseCyclePreflightDraftCore";
import type { PurchaseQuantityOverride } from "@/lib/purchaseCyclePreflightCore";
import { normalizePurchaseOrderQuantity } from "@/lib/purchaseCashflowAllocation";
import {
  loadPurchaseDraftOperatorAdjustments,
  regenerateManualMonthlyPurchaseDraft,
  regenerateValidatedMonthlyPurchaseDraft,
} from "@/lib/purchaseCycleDraftRegeneration";
import {
  loadStoredInternalChinaPurchaseDraftForCost,
  saveInternalChinaPurchaseDraft,
  type InternalChinaPurchaseDraftInput,
} from "@/lib/internalChinaPurchaseDraft";
import { mergePurchaseDraftOperatorAdjustments } from "@/lib/purchaseCycleDraftRegenerationCore";
import {
  normalizePurchaseDraftStockBandUpdates,
  storePurchaseDraftStockBands,
} from "@/lib/purchaseDraftStockBands";
import type { PurchaseDraftStockBandUpdate } from "@/lib/purchaseDraftStockBandsCore";
import {
  normalizePurchaseDraftDiscontinuations,
  storePurchaseDraftDiscontinuations,
} from "@/lib/purchaseDraftDiscontinuations";
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
  stockBandUpdates?: PurchaseDraftStockBandUpdate[];
  discontinuedBarcodes?: string[];
  draftEvidenceLines?: NonNullable<InternalChinaPurchaseDraftInput["lines"]>;
};

export async function recalculatePurchaseCycleDraftInline(
  input: InlinePurchaseCycleDraftRecalculationRequest,
) {
  const stockBandUpdates = normalizePurchaseDraftStockBandUpdates(input.stockBandUpdates ?? []);
  const discontinuedBarcodes = normalizePurchaseDraftDiscontinuations(
    input.discontinuedBarcodes ?? [],
  );
  let savedStockBandCount = 0;
  let savedDiscontinuationCount = 0;
  try {
    const savedDraftEvidence = input.draftEvidenceLines
      ? await saveInternalChinaPurchaseDraft(input.replaceDraftId, {
          lines: input.draftEvidenceLines,
        })
      : await loadStoredInternalChinaPurchaseDraftForCost(input.replaceDraftId);
    const lineEvidence = savedDraftEvidence?.lines.map((line) => ({
      barcode: line.barcode,
      chinaOption: line.chinaOption,
      supplierLink: line.supplierLink,
      unitPriceCny: line.unitPriceCny,
      freightGroupId: line.freightGroupId,
      domesticChinaFreightCny: line.domesticChinaFreightCny,
      orderNumber: line.orderNumber,
      note: line.note,
    }));
    const stockBandStorage = stockBandUpdates.length
      ? await storePurchaseDraftStockBands({
          draftId: input.replaceDraftId,
          updates: stockBandUpdates,
        })
      : { savedCount: 0, storage: null, occurredAt: null };
    savedStockBandCount = stockBandStorage.savedCount;
    const discontinuationStorage = discontinuedBarcodes.length
      ? await storePurchaseDraftDiscontinuations({
          draftId: input.replaceDraftId,
          barcodes: discontinuedBarcodes,
        })
      : { savedCount: 0, alreadySavedCount: 0, barcodes: [] as string[] };
    savedDiscontinuationCount =
      discontinuationStorage.savedCount + discontinuationStorage.alreadySavedCount;
    const requestedExclusions = [...new Set([
      ...input.excludedBarcodes,
      ...discontinuedBarcodes,
    ])].sort();
    const persistedAdjustments = await loadPurchaseDraftOperatorAdjustments(
      input.replaceDraftId,
    );
    const incomingAdjustments = {
      excludedBarcodes: requestedExclusions,
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
      releasedQuantityOverrideBarcodes,
    };
    const report = await loadPurchaseCyclePreflight(
      purchaseCycleDraftPreflightOptions(requestBase),
      {
        operatorStockBandUpdates: stockBandUpdates,
        operatorStockBandOccurredAt: stockBandStorage.occurredAt,
      },
    );
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
        stockBandUpdates.length > 0 ||
        (
          releasedQuantityOverrideBarcodes.length === 0 &&
          excludedBarcodes.length === 0 &&
          quantityOverrides.length === 0
        )
      ) {
        throw error;
      }
      const fallback = await regenerateManualMonthlyPurchaseDraft({
        expectedDraftId: input.replaceDraftId,
        excludedBarcodes,
        quantityOverrides,
        releasedQuantityOverrideBarcodes,
        lineEvidence,
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
        savedStockBandCount: stockBandStorage.savedCount,
        savedDiscontinuationCount,
        externalOrderExecuted: false as const,
      };
    }
    const replacement = await regenerateValidatedMonthlyPurchaseDraft({
      ...prepared,
      expectedDraftId: input.replaceDraftId,
      operatorExcludedBarcodes: excludedBarcodes,
      operatorQuantityOverrides: quantityOverrides,
      lineEvidence,
    });
    return {
      draft: replacement.draft,
      previousDraftId: replacement.previousDraftId,
      supersededLineCount: replacement.supersededLineCount,
      selectedCount: report.selected.length,
      preservedSourcingCount: report.preservedReplacementLines.filter(
        (line) => line.preserveOnRegeneration === true,
      ).length,
      addedCount: report.replacementAudit?.added.length ?? 0,
      removedCount: report.replacementAudit?.removed.length ?? 0,
      changedCount: report.replacementAudit?.quantityChanged.length ?? 0,
      estimatedSpendKrw: report.estimatedSpendKrw,
      manualFallbackUsed: false as const,
      savedStockBandCount: stockBandStorage.savedCount,
      savedDiscontinuationCount,
      externalOrderExecuted: false as const,
    };
  } catch (error) {
    if (savedStockBandCount > 0 || savedDiscontinuationCount > 0) {
      const cause = error instanceof Error ? error.message.split(":", 1)[0] : "UNKNOWN";
      throw new Error(
        `PURCHASE_DRAFT_RECALCULATION_FAILED_AFTER_INPUT_SAVE:${savedStockBandCount}:${savedDiscontinuationCount}:${cause}`,
      );
    }
    throw error;
  }
}

export async function createPurchaseCyclePreflightDraft(
  request: PurchaseCycleDraftRequest,
  behavior: { startNewRun?: boolean } = {},
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
  if (behavior.startNewRun === true && !request.replaceDraftId) {
    throw new Error("PURCHASE_RUN_REPLACEMENT_REQUIRED");
  }
  const options = purchaseCycleDraftPreflightOptions(request);
  const loadCurrentPlan = async () => {
    let currentReport = await loadPurchaseCyclePreflight(options);
    const currentSourcingPlan = currentReport.sourcingBudgetPercent > 0
      ? await loadSourcingBudgetPlan({
          targetCycleMonth: currentReport.targetCycleMonth,
          totalCashKrw: currentReport.effectiveCashKrw,
          sourcingBudgetPercent: currentReport.sourcingBudgetPercent,
          sourcingBudgetKrw: currentReport.sourcingBudgetKrw,
          preferredConceptIds: request.preferredSourcingConceptIds,
          storageSizeByConceptId: request.sourcingStorageSizeByConceptId,
          variantSelections: request.sourcingVariantSelections,
        })
      : null;
    const sourcingBudgetReturnKrw = currentSourcingPlan
      ? returnableSourcingBudgetKrw(currentSourcingPlan)
      : 0;
    if (sourcingBudgetReturnKrw > 0) {
      currentReport = await loadPurchaseCyclePreflight({
        ...options,
        sourcingBudgetReturnKrw,
      });
    }
    return { report: currentReport, sourcingPlan: currentSourcingPlan };
  };

  let { report, sourcingPlan } = await loadCurrentPlan();
  const reviewedTotals = purchaseCycleDraftPlannedTotals(report, sourcingPlan);
  let preserveExistingSourcingOnly = canRecalculateWithPreservedSourcingOnly(
    report,
    sourcingPlan,
  );

  // Validate the exact user-reviewed source before a sourcing confirmation can write B-codes.
  const reviewedPrepared = preparePurchaseCycleDraft(
    report,
    request,
    preserveExistingSourcingOnly ? null : sourcingPlan,
    { preserveExistingSourcingOnly },
  );
  let sourcing: SourcingBudgetConfirmationResult | {
    ok: false;
    status: "FAILED";
    selectedCount: number;
    confirmedCount: 0;
    failure: { code: string; message: string };
    retryRequiresFreshPreflight: true;
    externalOrderExecuted: false;
  } | null = null;
  if (
    sourcingPlan &&
    !preserveExistingSourcingOnly &&
    sourcingPlan.allocation.selected.some((row) => row.selectedVariants.length > 0)
  ) {
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
      throw new Error(`PURCHASE_CYCLE_SOURCING_CONFIRMATION_INCOMPLETE:${raw.slice(0, 500)}`);
    }
    const expectedConfirmedCount = sourcingPlan.allocation.selected.reduce(
      (total, row) => total + row.selectedVariants.length,
      0,
    );
    if (
      sourcing.ok !== true ||
      sourcing.status !== "COMPLETE" ||
      sourcing.confirmedCount !== expectedConfirmedCount ||
      sourcing.selectedCount !== expectedConfirmedCount ||
      sourcing.failure !== null
    ) {
      throw new Error(
        `PURCHASE_CYCLE_SOURCING_CONFIRMATION_INCOMPLETE:${sourcing.confirmedCount}:${expectedConfirmedCount}`,
      );
    }

    ({ report, sourcingPlan } = await loadCurrentPlan());
    const exactConfirmedSourcingReady = canFinalizeWithExactConfirmedSourcing(
      report,
      sourcingPlan,
      request,
    );
    if (
      !sourcingPlan ||
      (sourcingPlan.readyForConfirmation !== true && !exactConfirmedSourcingReady) ||
      sourcingPlan.allocation.selected.some((row) => row.selectedVariants.length > 0)
    ) {
      throw new Error("PURCHASE_CYCLE_SOURCING_CONFIRMATION_INCOMPLETE:REFRESH");
    }
    preserveExistingSourcingOnly = canRecalculateWithPreservedSourcingOnly(
      report,
      sourcingPlan,
    );
  }

  const effectiveRequest = sourcing
    ? {
        ...request,
        expectedSourceFingerprint: report.sourceFingerprint,
        expectedPlanFingerprint: report.planFingerprint,
        expectedSourcingSourceFingerprint: sourcingPlan?.sourceFingerprint ?? null,
        expectedSourcingPlanFingerprint: sourcingPlan?.planFingerprint ?? null,
        expectedSourcingDecisionFingerprint: sourcingPlan
          ? sourcingBudgetDecisionFingerprint(sourcingPlan)
          : null,
        confirmation: purchaseCycleDraftConfirmation(report, sourcingPlan),
      }
    : request;
  const prepared = preparePurchaseCycleDraft(
    report,
    effectiveRequest,
    preserveExistingSourcingOnly ? null : sourcingPlan,
    { preserveExistingSourcingOnly },
  );
  assertPurchaseCycleDraftMatchesPlannedTotals(
    prepared,
    reviewedTotals,
    reviewedPrepared.lines,
  );

  const replacement = request.replaceDraftId
    ? await regenerateValidatedMonthlyPurchaseDraft({
        ...prepared,
        expectedDraftId: request.replaceDraftId,
        nextCycleStartDate: behavior.startNewRun ? request.targetDate : undefined,
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
