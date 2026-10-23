import { loadFastPurchaseInternalDrafts } from "@/lib/fastPurchaseInternalDraft";
import { createPurchaseCyclePreflightDraft } from "@/lib/purchaseCyclePreflightDraft";
import { loadPurchaseCyclePreflight } from "@/lib/purchaseCyclePreflight";
import {
  purchaseCycleDraftConfirmation,
  purchaseCycleDraftPreflightOptions,
  type PurchaseCycleDraftRequest,
} from "@/lib/purchaseCyclePreflightDraftCore";
import { seoulCalendarDate } from "@/lib/monthlyPurchasePolicy";

export function activePurchaseRun<T extends { openQuantity: number; updatedAt: string }>(drafts: T[]) {
  return [...drafts]
    .filter((draft) => draft.openQuantity > 0)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
}

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
  const active = activePurchaseRun(ledger.drafts);
  if (active) {
    return {
      draft: active,
      reused: true,
      created: false,
      externalOrderExecuted: false as const,
    };
  }
  const sameDay = ledger.drafts.find((draft) => draft.cycleStartDate === targetDate);
  if (sameDay) {
    return {
      draft: sameDay,
      reused: true,
      created: false,
      externalOrderExecuted: false as const,
    };
  }

  const base = purchaseRunStartRequest(targetDate);
  const report = await loadPurchaseCyclePreflight(
    purchaseCycleDraftPreflightOptions(base),
  );
  const request: PurchaseCycleDraftRequest = {
    ...base,
    expectedSourceFingerprint: report.sourceFingerprint,
    expectedPlanFingerprint: report.planFingerprint,
    confirmation: purchaseCycleDraftConfirmation(report),
  };
  const result = await createPurchaseCyclePreflightDraft(request);
  return {
    draft: result.draft,
    reused: result.draft.duplicate,
    created: !result.draft.duplicate,
    externalOrderExecuted: false as const,
  };
}

