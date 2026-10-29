const BCODE_PATTERN = /^B[A-Z]{1,2}\d+-\d+$/;
const MAX_FOCUSED_BARCODES = 50;
const DEFAULT_RETURN_TO = "/purchase-cycle-preflight";

type SearchValue = string | string[] | undefined;

export type RoughStockCorrectionSearchParams = Record<string, SearchValue>;

function first(value: SearchValue) {
  return Array.isArray(value) ? value[0] : value;
}

export function normalizeRoughStockBarcodes(values: Iterable<unknown>) {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const barcode = String(value ?? "").trim().toUpperCase();
    if (!BCODE_PATTERN.test(barcode) || seen.has(barcode)) continue;
    seen.add(barcode);
    normalized.push(barcode);
    if (normalized.length >= MAX_FOCUSED_BARCODES) break;
  }

  return normalized;
}

export function sanitizeRoughStockReturnTo(value: unknown) {
  const candidate = String(value ?? "").trim();
  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\")
  ) {
    return DEFAULT_RETURN_TO;
  }

  try {
    const base = new URL("https://commerce-os.invalid");
    const parsed = new URL(candidate, base);
    if (parsed.origin !== base.origin) return DEFAULT_RETURN_TO;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_RETURN_TO;
  }
}

export function roughStockCorrectionHref(
  barcodes: Iterable<unknown>,
  returnTo = "/purchase-cycle-preflight",
) {
  const params = new URLSearchParams({
    focus: "rough-stock",
    barcodes: normalizeRoughStockBarcodes(barcodes).join(","),
    returnTo: sanitizeRoughStockReturnTo(returnTo),
  });
  return `/china-order-manager/stock-control?${params.toString()}#rough-stock-status`;
}

export function parseRoughStockCorrectionSearchParams(
  searchParams: RoughStockCorrectionSearchParams,
) {
  if (first(searchParams.focus) !== "rough-stock") {
    return { barcodes: [], returnTo: null };
  }

  const rawBarcodes = first(searchParams.barcodes) ?? "";
  return {
    barcodes: normalizeRoughStockBarcodes(rawBarcodes.split(",")),
    returnTo: sanitizeRoughStockReturnTo(first(searchParams.returnTo)),
  };
}
