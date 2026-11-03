export type ManualDraftQuantityRow = {
  barcode: string;
  targetQuantity: number;
};

export function applyManualDraftBulkQuantity<T extends ManualDraftQuantityRow>(
  rows: T[],
  selectedBarcodes: Iterable<string>,
  targetQuantity: number,
) {
  const selected = new Set(selectedBarcodes);
  return rows.map((row) =>
    selected.has(row.barcode) ? { ...row, targetQuantity } : row,
  );
}
