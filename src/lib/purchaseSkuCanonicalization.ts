const VERIFIED_PURCHASE_BARCODE_ALIASES: Readonly<Record<string, string>> = {
  // Product Master migration history: BBD4-3 was replaced by BBD4-2.
  // Old commitments may still contain both codes, but they represent one
  // purchasable option and must never become two order lines.
  "BBD4-3": "BBD4-2",
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function barcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

export function canonicalPurchaseBarcode(value: unknown) {
  const normalized = barcode(value);
  return VERIFIED_PURCHASE_BARCODE_ALIASES[normalized] ?? normalized;
}

export function purchaseBarcodeMetadataCandidates(value: unknown) {
  const canonical = canonicalPurchaseBarcode(value);
  return [
    canonical,
    ...Object.entries(VERIFIED_PURCHASE_BARCODE_ALIASES)
      .filter(([, target]) => target === canonical)
      .map(([alias]) => alias),
  ];
}

export function collapseCanonicalPurchaseRows<
  T extends { barcode: string; skuId?: string | null },
>(rows: T[], compare: (left: T, right: T) => number) {
  const byIdentity = new Map<string, T[]>();
  for (const row of rows) {
    const canonical = canonicalPurchaseBarcode(row.barcode);
    const normalizedSkuId = text(row.skuId);
    const hasVerifiedAlias =
      canonical !== barcode(row.barcode) ||
      purchaseBarcodeMetadataCandidates(canonical).length > 1;
    const key = hasVerifiedAlias
      ? `barcode:${canonical}`
      : normalizedSkuId
        ? `sku:${normalizedSkuId}`
        : `barcode:${canonical}`;
    const current = byIdentity.get(key) ?? [];
    current.push(row);
    byIdentity.set(key, current);
  }

  return [...byIdentity.values()].map((group) => {
    const preferred = [...group].sort(
      (left, right) => compare(left, right) || left.barcode.localeCompare(right.barcode),
    )[0];
    const verifiedAliasTarget = group
      .map((row) => canonicalPurchaseBarcode(row.barcode))
      .find((candidate) => purchaseBarcodeMetadataCandidates(candidate).length > 1);
    const canonical = verifiedAliasTarget ?? canonicalPurchaseBarcode(preferred.barcode);
    return { ...preferred, barcode: canonical };
  });
}
