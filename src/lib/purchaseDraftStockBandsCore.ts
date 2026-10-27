import { canonicalPurchaseBarcode } from "./purchaseSkuCanonicalization.ts";
import { PURCHASE_DRAFT_REVIEW_LINE_LIMIT } from "./purchaseDraftLimits.ts";

export type PurchaseDraftStockBand = "OUT" | "LOW" | "NORMAL" | "HIGH";
export type PurchaseDraftStockBandUpdate = {
  barcode: string;
  stockBand: PurchaseDraftStockBand;
};

const BARCODE = /^B[A-Z]{1,2}\d+-\d+$/;

export function normalizePurchaseDraftStockBandUpdates(input: unknown) {
  if (!Array.isArray(input) || input.length > PURCHASE_DRAFT_REVIEW_LINE_LIMIT) {
    throw new Error("PURCHASE_DRAFT_STOCK_BANDS_INVALID");
  }
  const byBarcode = new Map<string, PurchaseDraftStockBand>();
  for (const value of input) {
    const row = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    const barcode = canonicalPurchaseBarcode(row.barcode);
    const stockBand = String(row.stockBand ?? "").trim().toUpperCase() as PurchaseDraftStockBand;
    const previous = byBarcode.get(barcode);
    if (
      !BARCODE.test(barcode) ||
      !(["OUT", "LOW", "NORMAL", "HIGH"] as string[]).includes(stockBand) ||
      (previous !== undefined && previous !== stockBand)
    ) {
      throw new Error("PURCHASE_DRAFT_STOCK_BANDS_INVALID");
    }
    byBarcode.set(barcode, stockBand);
  }
  return [...byBarcode].map(([barcode, stockBand]) => ({
    barcode,
    stockBand,
  } satisfies PurchaseDraftStockBandUpdate));
}
