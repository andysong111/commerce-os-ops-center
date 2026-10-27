const BARCODE = /^B[A-Z]{2}\d+-\d+$/;
const MAX_DISCONTINUATIONS = 50;

export function normalizePurchaseDraftDiscontinuations(input: unknown) {
  if (!Array.isArray(input) || input.length > MAX_DISCONTINUATIONS) {
    throw new Error("PURCHASE_DRAFT_DISCONTINUATIONS_INVALID");
  }
  const seen = new Set<string>();
  return input.map((value) => {
    const barcode = String(value ?? "")
      .normalize("NFKC")
      .trim()
      .toUpperCase()
      .replace(/[‐-―−]/g, "-")
      .replace(/\s+/g, "");
    if (!BARCODE.test(barcode) || seen.has(barcode)) {
      throw new Error("PURCHASE_DRAFT_DISCONTINUATIONS_INVALID");
    }
    seen.add(barcode);
    return barcode;
  });
}
