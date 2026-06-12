export interface BarcodeLabelPrintItem {
  id: string;
  quantity: number;
}

export interface BarcodeLabelPrintCount {
  itemId: string;
  quantity: number;
  unitsPerLabel: number;
  printCount: number;
}

function toNonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

export function normalizeUnitsPerLabel(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

export function calculateBarcodeLabelPrintCount(
  quantity: number,
  unitsPerLabel: number,
): number {
  const normalizedQuantity = toNonNegativeInteger(quantity);
  if (normalizedQuantity === 0) return 0;

  return Math.ceil(normalizedQuantity / normalizeUnitsPerLabel(unitsPerLabel));
}

export function buildBarcodeLabelPrintCounts(
  items: BarcodeLabelPrintItem[],
  unitsPerLabelByItemId: Readonly<Record<string, number>>,
): BarcodeLabelPrintCount[] {
  return items.map((item) => {
    const quantity = toNonNegativeInteger(item.quantity);
    const unitsPerLabel = normalizeUnitsPerLabel(
      unitsPerLabelByItemId[item.id] ?? 1,
    );

    return {
      itemId: item.id,
      quantity,
      unitsPerLabel,
      printCount: calculateBarcodeLabelPrintCount(quantity, unitsPerLabel),
    };
  });
}

export function calculateTotalBarcodeLabelPrintCount(
  counts: BarcodeLabelPrintCount[],
): number {
  return counts.reduce((total, item) => total + item.printCount, 0);
}
