export const PURCHASE_CYCLE_ROUGH_STOCK_BANDS = [
  "HIGH",
  "NORMAL",
  "LOW",
  "OUT",
] as const;

export type PurchaseCycleRoughStockBand =
  (typeof PURCHASE_CYCLE_ROUGH_STOCK_BANDS)[number];

export type PurchaseCycleRoughStockTarget = {
  barcode: string;
  productName: string;
};

export type PurchaseCycleRoughStockEstimateItem = {
  barcode: string;
  stockBand: PurchaseCycleRoughStockBand;
};

const normalizeBarcode = (value: string) => value.trim().toUpperCase();

export function buildPurchaseCycleRoughStockEstimateItems(
  targets: PurchaseCycleRoughStockTarget[],
  selections: Readonly<Record<string, PurchaseCycleRoughStockBand | undefined>>,
): PurchaseCycleRoughStockEstimateItem[] {
  const seen = new Set<string>();

  return targets.map((target) => {
    const barcode = normalizeBarcode(target.barcode);
    if (!barcode) {
      throw new Error("B코드가 없는 상품은 재고상태를 저장할 수 없습니다.");
    }
    if (seen.has(barcode)) {
      throw new Error(`중복된 B코드가 있습니다: ${barcode}`);
    }
    seen.add(barcode);

    const stockBand = selections[barcode];
    if (!stockBand || !PURCHASE_CYCLE_ROUGH_STOCK_BANDS.includes(stockBand)) {
      throw new Error(`${barcode}의 대략재고를 선택해 주세요.`);
    }

    return { barcode, stockBand };
  });
}

function fnv1a(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildPurchaseCycleRoughStockBatchId(
  scope: string,
  items: PurchaseCycleRoughStockEstimateItem[],
) {
  const normalizedScope = scope.trim() || "purchase-cycle-preflight";
  const fingerprint = items
    .map((item) => `${normalizeBarcode(item.barcode)}:${item.stockBand}`)
    .join("|");
  return `purchase-cycle-inline:${fnv1a(`${normalizedScope}|${fingerprint}`)}`;
}
