import { createHash } from "node:crypto";
import { loadInternalChinaMonthlyPurchaseSummary } from "@/lib/internalChinaMonthlyPurchaseSummary";
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
    monthlySpend: async (cycleMonth) => {
      // A successful empty read means no recorded purchase. A read error must
      // propagate to the core; it is never silently converted into zero spend.
      const summary = await loadInternalChinaMonthlyPurchaseSummary(cycleMonth);
      return {
        cycleMonth: summary?.cycleMonth ?? cycleMonth,
        readAt: new Date().toISOString(),
        recordedSpendKrw: summary?.actualOrderPaidKrwAtInternalFx ?? 0,
        contentFingerprint: `sha256:${createHash("sha256").update(JSON.stringify({ cycleMonth, summary })).digest("hex")}`,
      };
    },
  }, () => new Date().toISOString());
}
