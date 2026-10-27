export type InternalChinaStockInputMode =
  | "MANUAL"
  | "AUTO_SOLD_OUT"
  | "AUTO_NEW_SOURCING";

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

export function internalChinaStockInputMode(input: {
  sourcingConfirmed?: unknown;
  inventoryConfirmed?: unknown;
  inventoryVerified?: unknown;
  inventoryRequiresReview?: unknown;
  inventoryBaselineKind?: unknown;
  inventoryBaselineQuantity?: unknown;
}): InternalChinaStockInputMode {
  if (input.sourcingConfirmed === true) return "AUTO_NEW_SOURCING";
  if (
    input.inventoryConfirmed === true &&
    input.inventoryVerified === true &&
    input.inventoryRequiresReview !== true &&
    text(input.inventoryBaselineKind) === "SOLD_OUT_RESET" &&
    Number(input.inventoryBaselineQuantity) === 0
  ) {
    return "AUTO_SOLD_OUT";
  }
  return "MANUAL";
}
