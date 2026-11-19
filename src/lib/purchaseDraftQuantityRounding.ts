export const PURCHASE_DRAFT_QUANTITY_MIN = 1;
export const PURCHASE_DRAFT_QUANTITY_MAX = 9_999;
export const PURCHASE_DRAFT_QUANTITY_UNIT = 5;

export function normalizePurchaseBundleUnit(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) &&
    parsed >= PURCHASE_DRAFT_QUANTITY_MIN &&
    parsed <= PURCHASE_DRAFT_QUANTITY_MAX
    ? parsed
    : PURCHASE_DRAFT_QUANTITY_UNIT;
}

export function maximumPurchaseDraftQuantity(bundleUnit: unknown = 5) {
  const unit = normalizePurchaseBundleUnit(bundleUnit);
  return Math.floor(PURCHASE_DRAFT_QUANTITY_MAX / unit) * unit;
}

export function nearestPurchaseDraftQuantity(
  value: unknown,
  bundleUnit: unknown = PURCHASE_DRAFT_QUANTITY_UNIT,
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  const unit = normalizePurchaseBundleUnit(bundleUnit);
  const maximum = maximumPurchaseDraftQuantity(unit);
  if (maximum < unit) return 0;
  const bounded = Math.min(maximum, Math.max(unit, parsed));
  return Math.min(maximum, Math.max(unit, Math.floor(bounded / unit + 0.5) * unit));
}

export function isPurchaseDraftQuantityUnit(
  value: unknown,
  bundleUnit: unknown = PURCHASE_DRAFT_QUANTITY_UNIT,
) {
  const parsed = Number(value);
  const unit = normalizePurchaseBundleUnit(bundleUnit);
  return Number.isSafeInteger(parsed) &&
    parsed >= unit &&
    parsed <= maximumPurchaseDraftQuantity(unit) &&
    parsed % unit === 0;
}

export function purchaseDraftQuantityUnitMessage(bundleUnit: unknown = 5) {
  return `이 상품은 소분단위가 ${normalizePurchaseBundleUnit(bundleUnit).toLocaleString("ko-KR")}개입니다.`;
}
