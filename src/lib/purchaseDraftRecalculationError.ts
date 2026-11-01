export type ParsedPurchaseDraftRecalculationError = {
  code: string;
  inputsSaved: boolean;
  savedStockBandCount: number;
  savedDiscontinuationCount: number;
};

const SAVED_INPUT_WRAPPER = "PURCHASE_DRAFT_RECALCULATION_FAILED_AFTER_INPUT_SAVE";

function nonnegativeInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function parsePurchaseDraftRecalculationError(
  raw: unknown,
): ParsedPurchaseDraftRecalculationError {
  const message = String(raw ?? "").trim();
  const parts = message.split(":");
  const outerCode = parts[0] || "PURCHASE_CYCLE_INLINE_RECALCULATION_FAILED";
  if (outerCode !== SAVED_INPUT_WRAPPER) {
    return {
      code: outerCode,
      inputsSaved: false,
      savedStockBandCount: 0,
      savedDiscontinuationCount: 0,
    };
  }

  return {
    code: parts[3] || SAVED_INPUT_WRAPPER,
    inputsSaved: true,
    savedStockBandCount: nonnegativeInteger(parts[1]),
    savedDiscontinuationCount: nonnegativeInteger(parts[2]),
  };
}
