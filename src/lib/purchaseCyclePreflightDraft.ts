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
  externalOrderExecuted: false;
}> {
  const report = await loadPurchaseCyclePreflight(
    purchaseCycleDraftPreflightOptions(request),
  );
  const prepared = preparePurchaseCycleDraft(report, request);
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
  return {
    draft,
    selectedCount: report.selected.length,
    estimatedSpendKrw: report.estimatedSpendKrw,
    estimatedAllInSpendKrw: report.estimatedAllInSpendKrw,
    regenerated: Boolean(replacement),
    previousDraftId: replacement?.previousDraftId ?? null,
    supersededLineCount: replacement?.supersededLineCount ?? 0,
    externalOrderExecuted: false,
  };
}
