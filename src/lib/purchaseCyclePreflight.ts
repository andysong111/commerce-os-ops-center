import { loadVerifiedPurchaseCycleSpend } from "@/lib/purchaseCyclePreflightSpend";
import { loadLatestCandidateSalesPin } from "@/lib/stage8CandidateDemandParity";
import { loadPostApplyCanonicalReconciliation } from "@/lib/stage8PostApplyCanonicalReconciliation";
import { loadInventoryVerificationPriority } from "@/lib/stage8InventoryVerificationPriority";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { loadShoplingCurrentPriceSnapshot } from "@/lib/shopling/shoplingCurrentPrice";
import { buildPurchaseWholesaleCostEstimates } from "@/lib/purchaseWholesaleCostEstimate";
import { PURCHASE_OWNER_COST_ESTIMATES } from "@/lib/purchaseCycleOwnerCostEstimate";
import {
  loadChinaOrderLedger,
  safeReplacementCycleDraftRows,
} from "@/lib/chinaOrderLedger";
import { loadInternalChinaQuantityOverrides } from "@/lib/internalChinaDraftQuantityOverride";
import { purchaseReplacementDraftSnapshotLines } from "@/lib/purchaseReplacementDraftLineage";
import {
  buildPurchaseReplacementDraftSnapshot,
  readPurchaseCyclePreflight,
  type PurchasePreflightOptions,
} from "@/lib/purchaseCyclePreflightCore";
import type { InventoryStockBand } from "@/lib/inventoryStockBulkInput";
import { loadStoredInternalChinaPurchaseDraftForCost } from "@/lib/internalChinaPurchaseDraft";
import { buildPurchaseActualDraftCostSnapshot } from "@/lib/purchaseActualDraftCostSnapshot";

const DEFAULT_READER_TIMEOUT_MS = 60_000;

function readerTimeoutMs(value: number | undefined) {
  return Math.max(
    1_000,
    Math.min(DEFAULT_READER_TIMEOUT_MS, Math.trunc(value ?? DEFAULT_READER_TIMEOUT_MS)),
  );
}

async function withReaderTimeout<T>(
  code: string,
  timeoutMs: number,
  read: () => Promise<T>,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(read),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${code}_TIMEOUT`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function loadReplacementDraftSnapshot(draftId: string) {
  const [ledger, overrides] = await Promise.all([
    loadChinaOrderLedger(),
    loadInternalChinaQuantityOverrides(draftId),
  ]);
  if (ledger.error) throw new Error("REPLACEMENT_DRAFT_LEDGER_READ_FAILED");
  const activeRows = safeReplacementCycleDraftRows(ledger.commitments, draftId);
  return buildPurchaseReplacementDraftSnapshot(
    draftId,
    new Date().toISOString(),
    purchaseReplacementDraftSnapshotLines(
      ledger.commitments,
      activeRows,
      draftId,
      overrides,
    ),
  );
}

// Only read loaders. evidence.report has no candidateSalesRequestId: use the
// real promotion gate's pins rather than inventing fields or weakening checks.
export async function loadPurchaseCyclePreflight(
  options: PurchasePreflightOptions,
  loadOptions: {
    readerTimeoutMs?: number;
    operatorStockBandUpdates?: readonly {
      barcode: string;
      stockBand: InventoryStockBand;
    }[];
    operatorStockBandOccurredAt?: string | null;
  } = {},
) {
  const timeoutMs = readerTimeoutMs(loadOptions.readerTimeoutMs);
  const bounded = <T>(code: string, read: () => Promise<T>) =>
    withReaderTimeout(code, timeoutMs, read);
  let reconciliationPromise: ReturnType<typeof loadPostApplyCanonicalReconciliation> | null = null;
  const sharedReconciliation = () => {
    reconciliationPromise ??= loadPostApplyCanonicalReconciliation({
      externalRequestTimeoutMs: timeoutMs,
    });
    return reconciliationPromise;
  };
  return readPurchaseCyclePreflight(options, {
    candidate: () => bounded("CANDIDATE_READ", async () => {
      const value = await loadLatestCandidateSalesPin();
      return {
        requestId: value.salesRequestId, analysisAsOf: value.analysisAsOf,
        planFingerprint: value.planFingerprint, eventFingerprint: value.eventFingerprint,
        planningContentFingerprint: value.planningContentFingerprint,
      };
    }),
    reconciliation: () => bounded(
      "MASTER_READBACK_READ",
      sharedReconciliation,
    ),
    // The source metadata is reused from this ONE existing shadow/priority
    // load, not fetched again via nested cost-recovery or shadow loaders.
    priority: () => bounded(
      "INVENTORY_PRIORITY_READ",
      async () => loadInventoryVerificationPriority(options.targetDate, {
        excludeCommitmentDraftId: options.replaceDraftId ?? null,
        externalRequestTimeoutMs: timeoutMs,
        reconciliation: await sharedReconciliation(),
        operatorStockBandUpdates: loadOptions.operatorStockBandUpdates,
        operatorStockBandOccurredAt: loadOptions.operatorStockBandOccurredAt,
      }),
    ),
    monthlySpend: (cycleMonth) => bounded(
      "CYCLE_SPEND_READ",
      () => loadVerifiedPurchaseCycleSpend(cycleMonth),
    ),
    wholesaleCosts: () => bounded("WHOLESALE_COST_READ", async () => {
      const planning = await loadProductPlanningSnapshot({
        requestTimeoutMs: timeoutMs,
      });
      const currentPrices = await loadShoplingCurrentPriceSnapshot(
        planning.products,
        { requestTimeoutMs: timeoutMs },
      );
      return buildPurchaseWholesaleCostEstimates({
        products: planning.products,
        planningContentFingerprint: planning.contentFingerprint,
        currentPrices,
      });
    }),
    ownerCosts: async () => PURCHASE_OWNER_COST_ESTIMATES,
    actualDraftCosts: (draftId) => bounded(
      "ACTUAL_DRAFT_COST_READ",
      async () => {
        const draft = await loadStoredInternalChinaPurchaseDraftForCost(draftId);
        return draft
          ? buildPurchaseActualDraftCostSnapshot(draft, new Date().toISOString())
          : null;
      },
    ),
    replacementDraft: (draftId) => bounded(
      "REPLACEMENT_DRAFT_READ",
      () => loadReplacementDraftSnapshot(draftId),
    ),
  }, () => new Date().toISOString());
}
