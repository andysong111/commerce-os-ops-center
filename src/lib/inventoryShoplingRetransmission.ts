import {
  SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE,
  storeInventoryOperation,
  type InventoryStockControlReport,
  type ShoplingStockDesiredStatus,
  type ShoplingStockProductKind,
  type ShoplingStockSyncOutcome,
} from "@/lib/inventoryStockControl";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  type RetransmissionItemMode,
  type ShoplingStockRetransmissionRequest,
} from "@/lib/inventoryShoplingRetransmissionPlan";

export {
  buildShoplingStockRetransmissionRequest,
  type RetransmissionItemMode,
  type ShoplingStockRetransmissionItem,
  type ShoplingStockRetransmissionRequest,
} from "@/lib/inventoryShoplingRetransmissionPlan";

export const SHOPLING_STOCK_RETRANSMISSION_REQUEST_OPERATION_TYPE =
  "SHOPLING_STOCK_RETRANSMISSION_REQUEST_EVENT";

export type RetransmissionItemState =
  | "PENDING"
  | ShoplingStockSyncOutcome
  | "BLOCKED";

type StoredRow = {
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

function snapshot(row: StoredRow) {
  const result = object(row.result_snapshot);
  const nested = object(result.snapshot);
  if (Object.keys(nested).length) return nested;
  const input = object(row.input_snapshot);
  return Object.keys(input).length ? input : result;
}

function requestFrom(row: StoredRow): ShoplingStockRetransmissionRequest | null {
  const source = snapshot(row);
  const requestId = text(source.requestId);
  const occurredAt = text(source.occurredAt || row.started_at);
  const rawItems = Array.isArray(source.items) ? source.items : [];
  const items = rawItems.flatMap((raw) => {
    const item = object(raw);
    const barcode = text(item.barcode);
    const desiredStatus = text(item.desiredStatus) as ShoplingStockDesiredStatus;
    const productKind = text(item.productKind) as ShoplingStockProductKind;
    const mode = text(item.mode) as RetransmissionItemMode;
    const jobId = text(item.jobId);
    if (
      !jobId ||
      !barcode ||
      !["SOLD_OUT", "ON_SALE"].includes(desiredStatus) ||
      !["OPTION", "SINGLE"].includes(productKind) ||
      !["REPLAY", "EXISTING_PENDING"].includes(mode)
    ) {
      return [];
    }
    return [{
      jobId,
      barcode,
      productName: text(item.productName) || barcode,
      modelNo: text(item.modelNo) || null,
      productKind,
      desiredStatus,
      desiredSince: text(item.desiredSince),
      mode,
    }];
  });
  if (!requestId || !occurredAt || !items.length) return null;
  return {
    requestId,
    occurredAt,
    reportFingerprint: text(source.reportFingerprint),
    reason: text(source.reason),
    items,
  };
}

export async function storeShoplingStockRetransmissionRequest(
  request: ShoplingStockRetransmissionRequest,
) {
  return storeInventoryOperation({
    operationType: SHOPLING_STOCK_RETRANSMISSION_REQUEST_OPERATION_TYPE,
    sourceEventId: `shopling-stock-retransmission:${request.requestId}`,
    correlationId: `shopling-stock-retransmission:${request.requestId}`,
    snapshot: request,
  });
}

async function loadRows(operationType: string, limit: number) {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  const response = await admin
    .from("commerce_operation_runs")
    .select("input_snapshot,result_snapshot,started_at")
    .eq("operation_type", operationType)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (response.error) {
    throw new Error(`SHOPLING_RETRANSMISSION_READ_FAILED:${response.error.message}`);
  }
  return Array.isArray(response.data)
    ? [...(response.data as StoredRow[])].reverse()
    : [];
}

export async function loadShoplingStockRetransmissionState(
  report: InventoryStockControlReport,
) {
  const [requestRows, syncRows] = await Promise.all([
    loadRows(SHOPLING_STOCK_RETRANSMISSION_REQUEST_OPERATION_TYPE, 500),
    loadRows(SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE, 10_000),
  ]);
  const requests = requestRows
    .map(requestFrom)
    .filter((value): value is ShoplingStockRetransmissionRequest => Boolean(value));
  const latestOutcomeByJobId = new Map<string, ShoplingStockSyncOutcome>();
  for (const row of syncRows) {
    const source = snapshot(row);
    const jobId = text(source.jobId);
    const outcome = text(source.outcome) as ShoplingStockSyncOutcome;
    if (jobId && ["STARTED", "SUCCEEDED", "FAILED", "UNCERTAIN"].includes(outcome)) {
      latestOutcomeByJobId.set(jobId, outcome);
    }
  }
  const currentByBarcode = new Map(report.rows.map((row) => [row.barcode, row]));
  const batches = requests.map((request) => {
    const items = request.items.map((item) => {
      const current = currentByBarcode.get(item.barcode);
      const identityStillCurrent = Boolean(
        current &&
          !current.syncBlocked &&
          current.desiredStatus === item.desiredStatus &&
          current.productKind === item.productKind &&
          current.desiredSince === item.desiredSince,
      );
      const outcome = latestOutcomeByJobId.get(item.jobId);
      const state: RetransmissionItemState = !identityStillCurrent
        ? "BLOCKED"
        : outcome || "PENDING";
      return { ...item, state };
    });
    return {
      ...request,
      items,
      succeededCount: items.filter((item) => item.state === "SUCCEEDED").length,
      pendingCount: items.filter((item) => item.state === "PENDING").length,
      startedCount: items.filter((item) => item.state === "STARTED").length,
      exceptionCount: items.filter((item) =>
        ["FAILED", "UNCERTAIN", "BLOCKED"].includes(item.state),
      ).length,
    };
  });
  const replayItems = batches.flatMap((batch) =>
    batch.items
      .filter((item) => item.mode === "REPLAY" && item.state === "PENDING")
      .map((item) => ({ ...item, requestId: batch.requestId })),
  );
  return { batches, replayItems, latest: batches[batches.length - 1] ?? null };
}
