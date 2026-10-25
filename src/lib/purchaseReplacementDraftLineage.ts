import type { PurchaseReplacementDraftLine } from "@/lib/purchaseCyclePreflightCore";

type ReplacementLedgerRow = {
  sourceSystem: string;
  sourceRunId: string | null;
  barcode: string;
  openQuantity: number;
  committedQuantity: number;
  latestPayload: unknown;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function payloadExclusions(rows: ReplacementLedgerRow[]) {
  const result = new Set<string>();
  for (const row of rows) {
    const payload = object(row.latestPayload);
    const values = Array.isArray(payload.operatorExcludedBarcodes)
      ? payload.operatorExcludedBarcodes
      : [];
    for (const value of values) {
      const barcode = text(value).toUpperCase().replace(/\s+/g, "");
      if (barcode) result.add(barcode);
    }
  }
  return result;
}

/**
 * Rebuilds the visible replacement snapshot and recovers only its immediate
 * predecessor. This lets a corrected recommendation pass reconsider lines
 * that a buggy pass just dropped, without walking older history or reviving
 * operator-excluded products.
 */
export function purchaseReplacementDraftSnapshotLines(
  commitments: ReplacementLedgerRow[],
  activeRows: ReplacementLedgerRow[],
  draftId: string,
  overrides: ReadonlyMap<string, { targetQuantity: number }>,
): PurchaseReplacementDraftLine[] {
  const quantities = new Map<string, number>();
  for (const row of activeRows) {
    quantities.set(
      row.barcode,
      Math.max(quantities.get(row.barcode) ?? 0, row.openQuantity),
    );
  }
  for (const [barcode, override] of overrides) {
    if (!quantities.has(barcode)) continue;
    if (override.targetQuantity > 0) quantities.set(barcode, override.targetQuantity);
    else quantities.delete(barcode);
  }

  const currentDraftRows = activeRows.filter((row) => row.sourceRunId === draftId);
  const supersedesDraftIds = [...new Set(
    currentDraftRows
      .map((row) => text(object(row.latestPayload).supersedesDraftId))
      .filter(Boolean),
  )];
  const excluded = payloadExclusions(currentDraftRows);
  const predecessorId = supersedesDraftIds.length === 1 ? supersedesDraftIds[0] : null;
  const predecessorRows = predecessorId
    ? commitments.filter(
        (row) =>
          row.sourceSystem === "fast-purchase-mvp" &&
          row.sourceRunId === predecessorId &&
          row.committedQuantity > 0 &&
          !quantities.has(row.barcode) &&
          !excluded.has(row.barcode),
      )
    : [];
  const predecessorBarcodes = new Set(predecessorRows.map((row) => row.barcode));

  const sourceByBarcode = new Map(
    [...predecessorRows, ...activeRows].map((row) => [row.barcode, row] as const),
  );
  for (const row of activeRows) {
    const payload = object(row.latestPayload);
    if (payload.sourcingConfirmed === true || payload.manualAddition === true) {
      sourceByBarcode.set(row.barcode, row);
    }
  }
  for (const row of predecessorRows) {
    quantities.set(
      row.barcode,
      Math.max(quantities.get(row.barcode) ?? 0, row.committedQuantity),
    );
  }

  return [...quantities].map(([barcode, quantity]) => {
    const source = sourceByBarcode.get(barcode);
    const payload = object(source?.latestPayload);
    return {
      barcode,
      quantity,
      name: text(payload.productName),
      preserveOnRegeneration:
        payload.sourcingConfirmed === true || payload.manualAddition === true,
      recoveredFromPredecessor: predecessorBarcodes.has(barcode),
    };
  });
}
