export type PurchaseDraftStockBand = "OUT" | "LOW" | "NORMAL" | "HIGH";
export type PurchaseDraftStockBandUpdate = {
  barcode: string;
  stockBand: PurchaseDraftStockBand;
};

const BARCODE = /^B[A-Z]{1,2}\d+-\d+$/;

export function normalizePurchaseDraftStockBandUpdates(input: unknown) {
  if (!Array.isArray(input) || input.length > 50) {
    throw new Error("PURCHASE_DRAFT_STOCK_BANDS_INVALID");
  }
  const seen = new Set<string>();
  return input.map((value) => {
    const row = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    const barcode = String(row.barcode ?? "").normalize("NFKC").trim().toUpperCase().replace(/\s+/g, "");
    const stockBand = String(row.stockBand ?? "").trim().toUpperCase() as PurchaseDraftStockBand;
    if (!BARCODE.test(barcode) || !(["OUT", "LOW", "NORMAL", "HIGH"] as string[]).includes(stockBand) || seen.has(barcode)) {
      throw new Error("PURCHASE_DRAFT_STOCK_BANDS_INVALID");
    }
    seen.add(barcode);
    return { barcode, stockBand } satisfies PurchaseDraftStockBandUpdate;
  });
}
