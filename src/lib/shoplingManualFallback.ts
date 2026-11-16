export type ShoplingManualFallbackJob = {
  barcode: string;
  desiredStatus: "SOLD_OUT" | "ON_SALE";
  productKind: "OPTION" | "SINGLE";
  goodsKeys?: string[];
  stockStateApiEvidence?: unknown;
};

export type ShoplingManualFallbackGroups = {
  soldOutProductGoodsKeys: string[];
  onSaleProductGoodsKeys: string[];
  optionGoodsKeys: string[];
  unresolvedBarcodes: string[];
};

type TransmissionKind = "OPTION_SEND" | "PRODUCT_SALE_STATUS_SEND";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numericGoodsKey(value: unknown) {
  const normalized = String(value ?? "").trim();
  return /^\d+$/.test(normalized) ? normalized : "";
}

function transmissionKind(value: unknown): TransmissionKind | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized === "OPTION_SEND" ||
    normalized === "PRODUCT_SALE_STATUS_SEND"
    ? normalized
    : null;
}

function sorted(values: Set<string>) {
  return [...values].sort((left, right) => {
    const numeric = Number(left) - Number(right);
    return numeric || left.localeCompare(right);
  });
}

/**
 * Builds the exact copy/paste lanes for manual A21 recovery. Option products
 * are classified only from the API readback receipt because a fully sold-out
 * or recovering option product can require the product-status lane as well.
 */
export function buildShoplingManualFallbackGroups(
  jobs: readonly ShoplingManualFallbackJob[],
): ShoplingManualFallbackGroups {
  const soldOutProductGoodsKeys = new Set<string>();
  const onSaleProductGoodsKeys = new Set<string>();
  const optionGoodsKeys = new Set<string>();
  const unresolvedBarcodes = new Set<string>();

  for (const job of jobs) {
    const barcode = String(job.barcode ?? "").trim().toUpperCase();
    const jobGoodsKeys = new Set(
      (Array.isArray(job.goodsKeys) ? job.goodsKeys : [])
        .map(numericGoodsKey)
        .filter(Boolean),
    );
    const classifiedGoodsKeys = new Set<string>();
    const receipts = Array.isArray(job.stockStateApiEvidence)
      ? job.stockStateApiEvidence
      : [];

    for (const receiptValue of receipts) {
      const receipt = object(receiptValue);
      const goodsKey = numericGoodsKey(receipt.matchedGoodsKey);
      if (!goodsKey) continue;
      const rawSteps = Array.isArray(receipt.transmissionSteps)
        ? receipt.transmissionSteps
        : [];
      const steps = rawSteps
        .map((value) => transmissionKind(object(value).transmissionKind))
        .filter((value): value is TransmissionKind => value !== null);
      const fallbackKind = transmissionKind(receipt.transmissionKind);
      const kinds = steps.length ? steps : fallbackKind ? [fallbackKind] : [];
      if (!kinds.length) continue;

      classifiedGoodsKeys.add(goodsKey);
      for (const kind of kinds) {
        if (kind === "OPTION_SEND") {
          optionGoodsKeys.add(goodsKey);
        } else if (job.desiredStatus === "SOLD_OUT") {
          soldOutProductGoodsKeys.add(goodsKey);
        } else {
          onSaleProductGoodsKeys.add(goodsKey);
        }
      }
    }

    if (job.productKind === "SINGLE") {
      for (const goodsKey of jobGoodsKeys) {
        classifiedGoodsKeys.add(goodsKey);
        if (job.desiredStatus === "SOLD_OUT") {
          soldOutProductGoodsKeys.add(goodsKey);
        } else {
          onSaleProductGoodsKeys.add(goodsKey);
        }
      }
    }

    const hasUnclassifiedGoodsKey = [...jobGoodsKeys].some(
      (goodsKey) => !classifiedGoodsKeys.has(goodsKey),
    );
    if (
      !classifiedGoodsKeys.size ||
      hasUnclassifiedGoodsKey ||
      (job.productKind === "OPTION" && !receipts.length)
    ) {
      if (barcode) unresolvedBarcodes.add(barcode);
    }
  }

  return {
    soldOutProductGoodsKeys: sorted(soldOutProductGoodsKeys),
    onSaleProductGoodsKeys: sorted(onSaleProductGoodsKeys),
    optionGoodsKeys: sorted(optionGoodsKeys),
    unresolvedBarcodes: [...unresolvedBarcodes].sort(),
  };
}

export function shoplingManualFallbackCopyText(values: readonly string[]) {
  return values.join(",");
}
