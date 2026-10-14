const BARCODE = /^[A-Z]{3}\d+-\d+$/;

export type DraftBatchQuantity = {
  barcode: string;
  targetQuantity: number;
};

function normalizedBarcode(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim().toUpperCase();
}

export function buildPurchaseDraftBatchRecalculationHref(input: {
  regenerationHref: string;
  origin: string;
  excludedBarcodes: string[];
  quantityOverrides: DraftBatchQuantity[];
}) {
  const excluded = [...new Set(input.excludedBarcodes.map(normalizedBarcode))]
    .filter((barcode) => BARCODE.test(barcode))
    .sort();
  const excludedSet = new Set(excluded);
  const quantities = new Map<string, number>();
  for (const row of input.quantityOverrides) {
    const barcode = normalizedBarcode(row.barcode);
    const targetQuantity = Math.round(Number(row.targetQuantity));
    if (
      !BARCODE.test(barcode) ||
      excludedSet.has(barcode) ||
      !Number.isFinite(targetQuantity) ||
      targetQuantity < 1 ||
      targetQuantity > 9_999
    ) {
      continue;
    }
    quantities.set(barcode, targetQuantity);
  }

  const url = new URL(input.regenerationHref, input.origin);
  url.searchParams.delete("exclude");
  url.searchParams.delete("qty");
  for (const barcode of excluded) url.searchParams.append("exclude", barcode);
  for (const [barcode, targetQuantity] of [...quantities].sort(([left], [right]) => left.localeCompare(right))) {
    url.searchParams.append("qty", `${barcode}:${targetQuantity}`);
  }
  return `${url.pathname}?${url.searchParams.toString()}`;
}
