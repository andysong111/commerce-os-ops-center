import { loadFastPurchaseInternalDrafts } from "@/lib/fastPurchaseInternalDraft";
import { storeInventoryOperationBatch } from "@/lib/inventoryStockBulkStore";
import {
  INVENTORY_STOCK_ESTIMATE_BASELINE_OPERATION_TYPE,
  normalizeInventoryStockEstimateInput,
} from "@/lib/inventoryStockEstimateBaselines";
import {
  loadProductMasterInventoryIdentities,
} from "@/lib/productMasterInventoryIdentity";
import {
  normalizePurchaseDraftStockBandUpdates,
} from "@/lib/purchaseDraftStockBandsCore";
import { canonicalPurchaseBarcode } from "@/lib/purchaseSkuCanonicalization";

const DRAFT_ID = /^fast-purchase-draft:[a-f0-9]{20}$/;

export { normalizePurchaseDraftStockBandUpdates } from "@/lib/purchaseDraftStockBandsCore";

/**
 * Saves only rough inventory evidence for B-codes in the currently active
 * draft. These events affect purchase calculations and never enqueue a
 * Shopling sale-status write.
 */
export async function storePurchaseDraftStockBands(input: {
  draftId: unknown;
  updates: unknown;
}) {
  const draftId = String(input.draftId ?? "").trim();
  if (!DRAFT_ID.test(draftId)) {
    throw new Error("PURCHASE_DRAFT_STOCK_BANDS_DRAFT_INVALID");
  }
  const updates = normalizePurchaseDraftStockBandUpdates(input.updates);
  if (!updates.length) return { savedCount: 0, storage: null };

  const ledger = await loadFastPurchaseInternalDrafts();
  if (ledger.error) {
    throw new Error(`PURCHASE_DRAFT_STOCK_BANDS_LEDGER_UNAVAILABLE:${ledger.error}`);
  }
  const draft = ledger.drafts.find((row) => row.draftId === draftId && row.openQuantity > 0);
  if (!draft) throw new Error("PURCHASE_DRAFT_STOCK_BANDS_ACTIVE_DRAFT_CHANGED");
  const activeBarcodes = new Set(
    draft.lines
      .filter((row) => row.openQuantity > 0)
      .map((row) => canonicalPurchaseBarcode(row.barcode)),
  );
  if (updates.some((row) => !activeBarcodes.has(row.barcode))) {
    throw new Error("PURCHASE_DRAFT_STOCK_BANDS_OUTSIDE_DRAFT");
  }

  const identityBatches: string[][] = [];
  for (let index = 0; index < updates.length; index += 100) {
    identityBatches.push(updates.slice(index, index + 100).map((row) => row.barcode));
  }
  const identities = (
    await Promise.all(identityBatches.map(loadProductMasterInventoryIdentities))
  ).flat();
  const blocked = identities.filter((row) => row.state !== "READY" || !row.productKind);
  if (blocked.length) {
    throw new Error(`PURCHASE_DRAFT_STOCK_BANDS_IDENTITY_BLOCKED:${blocked.map((row) => row.barcode).join(",")}`);
  }
  const identityByBarcode = new Map(identities.map((row) => [row.barcode, row] as const));
  const occurredAt = new Date().toISOString();
  const events = updates.map((row) => {
    const identity = identityByBarcode.get(row.barcode);
    if (!identity?.productKind) throw new Error(`PURCHASE_DRAFT_STOCK_BANDS_IDENTITY_MISSING:${row.barcode}`);
    return normalizeInventoryStockEstimateInput({
      eventId: `purchase-draft-stock-band:${draftId}:${occurredAt}:${row.barcode}:${row.stockBand}`,
      barcode: row.barcode,
      productKind: identity.productKind,
      modelNo: identity.modelNo,
      stockBand: row.stockBand,
      occurredAt,
      note: `발주안 내부 대략 재고상태 · ${draftId}`,
    });
  });
  const operations = events.map((event) => ({
    operationType: INVENTORY_STOCK_ESTIMATE_BASELINE_OPERATION_TYPE,
    sourceEventId: `inventory-stock-estimate:${encodeURIComponent(event.eventId)}`,
    correlationId: `inventory-stock:${event.barcode}`,
    snapshot: event,
  }));
  const storage = [];
  for (let index = 0; index < operations.length; index += 50) {
    storage.push(await storeInventoryOperationBatch(operations.slice(index, index + 50)));
  }
  return { savedCount: updates.length, storage };
}
