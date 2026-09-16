import { loadVerifiedPurchaseCycleSpend } from "@/lib/purchaseCyclePreflightSpend";
import { loadLatestCandidateSalesSnapshot } from "@/lib/stage8CandidateDemandParity";
import { loadCandidatePromotionGate } from "@/lib/stage8CandidatePromotionGate";
import { loadPostApplyCanonicalReconciliation } from "@/lib/stage8PostApplyCanonicalReconciliation";
import { loadInventoryVerificationPriority } from "@/lib/stage8InventoryVerificationPriority";
import { readPurchaseCyclePreflight, type PurchasePreflightOptions } from "@/lib/purchaseCyclePreflightCore";

// Only read loaders. evidence.report has no candidateSalesRequestId: use the
// real promotion gate's pins rather than inventing fields or weakening checks.
export async function loadPurchaseCyclePreflight(options: PurchasePreflightOptions) {
  return readPurchaseCyclePreflight(options, {
    candidate: async () => {
      const value = await loadLatestCandidateSalesSnapshot();
      return {
        requestId: value.salesRequestId, analysisAsOf: value.analysisAsOf,
        planFingerprint: value.planFingerprint, eventFingerprint: value.eventFingerprint,
        planningContentFingerprint: value.planningContentFingerprint,
      };
    },
    gate: loadCandidatePromotionGate,
    reconciliation: loadPostApplyCanonicalReconciliation,
    // The source metadata is reused from this ONE existing shadow/priority
    // load, not fetched again via nested cost-recovery or shadow loaders.
    priority: loadInventoryVerificationPriority,
    monthlySpend: loadVerifiedPurchaseCycleSpend,
  }, () => new Date().toISOString());
}
