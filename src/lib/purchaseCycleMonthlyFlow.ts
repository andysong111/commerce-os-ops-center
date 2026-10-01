export type MonthlyCommitmentProgressRow = {
  orderedQuantity: number;
  receivedQuantity: number;
  openQuantity: number;
};

export type MonthlyPurchaseProgressSummary = {
  orderCount: number;
  lineCount: number;
  totalQuantity: number;
};

export function summarizeMonthlyPurchaseProgress(
  rows: MonthlyCommitmentProgressRow[],
  purchase: MonthlyPurchaseProgressSummary | null | undefined,
) {
  const orderedRows = rows.filter((row) => row.orderedQuantity > 0);
  const orderedQuantity = orderedRows.reduce(
    (sum, row) => sum + row.orderedQuantity,
    0,
  );
  const receivedQuantity = orderedRows.reduce(
    (sum, row) => sum + row.receivedQuantity,
    0,
  );
  const inboundOpenQuantity = orderedRows.reduce(
    (sum, row) => sum + row.openQuantity,
    0,
  );
  const recordedOrderCount = purchase?.orderCount ?? 0;

  return {
    orderedQuantity,
    receivedQuantity,
    inboundOpenQuantity,
    displayedOrderQuantity:
      recordedOrderCount > 0 ? purchase?.totalQuantity ?? orderedQuantity : orderedQuantity,
    displayedOrderLineCount:
      recordedOrderCount > 0 ? purchase?.lineCount ?? orderedRows.length : orderedRows.length,
    hasOrder: recordedOrderCount > 0 || orderedQuantity > 0,
  };
}
