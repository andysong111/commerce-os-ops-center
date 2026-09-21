import { createHash } from "node:crypto";
import {
  SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE,
  type ExactInventoryAfterReset,
  type InventoryStockControlReport,
  type ShoplingStockProductKind,
  type ShoplingStockSyncOutcome,
} from "@/lib/inventoryStockControl";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const INVENTORY_MANUAL_ON_SALE_OPERATION_TYPE =
  "INVENTORY_MANUAL_ON_SALE_EVENT";

const READ_LIMIT = 10_000;
const BARCODE_PATTERN = /^B[A-Z]{1,2}\d+-\d+$/;

export type InventoryManualOnSaleEvent = {
  eventId: string;
  barcode: string;
  productKind: ShoplingStockProductKind;
  modelNo: string | null;
  occurredAt: string;
  note: string;
};

type StoredOperationRow = {
  source_event_id?: unknown;
  input_snapshot?: unknown;
  result_snapshot?: unknown;
  started_at?: unknown;
  status?: unknown;
};

type SyncEvent = {
  barcode: string;
  desiredStatus: "SOLD_OUT" | "ON_SALE";
  outcome: ShoplingStockSyncOutcome;
  occurredAt: string;
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

function syncOutcome(value: unknown): ShoplingStockSyncOutcome | null {
  const normalized = text(value).toUpperCase();
  return ["STARTED", "SUCCEEDED", "FAILED", "UNCERTAIN"].includes(normalized)
    ? (normalized as ShoplingStockSyncOutcome)
    : null;
}

function snapshot(row: StoredOperationRow) {
  const result = object(row.result_snapshot);
  const nested = object(result.snapshot);
  if (Object.keys(nested).length) return nested;
  const input = object(row.input_snapshot);
  return Object.keys(input).length ? input : result;
}

function manualOnSaleFrom(
  row: StoredOperationRow,
): InventoryManualOnSaleEvent | null {
  const source = snapshot(row);
  const eventId = text(source.eventId) || text(row.source_event_id);
  const normalizedBarcode = barcode(source.barcode);
  const kind = productKind(source.productKind);
  const occurredAt = iso(source.occurredAt) || iso(row.started_at);
  if (!eventId || !normalizedBarcode || !kind || !occurredAt) return null;
  return {
    eventId,
    barcode: normalizedBarcode,
    productKind: kind,
    modelNo: text(source.modelNo) || null,
    occurredAt,
    note: text(source.note).slice(0, 500),
  };
}

function syncFrom(row: StoredOperationRow): SyncEvent | null {
  const source = snapshot(row);
  const normalizedBarcode = barcode(source.barcode);
  const desiredStatus = text(source.desiredStatus).toUpperCase();
  const outcome = syncOutcome(source.outcome);
  const occurredAt = iso(source.occurredAt) || iso(row.started_at);
  if (
    !normalizedBarcode ||
    !["SOLD_OUT", "ON_SALE"].includes(desiredStatus) ||
    !outcome ||
    !occurredAt
  ) {
    return null;
  }
  return {
    barcode: normalizedBarcode,
    desiredStatus: desiredStatus as "SOLD_OUT" | "ON_SALE",
    outcome,
    occurredAt,
  };
}

async function readRows(operationType: string) {
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
    throw new Error(
      `INVENTORY_MANUAL_ON_SALE_READ_FAILED:${operationType}:${result.error?.message ?? "NON_ARRAY_DATA"}`,
    );
  }
  if (result.data.length >= READ_LIMIT) {
    throw new Error(`INVENTORY_MANUAL_ON_SALE_TRUNCATED:${operationType}`);
  }
  return result.data as StoredOperationRow[];
}

export function shouldApplyManualOnSaleOverride(
  row: Pick<ExactInventoryAfterReset, "resetAt"> | null,
  overrideAt: string,
) {
  if (!row) return true;
  const rowAt = Date.parse(row.resetAt);
  const manualAt = Date.parse(overrideAt);
  if (!Number.isFinite(manualAt)) return false;
  if (!Number.isFinite(rowAt)) return true;
  return manualAt > rowAt;
}

