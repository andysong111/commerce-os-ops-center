import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const RESET_OPERATION_TYPE = "INVENTORY_STOCKOUT_RESET_EVENT";
const STOCKTAKE_OPERATION_TYPE = "INVENTORY_STOCKTAKE_BASELINE_EVENT";
const READ_LIMIT = 10_000;
const BARCODE_PATTERN = /^B[A-Z]{1,2}\d+-\d+$/;

type StoredOperationRow = {
  source_event_id?: unknown;
  input_snapshot?: unknown;
  result_snapshot?: unknown;
  started_at?: unknown;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizedBarcode(value: unknown) {
  const normalized = text(value)
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, "");
  return BARCODE_PATTERN.test(normalized) ? normalized : "";
}

function validIso(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed);
}

function snapshot(row: StoredOperationRow) {
  const result = object(row.result_snapshot);
  const nested = object(result.snapshot);
  if (Object.keys(nested).length) return nested;
  const input = object(row.input_snapshot);
  return Object.keys(input).length ? input : result;
}

function validCommonAuthority(row: StoredOperationRow) {
  const source = snapshot(row);
  const eventId = text(source.eventId) || text(row.source_event_id);
  const productKind = text(source.productKind).toUpperCase();
  const occurredAt = source.occurredAt ?? row.started_at;
  return Boolean(
    eventId &&
      normalizedBarcode(source.barcode) &&
      (productKind === "OPTION" || productKind === "SINGLE") &&
      validIso(occurredAt),
  );
}

function validStocktakeAuthority(row: StoredOperationRow) {
  if (!validCommonAuthority(row)) return false;
  const source = snapshot(row);
  const quantity = Number(source.baselineQuantity);
  return (
    Number.isSafeInteger(quantity) &&
    quantity >= 1 &&
    quantity <= 1_000_000
  );
}

async function readAuthorityRows(operationType: string) {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  const result = await admin
    .from("commerce_operation_runs")
    .select("source_event_id,input_snapshot,result_snapshot,started_at,status")
    .eq("operation_type", operationType)
    .eq("status", "SUCCEEDED")
    .order("started_at", { ascending: true })
    .limit(READ_LIMIT);
  if (result.error || !Array.isArray(result.data)) {
    throw new Error(`PURCHASE_CYCLE_LOCAL_BASELINE_READ_FAILED:${operationType}`);
  }
  const rows = result.data as StoredOperationRow[];
  if (rows.length >= READ_LIMIT) {
    throw new Error(`PURCHASE_CYCLE_LOCAL_BASELINE_TRUNCATED:${operationType}`);
  }
  return rows;
}

/**
 * Purchase-cycle natural accumulation is safe only when an absent exact row is
 * confirmed absence, not a local authoritative baseline that was silently
 * dropped by a tolerant parser. This preflight is read-only and fail-closed.
 */
export async function assertPurchaseCycleLocalBaselineAuthorityReadable() {
  const [resetRows, stocktakeRows] = await Promise.all([
    readAuthorityRows(RESET_OPERATION_TYPE),
    readAuthorityRows(STOCKTAKE_OPERATION_TYPE),
  ]);
  if (resetRows.some((row) => !validCommonAuthority(row))) {
    throw new Error("PURCHASE_CYCLE_LOCAL_RESET_INCOMPLETE");
  }
  if (stocktakeRows.some((row) => !validStocktakeAuthority(row))) {
    throw new Error("PURCHASE_CYCLE_LOCAL_STOCKTAKE_INCOMPLETE");
  }
  return {
    resetCount: resetRows.length,
    stocktakeCount: stocktakeRows.length,
  };
}
