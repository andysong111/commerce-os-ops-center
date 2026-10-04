import {
  storeValidatedMonthlyPurchaseDraft,
  type FastPurchaseInternalDraft,
} from "@/lib/fastPurchaseInternalDraft";
import { loadInternalChinaMonthlyPurchaseClose } from "@/lib/internalChinaMonthlyPurchaseClose";
import { loadPurchaseCyclePreflight } from "@/lib/purchaseCyclePreflight";
import {
  preparePurchaseCycleDraft,
  purchaseCycleDraftPreflightOptions,
  type PurchaseCycleDraftRequest,
} from "@/lib/purchaseCyclePreflightDraftCore";
import { regenerateValidatedMonthlyPurchaseDraft } from "@/lib/purchaseCycleDraftRegeneration";
import {
  confirmSourcingBudgetPlan,
  loadSourcingBudgetPlan,
  type SourcingBudgetConfirmationResult,
} from "@/lib/sourcingBudgetPlan";

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
  const report = await loadPurchaseCyclePreflight(
    purchaseCycleDraftPreflightOptions(request),
  );
  const sourcingPlan = report.sourcingBudgetPercent > 0
    ? await loadSourcingBudgetPlan({
        targetCycleMonth: report.targetCycleMonth,
        totalCashKrw: report.effectiveCashKrw,
        sourcingBudgetPercent: report.sourcingBudgetPercent,
        sourcingBudgetKrw: report.sourcingBudgetKrw,
      })
    : null;
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
        expectedSourceFingerprint: sourcingPlan.sourceFingerprint,
        expectedPlanFingerprint: sourcingPlan.planFingerprint,
      });
    } catch (error) {
      const raw = error instanceof Error ? error.message : "SOURCING_BUDGET_CONFIRM_FAILED";
      sourcing = {
        ok: false,
        status: "FAILED",
        selectedCount: sourcingPlan.allocation.selected.length,
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
