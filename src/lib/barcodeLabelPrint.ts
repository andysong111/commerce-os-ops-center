export function calculateBarcodeLabelPrintCount(
  quantity: number,
  unitsPerLabel: number,
): number {
  if (!Number.isFinite(quantity) || !Number.isFinite(unitsPerLabel)) return 0;

  const normalizedQuantity = Math.max(0, Math.floor(quantity));
  const normalizedUnitsPerLabel = Math.floor(unitsPerLabel);

  if (normalizedQuantity === 0 || normalizedUnitsPerLabel < 1) return 0;

  return Math.ceil(normalizedQuantity / normalizedUnitsPerLabel);
}