export async function loadLatestInventoryManualOnSaleOverrides() {
  const rows = await readRows(INVENTORY_MANUAL_ON_SALE_OPERATION_TYPE);
  const latest = new Map<string, InventoryManualOnSaleEvent>();
  for (const row of rows) {
    const event = manualOnSaleFrom(row);
    if (!event) {
      throw new Error("INVENTORY_MANUAL_ON_SALE_AUTHORITY_INCOMPLETE");
    }
    const current = latest.get(event.barcode);
    if (
      !current ||
      event.occurredAt > current.occurredAt ||
      (event.occurredAt === current.occurredAt && event.eventId > current.eventId)
    ) {
      latest.set(event.barcode, event);
    }
  }
  return latest;
}

function fingerprint(rows: ExactInventoryAfterReset[]) {
  const stable = rows.map((row) => ({
    barcode: row.barcode,
    resetAt: row.resetAt,
    resetEventId: row.resetEventId,
    exactInventoryQuantity: row.exactInventoryQuantity,
    desiredStatus: row.desiredStatus,
    desiredSince: row.desiredSince,
    latestSyncOutcome: row.latestSyncOutcome,
    syncNeeded: row.syncNeeded,
    syncBlocked: row.syncBlocked,
    inventoryQuantityKnown: row.inventoryQuantityKnown !== false,
    manualStatusOnly: row.manualStatusOnly === true,
  }));
  return `sha256:${createHash("sha256").update(JSON.stringify(stable)).digest("hex")}`;
}

function blockedReport(
  report: InventoryStockControlReport,
  blocker: string,
): InventoryStockControlReport {
  return {
    ...report,
    state: "BLOCKED",
    message:
      "수동 판매중 전환 원장을 확인하지 못해 상충되는 Shopling 상태 변경을 막기 위해 자동 실행을 차단했습니다.",
    blockers: [...new Set([...report.blockers, blocker])],
  };
}

