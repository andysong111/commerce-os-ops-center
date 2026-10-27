import { loadFastPurchaseInternalDrafts } from "@/lib/fastPurchaseInternalDraft";
import {
  appendPurchaseStrategyProductEvent,
  loadPurchaseStrategyState,
  PurchaseStrategyError,
} from "@/lib/purchaseStrategyState";
import { normalizePurchaseDraftDiscontinuations } from "@/lib/purchaseDraftDiscontinuationsCore";

const DRAFT_ID = /^fast-purchase-draft:[a-f0-9]{20}$/;

export { normalizePurchaseDraftDiscontinuations } from "@/lib/purchaseDraftDiscontinuationsCore";

/**
 * Converts an explicit operator "단종예정" decision in an active purchase
 * draft into the existing permanent purchase-strategy ledger. It never changes
 * Shopling sale status, stock quantity, an external order, or payment state.
 */
export async function storePurchaseDraftDiscontinuations(input: {
  draftId: unknown;
  barcodes: unknown;
}) {
  const draftId = String(input.draftId ?? "").trim();
  if (!DRAFT_ID.test(draftId)) {
    throw new Error("PURCHASE_DRAFT_DISCONTINUATIONS_DRAFT_INVALID");
  }
  const barcodes = normalizePurchaseDraftDiscontinuations(input.barcodes);
  if (!barcodes.length) {
    return { savedCount: 0, alreadySavedCount: 0, barcodes: [] as string[] };
  }

  const ledger = await loadFastPurchaseInternalDrafts();
  if (ledger.error) {
    throw new Error(`PURCHASE_DRAFT_DISCONTINUATIONS_LEDGER_UNAVAILABLE:${ledger.error}`);
  }
  const draft = ledger.drafts.find(
    (row) => row.draftId === draftId && row.openQuantity > 0,
  );
  if (!draft) {
    throw new Error("PURCHASE_DRAFT_DISCONTINUATIONS_ACTIVE_DRAFT_CHANGED");
  }
  const activeBarcodes = new Set(
    draft.lines.filter((row) => row.openQuantity > 0).map((row) => row.barcode),
  );
  if (barcodes.some((barcode) => !activeBarcodes.has(barcode))) {
    throw new Error("PURCHASE_DRAFT_DISCONTINUATIONS_OUTSIDE_DRAFT");
  }

  let state = await loadPurchaseStrategyState();
  let savedCount = 0;
  let alreadySavedCount = 0;
  for (const barcode of barcodes) {
    if (
      state.states.find((row) => row.barcode === barcode)?.status ===
      "DISCONTINUED"
    ) {
      alreadySavedCount += 1;
      continue;
    }
    const previousSourceEventId =
      state.productHistory.find((event) => event.barcode === barcode)
        ?.sourceEventId ?? null;
    try {
      await appendPurchaseStrategyProductEvent({
        action: "DISCONTINUE",
        barcode,
        reason: `발주초안에서 단종예정 지정 · ${draftId}`,
        actor: "ops-center-purchase-draft",
        expectedPreviousSourceEventId: previousSourceEventId,
      });
      savedCount += 1;
    } catch (error) {
      if (!(error instanceof PurchaseStrategyError)) throw error;
      const latest = await loadPurchaseStrategyState();
      if (
        latest.states.find((row) => row.barcode === barcode)?.status !==
        "DISCONTINUED"
      ) {
        throw error;
      }
      alreadySavedCount += 1;
      state = latest;
      continue;
    }
    state = await loadPurchaseStrategyState();
    if (
      state.states.find((row) => row.barcode === barcode)?.status !==
      "DISCONTINUED"
    ) {
      throw new Error(
        `PURCHASE_DRAFT_DISCONTINUATIONS_WRITE_NOT_VISIBLE:${barcode}`,
      );
    }
  }

  return { savedCount, alreadySavedCount, barcodes };
}
