import { loadFastPurchaseInternalDrafts } from "@/lib/fastPurchaseInternalDraft";
import { loadPurchaseDraftOperatorAdjustments } from "@/lib/purchaseCycleDraftRegeneration";
import { createPurchaseCyclePreflightDraft } from "@/lib/purchaseCyclePreflightDraft";
import { loadPurchaseCyclePreflight } from "@/lib/purchaseCyclePreflight";
import {
  purchaseCycleDraftConfirmation,
  purchaseCycleDraftPreflightOptions,
  type PurchaseCycleDraftRequest,
} from "@/lib/purchaseCyclePreflightDraftCore";
import { seoulCalendarDate } from "@/lib/monthlyPurchasePolicy";
import {
  replaceablePriorPurchaseRun,
  sameDayPurchaseRun,
} from "@/lib/purchaseRunStartPolicy";

export function purchaseRunStartRequest(targetDate: string): PurchaseCycleDraftRequest {
  return {
    targetDate,
    cashLimitKrw: null,
    sourcingBudgetPercent: 0,
    preferredSourcingConceptIds: [],
    sourcingStorageSizeByConceptId: {},
    sourcingVariantSelections: [],
    allowOpenBudgetPreview: false,
    expectedSourceFingerprint: "",
    expectedPlanFingerprint: "",
    expectedSourcingSourceFingerprint: null,
    expectedSourcingPlanFingerprint: null,
    expectedSourcingDecisionFingerprint: null,
    confirmation: "",
    replaceDraftId: null,
    excludedBarcodes: [],
    quantityOverrides: [],
  };
}

export async function startPurchaseRun(targetDate = seoulCalendarDate()) {
  const ledger = await loadFastPurchaseInternalDrafts();
  if (ledger.error) {
    throw new Error(`PURCHASE_RUN_LEDGER_UNAVAILABLE:${ledger.error}`);
  }
  const sameDay = sameDayPurchaseRun(ledger.drafts, targetDate);
  if (sameDay) {
    return {
      draft: sameDay,
      reused: true,
      created: false,
      externalOrderExecuted: false as const,
    };
  }

  const base = purchaseRunStartRequest(targetDate);
  const replaceable = replaceablePriorPurchaseRun(ledger.drafts, targetDate);
  const priorAdjustments = replaceable
    ? await loadPurchaseDraftOperatorAdjustments(replaceable.draftId)
    : null;
  const startRequest: PurchaseCycleDraftRequest = replaceable
    ? {
        ...base,
        replaceDraftId: replaceable.draftId,
        excludedBarcodes: priorAdjustments?.excludedBarcodes ?? [],
        quantityOverrides: priorAdjustments?.quantityOverrides ?? [],
      }
    : base;
  const report = await loadPurchaseCyclePreflight(
    purchaseCycleDraftPreflightOptions(startRequest),
  );
  const request: PurchaseCycleDraftRequest = {
    ...startRequest,
    expectedSourceFingerprint: report.sourceFingerprint,
    expectedPlanFingerprint: report.planFingerprint,
    confirmation: purchaseCycleDraftConfirmation(report),
  };
  const result = await createPurchaseCyclePreflightDraft(request, {
    startNewRun: Boolean(replaceable),
  });
  return {
    draft: result.draft,
    reused: result.draft.duplicate,
    created: !result.draft.duplicate,
    externalOrderExecuted: false as const,
  };
}

