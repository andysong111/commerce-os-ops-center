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
  safeReplacementDraftOpenCommitments,
} from "@/lib/chinaOrderLedger";
import { loadInternalChinaQuantityOverrides } from "@/lib/internalChinaDraftQuantityOverride";
import {
  buildPurchaseReplacementDraftSnapshot,
  readPurchaseCyclePreflight,
  type PurchasePreflightOptions,
} from "@/lib/purchaseCyclePreflightCore";

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

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function loadReplacementDraftSnapshot(draftId: string) {
  const [ledger, overrides] = await Promise.all([
    loadChinaOrderLedger(),
    loadInternalChinaQuantityOverrides(draftId),
  ]);
  if (ledger.error) throw new Error("REPLACEMENT_DRAFT_LEDGER_READ_FAILED");
  const quantities = safeReplacementDraftOpenCommitments(
    ledger.commitments,
    draftId,
  );
  for (const [barcode, override] of overrides) {
    if (!quantities.has(barcode)) continue;
    if (override.targetQuantity > 0) quantities.set(barcode, override.targetQuantity);
    else quantities.delete(barcode);
  }
  const rows = ledger.commitments.filter((row) => row.sourceRunId === draftId);
  const sourceByBarcode = new Map(rows.map((row) => [row.barcode, row] as const));
  return buildPurchaseReplacementDraftSnapshot(
    draftId,
    new Date().toISOString(),
    [...quantities].map(([barcode, quantity]) => {
      const source = sourceByBarcode.get(barcode);
      const payload = object(source?.latestPayload);
      const name = String(payload.productName ?? "").trim();
      return {
        barcode,
        quantity,
        name,
        preserveOnRegeneration: payload.sourcingConfirmed === true,
      };
    }),
  );
}

// Only read loaders. evidence.report has no candidateSalesRequestId: use the
// real promotion gate's pins rather than inventing fields or weakening checks.
export async function loadPurchaseCyclePreflight(
  options: PurchasePreflightOptions,
  loadOptions: { readerTimeoutMs?: number } = {},
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
    replacementDraft: (draftId) => bounded(
      "REPLACEMENT_DRAFT_READ",
      () => loadReplacementDraftSnapshot(draftId),
    ),
  }, () => new Date().toISOString());
}
