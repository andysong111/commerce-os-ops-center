export const PURCHASE_DRAFT_QUANTITY_MIN = 5;
export const PURCHASE_DRAFT_QUANTITY_MAX = 9_995;
export const PURCHASE_DRAFT_QUANTITY_UNIT = 5;

export function nearestPurchaseDraftQuantity(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;

  const bounded = Math.min(
    PURCHASE_DRAFT_QUANTITY_MAX,
    Math.max(PURCHASE_DRAFT_QUANTITY_MIN, parsed),
  );
  const lower = Math.max(
    PURCHASE_DRAFT_QUANTITY_MIN,
    Math.floor(bounded / PURCHASE_DRAFT_QUANTITY_UNIT) * PURCHASE_DRAFT_QUANTITY_UNIT,
  );
  const upper = Math.min(
    PURCHASE_DRAFT_QUANTITY_MAX,
    Math.ceil(bounded / PURCHASE_DRAFT_QUANTITY_UNIT) * PURCHASE_DRAFT_QUANTITY_UNIT,
  );
  const lowerDistance = Math.abs(bounded - lower);
  const upperDistance = Math.abs(upper - bounded);

  if (lowerDistance < upperDistance) return lower;
  if (upperDistance < lowerDistance) return upper;
  if (lower % 10 === 0) return lower;
  if (upper % 10 === 0) return upper;
  return upper;
}

export function isPurchaseDraftQuantityUnit(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) &&
    parsed >= PURCHASE_DRAFT_QUANTITY_MIN &&
    parsed <= PURCHASE_DRAFT_QUANTITY_MAX &&
    parsed % PURCHASE_DRAFT_QUANTITY_UNIT === 0;
}
