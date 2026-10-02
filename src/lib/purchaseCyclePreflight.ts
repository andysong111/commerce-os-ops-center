import { loadVerifiedPurchaseCycleSpend } from "@/lib/purchaseCyclePreflightSpend";
import { loadLatestCandidateSalesSnapshot } from "@/lib/stage8CandidateDemandParity";
import { loadCandidatePromotionGate } from "@/lib/stage8CandidatePromotionGate";
import { loadPostApplyCanonicalReconciliation } from "@/lib/stage8PostApplyCanonicalReconciliation";
import { loadInventoryVerificationPriority } from "@/lib/stage8InventoryVerificationPriority";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { loadShoplingCurrentPriceSnapshot } from "@/lib/shopling/shoplingCurrentPrice";
import { buildPurchaseWholesaleCostEstimates } from "@/lib/purchaseWholesaleCostEstimate";
import { PURCHASE_OWNER_COST_ESTIMATES } from "@/lib/purchaseCycleOwnerCostEstimate";
import { loadChinaOrderLedger, safeReplacementDraftCommitments } from "@/lib/chinaOrderLedger";
import {
  buildPurchaseReplacementDraftSnapshot,
  readPurchaseCyclePreflight,
  type PurchasePreflightOptions,
} from "@/lib/purchaseCyclePreflightCore";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function loadReplacementDraftSnapshot(draftId: string) {
  const ledger = await loadChinaOrderLedger();
  if (ledger.error) throw new Error("REPLACEMENT_DRAFT_LEDGER_READ_FAILED");
  const quantities = safeReplacementDraftCommitments(ledger.commitments, draftId);
  const rows = ledger.commitments.filter((row) => row.sourceRunId === draftId);
  return buildPurchaseReplacementDraftSnapshot(
    draftId,
    new Date().toISOString(),
    [...quantities].map(([barcode, quantity]) => {
      const source = rows.find((row) => row.barcode === barcode);
      const name = String(object(source?.latestPayload).productName ?? "").trim();
      return { barcode, quantity, name };
    }),
  );
}

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
    priority: () =>
      loadInventoryVerificationPriority(options.targetDate, {
        excludeCommitmentDraftId: options.replaceDraftId ?? null,
      }),
    monthlySpend: loadVerifiedPurchaseCycleSpend,
    wholesaleCosts: async () => {
      const planning = await loadProductPlanningSnapshot();
      const currentPrices = await loadShoplingCurrentPriceSnapshot(planning.products);
      return buildPurchaseWholesaleCostEstimates({
        products: planning.products,
        planningContentFingerprint: planning.contentFingerprint,
        currentPrices,
      });
    },
    ownerCosts: async () => PURCHASE_OWNER_COST_ESTIMATES,
    replacementDraft: loadReplacementDraftSnapshot,
  }, () => new Date().toISOString());
}
