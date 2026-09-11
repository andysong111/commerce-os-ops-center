export type HistoricalOrderSettlementInput = {
  cycleMonth: string;
  currentCycleMonth: string;
  draftCount: number;
  orderedQuantity: number;
  receivedQuantity: number;
  openQuantity: number;
  receiptState: string;
  landedCostState: string;
  fundingState: string;
  warnings: string[];
};

function month(value: unknown) {
  return typeof value === "string" && /^20\d{2}-(0[1-9]|1[0-2])$/.test(value)
    ? value
    : null;
}

function nonNegativeInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

// A past month cannot be newly closed from the operator UI. If its own
// persisted business evidence proves that a real draft was fully received,
// final landed cost was closed, and funding was closed with no read warnings,
// the closure report may treat only the *order stage* as historically settled.
// This helper is read-only: it never writes a monthly-close record, releases a
// draft, creates receipt quantity, or authorizes a new purchase.
export function hasHistoricalOrderSettlementEvidence(
  input: HistoricalOrderSettlementInput,
) {
  const cycleMonth = month(input.cycleMonth);
  const currentCycleMonth = month(input.currentCycleMonth);
  if (!cycleMonth || !currentCycleMonth || cycleMonth >= currentCycleMonth) {
    return false;
  }
  if (
    !nonNegativeInteger(input.draftCount) ||
    !nonNegativeInteger(input.orderedQuantity) ||
    !nonNegativeInteger(input.receivedQuantity) ||
    !nonNegativeInteger(input.openQuantity)
  ) {
    return false;
  }
  return (
    input.draftCount > 0 &&
    input.orderedQuantity > 0 &&
    input.receivedQuantity >= input.orderedQuantity &&
    input.openQuantity === 0 &&
    input.receiptState === "COMPLETE" &&
    input.landedCostState === "COMPLETE" &&
    input.fundingState === "COMPLETE" &&
    Array.isArray(input.warnings) &&
    input.warnings.length === 0
  );
}
