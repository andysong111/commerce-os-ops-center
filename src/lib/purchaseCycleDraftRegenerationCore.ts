export type RegenerableDraftCommitment = {
  sourceRunId: string | null;
  barcode: string;
  openQuantity: number;
  status: string;
  orderedQuantity: number;
  receivedQuantity: number;
};

export function assertDraftCanBeRegenerated<T extends RegenerableDraftCommitment>(
  rows: T[],
  expectedDraftId: string,
): T[] {
  const activeRows = rows.filter((row) => row.openQuantity > 0);
  const activeDraftIds = [
    ...new Set(
      activeRows
        .map((row) => row.sourceRunId)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  if (
    activeDraftIds.length !== 1 ||
    activeDraftIds[0] !== expectedDraftId
  ) {
    throw new Error("PURCHASE_DRAFT_REGENERATION_ACTIVE_DRAFT_CHANGED");
  }
  const unsafe = activeRows.find(
    (row) =>
      row.sourceRunId !== expectedDraftId ||
      row.status !== "RESERVED" ||
      row.orderedQuantity > 0 ||
      row.receivedQuantity > 0,
  );
  if (unsafe) {
    throw new Error(
      `PURCHASE_DRAFT_REGENERATION_ALREADY_PROGRESSING:${unsafe.barcode}`,
    );
  }
  return activeRows;
}
