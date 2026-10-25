export const PRODUCT_LAUNCH_PRICE_ROUND_UP_UNIT_KRW = 10;

export function roundUpProductLaunchPriceKrw(
  value: unknown,
  unit = PRODUCT_LAUNCH_PRICE_ROUND_UP_UNIT_KRW,
) {
  const numeric = Number(value);
  const normalizedUnit = Math.max(
    1,
    Math.floor(Number(unit) || PRODUCT_LAUNCH_PRICE_ROUND_UP_UNIT_KRW),
  );
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.ceil(numeric / normalizedUnit) * normalizedUnit;
}

export function productLaunchSalePriceFromUnitCostKrw(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  const unitCostKrw = Math.ceil(numeric);
  return roundUpProductLaunchPriceKrw(unitCostKrw * 2);
}