export async function overlayInventoryStockControlReportWithManualOnSale(
  report: InventoryStockControlReport,
): Promise<InventoryStockControlReport> {
  let overrides: Map<string, InventoryManualOnSaleEvent>;
  let syncRows: StoredOperationRow[];
  let planning: Awaited<ReturnType<typeof loadProductPlanningSnapshot>>;
  try {
    [overrides, syncRows, planning] = await Promise.all([
      loadLatestInventoryManualOnSaleOverrides(),
      readRows(SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE),
      loadProductPlanningSnapshot(),
    ]);
  } catch (error) {
    return blockedReport(
      report,
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!overrides.size) return report;

  const syncEvents = syncRows
    .map(syncFrom)
    .filter((value): value is SyncEvent => Boolean(value));
  const planningByBarcode = new Map(
    (planning.products ?? [])
      .filter((row) => row.skuActive !== false)
      .map((row) => [barcode(row.barcode), row] as const)
      .filter(([key]) => Boolean(key)),
  );
  const rowsByBarcode = new Map(report.rows.map((row) => [row.barcode, row]));

  for (const override of overrides.values()) {
    const current = rowsByBarcode.get(override.barcode) ?? null;
    if (!shouldApplyManualOnSaleOverride(current, override.occurredAt)) continue;

    const profile = planningByBarcode.get(override.barcode);
    const relatedSync = syncEvents
      .filter(
        (event) =>
          event.barcode === override.barcode &&
          event.occurredAt >= override.occurredAt,
      )
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    const latestSync = relatedSync.at(-1) ?? null;
    const succeededForDesired = [...relatedSync]
      .reverse()
      .find(
        (event) =>
          event.desiredStatus === "ON_SALE" && event.outcome === "SUCCEEDED",
      );
    const latestSucceeded = [...relatedSync]
      .reverse()
      .find((event) => event.outcome === "SUCCEEDED") ?? null;
    const unresolved = [...relatedSync]
      .reverse()
      .find(
        (event) =>
          (event.outcome === "STARTED" || event.outcome === "UNCERTAIN") &&
          (!latestSucceeded || event.occurredAt > latestSucceeded.occurredAt),
      );

    const modelNo =
      override.modelNo || text(profile?.modelNo) || current?.modelNo || null;
    let syncBlockReason: string | null = null;
    if (override.productKind === "SINGLE" && !modelNo) {
      syncBlockReason = "단품 A21 검색에 필요한 모델번호가 없습니다.";
    } else if (unresolved) {
      syncBlockReason =
        "이전 Shopling 실행이 STARTED/UNCERTAIN 상태라 중복 실행을 차단했습니다.";
    }

    const activeListings = (profile?.listings ?? []).filter(
      (listing) => listing.active !== false,
    );
    const goodsKeys = [
      ...new Set(
        activeListings
          .map((listing) => text(listing.goodsKey))
          .filter((value) => /^\d+$/.test(value)),
      ),
    ].sort((left, right) => Number(left) - Number(right));

    const next: ExactInventoryAfterReset = {
      barcode: override.barcode,
      productName:
        text(profile?.productName) || current?.productName || override.barcode,
      optionName: text(profile?.optionName) || current?.optionName || null,
      modelNo,
      goodsKeys: goodsKeys.length ? goodsKeys : current?.goodsKeys ?? [],
      productKind: override.productKind,
      resetAt: override.occurredAt,
      resetEventId: override.eventId,
      receivedSinceReset: current?.receivedSinceReset ?? 0,
      soldSinceReset: current?.soldSinceReset ?? 0,
      exactInventoryQuantity: current?.exactInventoryQuantity ?? 0,
      recent30StockoutDays: current?.recent30StockoutDays ?? 0,
      desiredStatus: "ON_SALE",
      desiredSince: override.occurredAt,
      salesCoverageReady: false,
      receiptEvidenceCount: current?.receiptEvidenceCount ?? 0,
      salesEvidenceCount: current?.salesEvidenceCount ?? 0,
      latestSyncOutcome: latestSync?.outcome ?? null,
      latestSyncAt: latestSync?.occurredAt ?? null,
      syncNeeded: !succeededForDesired,
      syncBlocked: Boolean(syncBlockReason),
      syncBlockReason,
      inventoryQuantityKnown: false,
      manualStatusOnly: true,
    };
    rowsByBarcode.set(override.barcode, next);
  }

  const rows = [...rowsByBarcode.values()].sort((left, right) => {
    const pending = Number(right.syncNeeded) - Number(left.syncNeeded);
    if (pending !== 0) return pending;
    return left.barcode.localeCompare(right.barcode, "ko");
  });
  const exactRows = rows.filter(
    (row) => row.salesCoverageReady && row.inventoryQuantityKnown !== false,
  );

  return {
    ...report,
    message:
      `${report.message} 수량 미확정 판매중 전환은 Shopling 판매상태만 수동으로 유지하며, 이후 품절 확정 또는 재고 수량 확정이 입력되면 자동 재고 판단으로 복귀합니다.`,
    fingerprint: fingerprint(rows),
    exactCount: exactRows.length,
    soldOutCount: rows.filter(
      (row) => row.desiredStatus === "SOLD_OUT" && row.manualStatusOnly !== true,
    ).length,
    onSaleCount: rows.filter((row) => row.desiredStatus === "ON_SALE").length,
    pendingSyncCount: rows.filter(
      (row) => row.syncNeeded && !row.syncBlocked,
    ).length,
    uncertainSyncCount: rows.filter(
      (row) =>
        row.latestSyncOutcome === "STARTED" ||
        row.latestSyncOutcome === "UNCERTAIN",
    ).length,
    rows,
  };
}

export function normalizeInventoryManualOnSaleInput(input: {
  eventId?: unknown;
  barcode?: unknown;
  productKind?: unknown;
  modelNo?: unknown;
  occurredAt?: unknown;
  note?: unknown;
}): InventoryManualOnSaleEvent {
  const eventId = text(input.eventId);
  const normalizedBarcode = barcode(input.barcode);
  const kind = productKind(input.productKind);
  const occurredAt = input.occurredAt
    ? iso(input.occurredAt)
    : new Date().toISOString();
  if (!eventId) throw new Error("MANUAL_ON_SALE_EVENT_ID_REQUIRED");
  if (!normalizedBarcode) throw new Error("MANUAL_ON_SALE_BARCODE_INVALID");
  if (!kind) throw new Error("MANUAL_ON_SALE_PRODUCT_KIND_REQUIRED");
  if (!occurredAt) throw new Error("MANUAL_ON_SALE_OCCURRED_AT_INVALID");
  return {
    eventId,
    barcode: normalizedBarcode,
    productKind: kind,
    modelNo: text(input.modelNo) || null,
    occurredAt,
    note: text(input.note).slice(0, 500),
  };
}
