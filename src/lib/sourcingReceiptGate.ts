type UnknownRecord = Record<string, unknown>;

export type SourcingReceiptStatus = "not_sourcing" | "pending" | "confirmed";

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function sourcingOptions(item: UnknownRecord) {
  if (!Array.isArray(item.orderOptions)) return [];
  return item.orderOptions
    .map(record)
    .filter((option) => Boolean(text(option.sourcingIntakeId)));
}

function optionIsPending(option: UnknownRecord) {
  const lifecycleStatus = text(option.lifecycleStatus).toUpperCase();
  if (lifecycleStatus === "RESERVED") return true;
  return !text(option.receiptId);
}

export function sourcingReceiptStatus(itemInput: unknown): SourcingReceiptStatus {
  const item = record(itemInput);
  const source = record(item.source);
  const options = sourcingOptions(item);
  const isSourcingItem =
    text(source.system) === "commerce-os-sourcing-engine" || options.length > 0;
  if (!isSourcingItem) return "not_sourcing";
  if (options.length) {
    return options.some(optionIsPending) ? "pending" : "confirmed";
  }
  const lifecycleStatus = text(source.lifecycleStatus).toUpperCase();
  if (lifecycleStatus === "RESERVED") return "pending";
  if (
    text(source.receiptId) ||
    text(source.sourcingReceiptStatus).toLowerCase() === "confirmed"
  ) {
    return "confirmed";
  }
  return "pending";
}

export function isSourcingReceiptPending(itemInput: unknown) {
  return sourcingReceiptStatus(itemInput) === "pending";
}
