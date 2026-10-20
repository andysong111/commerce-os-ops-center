const BARCODE_PATTERN = /^[A-Z]{3}\d+-\d+$/;

export type ProductLaunchPurchaseMetadata = {
  barcode: string;
  modelNumber: string;
  productName: string;
  supplierLink: string;
  saleOption: string;
  chinaOption: string;
  shoplingQuantity: number | null;
  shoplingSyncedAt: string | null;
  conflict: boolean;
};

type Candidate = Omit<ProductLaunchPurchaseMetadata, "conflict">;

export function buildProductLaunchPurchaseMetadataMap(
  summaries: Array<{
    barcode?: unknown;
    modelNumber?: unknown;
    productName?: unknown;
    chinaProductLinks?: unknown;
    orderOptions?: unknown;
  }>,
) {
  const candidates = new Map<string, Candidate[]>();
  for (const summary of summaries) {
    const summaryLinks = Array.isArray(summary.chinaProductLinks)
      ? summary.chinaProductLinks.map(normalizeSupplierLink).filter(Boolean)
      : [];
    // Purchase policy: all B-codes under the same model use the product-level
    // fixed #1 China link. Per-B-code supplier links are intentionally ignored.
    const fixedFirstSupplierLink = summaryLinks[0] ?? "";
    const modelNumber = text(summary.modelNumber);
    const productName = text(summary.productName);
    const options = Array.isArray(summary.orderOptions)
      ? summary.orderOptions.filter(isRecord)
      : [];
    const optionBarcodes = new Set<string>();

    for (const option of options) {
      const barcode = normalizeBarcode(option.barcode);
      if (!BARCODE_PATTERN.test(barcode)) continue;
      optionBarcodes.add(barcode);
      addCandidate(candidates, {
        barcode,
        modelNumber,
        productName,
        supplierLink: fixedFirstSupplierLink,
        saleOption: text(option.saleOption),
        chinaOption: text(option.chinaOption),
        shoplingQuantity: shoplingQuantity(option.shoplingOptionSync),
        shoplingSyncedAt: shoplingSyncedAt(option.shoplingOptionSync),
      });
    }

    const mainBarcode = normalizeBarcode(summary.barcode);
    if (BARCODE_PATTERN.test(mainBarcode) && !optionBarcodes.has(mainBarcode)) {
      const only = options.length === 1 ? options[0] : null;
      addCandidate(candidates, {
        barcode: mainBarcode,
        modelNumber,
        productName,
        supplierLink: fixedFirstSupplierLink,
        saleOption: text(only?.saleOption),
        chinaOption: text(only?.chinaOption),
        shoplingQuantity: shoplingQuantity(only?.shoplingOptionSync),
        shoplingSyncedAt: shoplingSyncedAt(only?.shoplingOptionSync),
      });
    }
  }

  return new Map(
    [...candidates.entries()].map(([barcode, rows]) => {
      const modelNumbers = uniqueNonEmpty(rows.map((row) => row.modelNumber));
      const productNames = uniqueNonEmpty(rows.map((row) => row.productName));
      const supplierLinks = uniqueNonEmpty(rows.map((row) => row.supplierLink));
      const saleOptions = uniqueNonEmpty(rows.map((row) => row.saleOption));
      const chinaOptions = uniqueNonEmpty(rows.map((row) => row.chinaOption));
      const shoplingQuantities = [
        ...new Set(
          rows
            .map((row) => row.shoplingQuantity)
            .filter((value): value is number => value !== null),
        ),
      ];
      const shoplingSyncTimes = uniqueNonEmpty(
        rows.map((row) => row.shoplingSyncedAt ?? ""),
      ).sort();
      const conflict =
        supplierLinks.length > 1 ||
        saleOptions.length > 1 ||
        chinaOptions.length > 1;
      return [
        barcode,
        {
          barcode,
          modelNumber: modelNumbers.length === 1 ? modelNumbers[0] : "",
          productName: productNames.length === 1 ? productNames[0] : "",
          supplierLink: supplierLinks.length === 1 ? supplierLinks[0] : "",
          saleOption: saleOptions.length === 1 ? saleOptions[0] : "",
          chinaOption: chinaOptions.length === 1 ? chinaOptions[0] : "",
          shoplingQuantity:
            shoplingQuantities.length === 1 ? shoplingQuantities[0] : null,
          shoplingSyncedAt: shoplingSyncTimes.at(-1) ?? null,
          conflict,
        },
      ] as const;
    }),
  );
}

function addCandidate(map: Map<string, Candidate[]>, candidate: Candidate) {
  map.set(candidate.barcode, [...(map.get(candidate.barcode) ?? []), candidate]);
}

function normalizeSupplierLink(value: unknown) {
  const candidate = text(value);
  if (!candidate || candidate.length > 4000) return "";
  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function shoplingQuantity(value: unknown) {
  const sync = isRecord(value) ? value : {};
  const raw = text(sync.optQty);
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function shoplingSyncedAt(value: unknown) {
  const sync = isRecord(value) ? value : {};
  const parsed = Date.parse(text(sync.syncedAt));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeBarcode(value: unknown) {
  return text(value).normalize("NFKC").toUpperCase().replace(/\s+/g, "");
}

function uniqueNonEmpty(values: string[]) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown) {
  return String(value ?? "").trim();
}
