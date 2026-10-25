export const PRODUCT_MASTER_SALES_SNAPSHOT_TIMEOUT_MS = 240_000;

function errorEvidence(error: unknown, depth = 0): string {
  if (depth > 2 || error == null) return "";
  if (typeof error === "string") return error;
  if (!(error instanceof Error)) return String(error);
  const cause = "cause" in error ? error.cause : null;
  return [error.name, error.message, errorEvidence(cause, depth + 1)]
    .filter(Boolean)
    .join(" ");
}

export function retryableProductMasterSalesSnapshotRead(error: unknown) {
  return /abort|timeout|timed out|fetch failed|econnreset|econnrefused|etimedout|eai_again|enotfound|sales_event_snapshot_failed:(?:408|429|5\d\d)/i.test(
    errorEvidence(error),
  );
}
