import type { PriceAdjustmentReceipt } from "./priceAdjustmentReceiptCache";
import { receiptRecord } from "./internalChinaReceiptFollowupCore";

export function validateReceiptReadbackIdentity(costs: PriceAdjustmentReceipt[], payload: unknown) {
  const root = receiptRecord(payload);
  if (!Array.isArray(root.rows)) throw new Error("RECEIPT_FOLLOWUP_READBACK_INVALID");
  for (const cost of costs) {
    const row = root.rows.map(receiptRecord).find((item) => item.externalId === cost.id);
    if (!row || row.barcode !== cost.barcode) throw new Error("RECEIPT_FOLLOWUP_SKU_IDENTITY_CONFLICT");
  }
}

// Recovery inserts only cost rows that are genuinely absent. Any existing
// different value must be reconciled in the original cost workflow, not blindly
// overwritten by replaying a receipt or an older captured purchase cost.
export function missingReceiptCostRows(costs: PriceAdjustmentReceipt[], payload: unknown) {
  const root = receiptRecord(payload);
  if (root.ok !== true || root.proof !== "PERSISTED_RECEIPT_COST_ROWS_ONLY" || !Array.isArray(root.rows) || root.receiptId !== costs[0]?.receiptId) throw new Error("RECEIPT_FOLLOWUP_READBACK_INVALID");
  const rows = root.rows.map(receiptRecord);
  if (rows.some((row) => !costs.some((cost) => cost.id === row.externalId))) throw new Error("RECEIPT_FOLLOWUP_EXISTING_COST_CONFLICT");
  return costs.filter((cost) => {
    const matches = rows.filter((row) => row.externalId === cost.id);
    if (!matches.length) return true;
    const row = matches[0];
    if (matches.length !== 1 || row.barcode !== cost.barcode || Number(row.quantity) !== cost.quantity || Number(row.unitCostKrw) !== cost.unitCostKrw || Date.parse(String(row.receivedAt)) !== Date.parse(cost.receivedAt)) throw new Error("RECEIPT_FOLLOWUP_EXISTING_COST_CONFLICT");
    return false;
  });
}

export function receiptCostOnlyPayload(
  costs: PriceAdjustmentReceipt[],
  canonicalRows: Array<{ id: string; externalId?: string | null; skuId: string; quantity: number; unitCostKrw: number; receivedAt: string; source: string }>,
  catalogPayload: unknown,
) {
  const catalog = receiptRecord(catalogPayload);
  if (catalog.ok !== true || !Array.isArray(catalog.products)) throw new Error("RECEIPT_FOLLOWUP_CATALOG_INVALID");
  const identities = catalog.products.flatMap((rawProduct) => {
    const product = receiptRecord(rawProduct);
    return (Array.isArray(product.skus) ? product.skus : []).map((rawSku) => ({ ...receiptRecord(rawSku), modelNo: product.modelNo }));
  });
  const receiptCosts = costs.map((cost) => {
    const matches = identities.filter((sku) => sku.active === true && sku.barcode === cost.barcode);
    const sku = matches[0];
    const rows = canonicalRows.filter((row) => row.externalId === cost.id);
    if (matches.length !== 1 || !sku || typeof sku.skuId !== "string" || !sku.skuId || sku.modelNo !== cost.modelNumber || rows.length !== 1) throw new Error("RECEIPT_FOLLOWUP_SKU_IDENTITY_REQUIRED");
    return { ...rows[0], skuId: sku.skuId };
  });
  // Do not include skus/products/listings: recovery must not undo a location
  // move or recreate an identity from stale tracker metadata.
  return { receiptCosts };
}
