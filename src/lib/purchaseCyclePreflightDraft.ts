import {
  storeValidatedMonthlyPurchaseDraft,
  type FastPurchaseInternalDraft,
} from "@/lib/fastPurchaseInternalDraft";
import { loadInternalChinaMonthlyPurchaseClose } from "@/lib/internalChinaMonthlyPurchaseClose";
import { loadPurchaseCyclePreflight } from "@/lib/purchaseCyclePreflight";
import {
  preparePurchaseCycleDraft,
  type PurchaseCycleDraftRequest,
} from "@/lib/purchaseCyclePreflightDraftCore";

export async function createPurchaseCyclePreflightDraft(
  request: PurchaseCycleDraftRequest,
): Promise<{
  draft: FastPurchaseInternalDraft;
  selectedCount: number;
  estimatedSpendKrw: number;
  estimatedAllInSpendKrw: number;
  externalOrderExecuted: false;
}> {
  const report = await loadPurchaseCyclePreflight({
    targetDate: request.targetDate,
    cashLimitKrw: null,
    maxSkus: 100,
    maxUnitsPerSku: 9_999,
    allowOpenBudgetPreview: true,
  });
  const prepared = preparePurchaseCycleDraft(report, request);
  if (await loadInternalChinaMonthlyPurchaseClose(prepared.cycleMonth)) {
    throw new Error(`FAST_PURCHASE_MONTHLY_CYCLE_CLOSED:${prepared.cycleMonth}`);
  }
  const draft = await storeValidatedMonthlyPurchaseDraft({
    ...prepared,
    dataMode: "PURCHASE_PREFLIGHT",
    allowAdoptExistingReservedDraft: false,
  });
  return {
    draft,
    selectedCount: report.selected.length,
    estimatedSpendKrw: report.estimatedSpendKrw,
    estimatedAllInSpendKrw: report.estimatedAllInSpendKrw,
    externalOrderExecuted: false,
  };
}
