import { createHash } from "node:crypto";
import type {
  ShoplingStockDesiredStatus,
  ShoplingStockSyncOutcome,
} from "./inventoryStockControl.ts";
import { createSupabaseAdminClient } from "./supabase/admin.ts";

const SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE =
  "SHOPLING_STOCK_STATUS_SYNC_EVENT";

export type ProductLaunchShoplingStockEvent = {
  eventId: string;
  barcode: string;
  desiredStatus: ShoplingStockDesiredStatus;
  outcome: ShoplingStockSyncOutcome;
  occurredAt: string;
};

export type ProductLaunchShoplingStockSnapshot = {
  generatedAt: string;
  contentFingerprint: string;
  rows: ProductLaunchShoplingStockEvent[];
};

export type ProductLaunchShoplingBarcodeState = {
  latestEvent: ProductLaunchShoplingStockEvent;
  latestSucceeded: ProductLaunchShoplingStockEvent | null;
};

export type ProductLaunchStockStatusIndex = {
  checkedAt: string;
  sourceFingerprint: string;
  byBarcode: Map<string, ProductLaunchShoplingBarcodeState>;
};

type StoredOperationRow = {
  source_event_id?: unknown;
  input_snapshot?: unknown;
  result_snapshot?: unknown;
  started_at?: unknown;
};

const READ_LIMIT = 10_000;
const BARCODE_PATTERN = /^B[A-Z]{1,2}\d+-\d+$/;

let cachedSnapshot:
  | { loadedAt: number; value: ProductLaunchShoplingStockSnapshot }
  | null = null;
let pendingSnapshot: Promise<ProductLaunchShoplingStockSnapshot> | null = null;

/**
 * The launch workflow follows confirmed Commerce OS -> Shopling stock-state
 * transmissions. Quantity estimates are deliberately not an authority here.
 */
export async function loadProductLaunchShoplingStockSnapshot(
  options: { maxAgeMs?: number } = {},
) {
  const maxAgeMs = Math.max(0, Math.min(30_000, options.maxAgeMs ?? 10_000));
  if (
    maxAgeMs > 0 &&
    cachedSnapshot &&
    Date.now() - cachedSnapshot.loadedAt <= maxAgeMs
  ) {
    return cachedSnapshot.value;
  }
  if (!pendingSnapshot) {
    pendingSnapshot = readProductLaunchShoplingStockSnapshot().finally(() => {
      pendingSnapshot = null;
    });
  }
  const value = await pendingSnapshot;
  cachedSnapshot = { value, loadedAt: Date.now() };
  return value;
}

async function readProductLaunchShoplingStockSnapshot(): Promise<ProductLaunchShoplingStockSnapshot> {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  const result = await admin
    .from("commerce_operation_runs")
    .select("source_event_id,input_snapshot,result_snapshot,started_at")
    .eq("operation_type", SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE)
    .eq("status", "SUCCEEDED")
    .order("started_at", { ascending: true })
    .limit(READ_LIMIT);
  if (result.error || !Array.isArray(result.data)) {
    throw new Error(
      `PRODUCT_LAUNCH_SHOPLING_STOCK_READ_FAILED:${result.error?.message ?? "NON_ARRAY_DATA"}`,
    );
  }
  if (result.data.length >= READ_LIMIT) {
    throw new Error("PRODUCT_LAUNCH_SHOPLING_STOCK_TRUNCATED");
  }
  return buildProductLaunchShoplingStockSnapshotFromRows(result.data);
}

export function buildProductLaunchShoplingStockSnapshotFromRows(
  inputRows: unknown[],
  generatedAt = new Date().toISOString(),
): ProductLaunchShoplingStockSnapshot {
  const rows = (inputRows as StoredOperationRow[]).map(shoplingStockEventFrom);
  if (rows.some((row) => !row)) {
    throw new Error("PRODUCT_LAUNCH_SHOPLING_STOCK_AUTHORITY_INCOMPLETE");
  }
  const normalizedRows = rows.filter(
    (row): row is ProductLaunchShoplingStockEvent => Boolean(row),
  );
  return {
    generatedAt,
    contentFingerprint: fingerprint(normalizedRows),
    rows: normalizedRows,
  };
}

export function buildProductLaunchStockStatusIndex(
  snapshot: ProductLaunchShoplingStockSnapshot,
): ProductLaunchStockStatusIndex {
  const byBarcode = new Map<string, ProductLaunchShoplingBarcodeState>();
  const rows = snapshot.rows
    .map((row, order) => ({ row, order }))
    .sort((left, right) => {
      const occurred = left.row.occurredAt.localeCompare(right.row.occurredAt);
      return occurred || left.order - right.order;
    });
  for (const { row } of rows) {
    const barcode = normalizeBarcode(row.barcode);
    if (!barcode) continue;
    const current = byBarcode.get(barcode);
    byBarcode.set(barcode, {
      latestEvent: row,
      latestSucceeded:
        row.outcome === "SUCCEEDED"
          ? row
          : current?.latestSucceeded ?? null,
    });
  }
  return {
    checkedAt: text(snapshot.generatedAt) || new Date().toISOString(),
    sourceFingerprint:
      text(snapshot.contentFingerprint) || fingerprint(snapshot.rows),
    byBarcode,
  };
}

function shoplingStockEventFrom(
  row: StoredOperationRow,
): ProductLaunchShoplingStockEvent | null {
  const source = storedSnapshot(row);
  const eventId = text(source.eventId) || text(row.source_event_id);
  const barcode = normalizeBarcode(source.barcode);
  const desiredStatus = normalizedDesiredStatus(source.desiredStatus);
  const outcome = normalizedOutcome(source.outcome);
  const occurredAt = normalizedIso(source.occurredAt) || normalizedIso(row.started_at);
  if (!eventId || !barcode || !desiredStatus || !outcome || !occurredAt) return null;
  return { eventId, barcode, desiredStatus, outcome, occurredAt };
}

function storedSnapshot(row: StoredOperationRow) {
  const result = record(row.result_snapshot);
  const nested = record(result.snapshot);
  if (Object.keys(nested).length) return nested;
  const input = record(row.input_snapshot);
  return Object.keys(input).length ? input : result;
}

function normalizedDesiredStatus(value: unknown): ShoplingStockDesiredStatus | null {
  const normalized = text(value).toUpperCase();
  return normalized === "SOLD_OUT" || normalized === "ON_SALE"
    ? normalized
    : null;
}

function normalizedOutcome(value: unknown): ShoplingStockSyncOutcome | null {
  const normalized = text(value).toUpperCase();
  return ["STARTED", "SUCCEEDED", "FAILED", "UNCERTAIN"].includes(normalized)
    ? (normalized as ShoplingStockSyncOutcome)
    : null;
}

function normalizedIso(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeBarcode(value: unknown) {
  const normalized = text(value)
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, "");
  return BARCODE_PATTERN.test(normalized) ? normalized : "";
}

function fingerprint(rows: ProductLaunchShoplingStockEvent[]) {
  const stable = rows.map((row) => ({
    eventId: row.eventId,
    barcode: row.barcode,
    desiredStatus: row.desiredStatus,
    outcome: row.outcome,
    occurredAt: row.occurredAt,
  }));
  return `sha256:${createHash("sha256").update(JSON.stringify(stable)).digest("hex")}`;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
