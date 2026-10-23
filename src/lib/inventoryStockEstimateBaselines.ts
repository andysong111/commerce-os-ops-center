import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ShoplingStockProductKind } from "@/lib/inventoryStockControl";

export const INVENTORY_STOCK_ESTIMATE_BASELINE_OPERATION_TYPE =
  "INVENTORY_STOCK_ESTIMATE_BASELINE_EVENT";

const READ_LIMIT = 10_000;
const BARCODE_PATTERN = /^B[A-Z]{1,2}\d+-\d+$/;

export type InventoryStockEstimateBaselineEvent = {
  eventId: string;
  barcode: string;
  productKind: ShoplingStockProductKind;
  modelNo: string | null;
  estimatedQuantity: number;
  occurredAt: string;
  note: string;
};

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

function barcode(value: unknown) {
  const normalized = text(value)
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, "");
  return BARCODE_PATTERN.test(normalized) ? normalized : "";
}

function iso(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function productKind(value: unknown): ShoplingStockProductKind | null {
  const normalized = text(value).toUpperCase();
  return normalized === "OPTION" || normalized === "SINGLE"
    ? normalized
    : null;
}

function nonnegativeQuantity(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 1_000_000
    ? parsed
    : null;
}

function snapshot(row: StoredOperationRow) {
  const result = object(row.result_snapshot);
  const nested = object(result.snapshot);
  if (Object.keys(nested).length) return nested;
  const input = object(row.input_snapshot);
  return Object.keys(input).length ? input : result;
}

function eventFrom(row: StoredOperationRow) {
  const source = snapshot(row);
  const eventId = text(source.eventId) || text(row.source_event_id);
  const normalizedBarcode = barcode(source.barcode);
  const kind = productKind(source.productKind);
  const estimatedQuantity = nonnegativeQuantity(source.estimatedQuantity);
  const occurredAt = iso(source.occurredAt) || iso(row.started_at);
  if (
    !eventId ||
    !normalizedBarcode ||
    !kind ||
    estimatedQuantity === null ||
    !occurredAt
  ) {
    return null;
  }
  return {
    eventId,
    barcode: normalizedBarcode,
    productKind: kind,
    modelNo: text(source.modelNo) || null,
    estimatedQuantity,
    occurredAt,
    note: text(source.note).slice(0, 500),
  } satisfies InventoryStockEstimateBaselineEvent;
}

export function normalizeInventoryStockEstimateInput(input: {
  eventId?: unknown;
  barcode?: unknown;
  productKind?: unknown;
  modelNo?: unknown;
  estimatedQuantity?: unknown;
  occurredAt?: unknown;
  note?: unknown;
}): InventoryStockEstimateBaselineEvent {
  const eventId = text(input.eventId);
  const normalizedBarcode = barcode(input.barcode);
  const kind = productKind(input.productKind);
  const estimatedQuantity = nonnegativeQuantity(input.estimatedQuantity);
  const occurredAt = input.occurredAt
    ? iso(input.occurredAt)
    : new Date().toISOString();
  if (!eventId) throw new TypeError("INVENTORY_STOCK_ESTIMATE_EVENT_ID_REQUIRED");
  if (!normalizedBarcode) throw new TypeError("INVENTORY_STOCK_ESTIMATE_BARCODE_INVALID");
  if (!kind) throw new TypeError("INVENTORY_STOCK_ESTIMATE_PRODUCT_KIND_INVALID");
  if (estimatedQuantity === null) {
    throw new TypeError("INVENTORY_STOCK_ESTIMATE_QUANTITY_INVALID");
  }
  if (!occurredAt) throw new TypeError("INVENTORY_STOCK_ESTIMATE_OCCURRED_AT_INVALID");
  return {
    eventId,
    barcode: normalizedBarcode,
    productKind: kind,
    modelNo: text(input.modelNo) || null,
    estimatedQuantity,
    occurredAt,
    note: text(input.note).slice(0, 500),
  };
}

export async function loadLatestInventoryStockEstimates() {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  const result = await admin
    .from("commerce_operation_runs")
    .select("source_event_id,input_snapshot,result_snapshot,started_at")
    .eq("operation_type", INVENTORY_STOCK_ESTIMATE_BASELINE_OPERATION_TYPE)
    .eq("status", "SUCCEEDED")
    .order("started_at", { ascending: true })
    .limit(READ_LIMIT);
  if (result.error) {
    throw new Error(`INVENTORY_STOCK_ESTIMATE_READ_FAILED:${result.error.message}`);
  }
  const rows = (Array.isArray(result.data) ? result.data : []) as StoredOperationRow[];
  if (rows.length >= READ_LIMIT) {
    throw new Error("INVENTORY_STOCK_ESTIMATE_TRUNCATED");
  }
  const latest = new Map<string, InventoryStockEstimateBaselineEvent>();
  for (const row of rows) {
    const event = eventFrom(row);
    if (!event) throw new Error("INVENTORY_STOCK_ESTIMATE_AUTHORITY_INCOMPLETE");
    latest.set(event.barcode, event);
  }
  return latest;
}
