import { createHash } from "node:crypto";
import {
  SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE,
  type ExactInventoryAfterReset,
  type InventoryStockControlReport,
  type ShoplingStockDesiredStatus,
  type ShoplingStockProductKind,
  type ShoplingStockSyncOutcome,
} from "@/lib/inventoryStockControl";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const INVENTORY_STOCKTAKE_BASELINE_OPERATION_TYPE =
  "INVENTORY_STOCKTAKE_BASELINE_EVENT";

const READ_LIMIT = 10_000;
const BARCODE_PATTERN = /^B[A-Z]{1,2}\d+-\d+$/;

export type InventoryStocktakeBaselineEvent = {
  eventId: string;
  barcode: string;
  productKind: ShoplingStockProductKind;
  modelNo: string | null;
  baselineQuantity: number;
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
  desiredStatus: ShoplingStockDesiredStatus;
  outcome: ShoplingStockSyncOutcome;
  occurredAt: string;
};

type StocktakeRuntimeMeta = {
  baselineType?: "STOCKTAKE";
  baselineQuantity?: number;
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

function desiredStatus(value: unknown): ShoplingStockDesiredStatus | null {
  const normalized = text(value).toUpperCase();
  return normalized === "SOLD_OUT" || normalized === "ON_SALE"
    ? normalized
    : null;
}

function syncOutcome(value: unknown): ShoplingStockSyncOutcome | null {
  const normalized = text(value).toUpperCase();
  return ["STARTED", "SUCCEEDED", "FAILED", "UNCERTAIN"].includes(normalized)
    ? (normalized as ShoplingStockSyncOutcome)
    : null;
}

function positiveQuantity(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  return Number.isInteger(rounded) && rounded >= 1 && rounded <= 1_000_000
    ? rounded
    : null;
}

function snapshot(row: StoredOperationRow) {
  const result = object(row.result_snapshot);
  const nested = object(result.snapshot);
  if (Object.keys(nested).length) return nested;
  const input = object(row.input_snapshot);
  return Object.keys(input).length ? input : result;
}

function baselineFrom(
  row: StoredOperationRow,
): InventoryStocktakeBaselineEvent | null {
  const source = snapshot(row);
  const normalizedBarcode = barcode(source.barcode);
  const kind = productKind(source.productKind);
  const baselineQuantity = positiveQuantity(source.baselineQuantity);
  const occurredAt = iso(source.occurredAt) || iso(row.started_at);
  if (!normalizedBarcode || !kind || !baselineQuantity || !occurredAt) {
    return null;
  }
  return {
    eventId: text(source.eventId) || text(row.source_event_id),
    barcode: normalizedBarcode,
    productKind: kind,
    modelNo: text(source.modelNo) || null,
    baselineQuantity,
    occurredAt,
    note: text(source.note).slice(0, 500),
  };
}

function syncFrom(row: StoredOperationRow): SyncEvent | null {
  const source = snapshot(row);
  const normalizedBarcode = barcode(source.barcode);
  const desired = desiredStatus(source.desiredStatus);
  const outcome = syncOutcome(source.outcome);
  const occurredAt = iso(source.occurredAt) || iso(row.started_at);
  if (!normalizedBarcode || !desired || !outcome || !occurredAt) return null;
  return {
    barcode: normalizedBarcode,
    desiredStatus: desired,
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
  if (result.error) {
    throw new Error(
      `INVENTORY_STOCKTAKE_READ_FAILED:${operationType}:${result.error.message}`,
    );
  }
  return (result.data ?? []) as StoredOperationRow[];
}

export async function loadLatestInventoryStocktakeBaselines() {
  const rows = await readRows(INVENTORY_STOCKTAKE_BASELINE_OPERATION_TYPE);
  const latest = new Map<string, InventoryStocktakeBaselineEvent>();
  for (const row of rows) {
    const event = baselineFrom(row);
    if (!event) continue;
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

function runtimeMeta(row: ExactInventoryAfterReset) {
  return row as ExactInventoryAfterReset & StocktakeRuntimeMeta;
}

function fingerprint(rows: ExactInventoryAfterReset[]) {
  const stable = rows.map((row) => {
    const meta = runtimeMeta(row);
    return {
      barcode: row.barcode,
      resetAt: row.resetAt,
      resetEventId: row.resetEventId,
      baselineType: meta.baselineType ?? "ZERO_RESET",
      baselineQuantity: meta.baselineQuantity ?? 0,
      exactInventoryQuantity: row.exactInventoryQuantity,
      desiredStatus: row.desiredStatus,
      desiredSince: row.desiredSince,
      latestSyncOutcome: row.latestSyncOutcome,
      syncNeeded: row.syncNeeded,
      syncBlocked: row.syncBlocked,
    };
  });
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
      "실사 재고 기준점 원장을 확인하지 못해 잘못된 재입고 복구를 방지하기 위해 Shopling 실행을 차단했습니다.",
    blockers: [...new Set([...report.blockers, blocker])],
  };
}

export async function overlayInventoryStockControlReportWithStocktakeBaselines(
  report: InventoryStockControlReport,
): Promise<InventoryStockControlReport> {
  let latestBaselines: Map<string, InventoryStocktakeBaselineEvent>;
  try {
    latestBaselines = await loadLatestInventoryStocktakeBaselines();
  } catch (error) {
    return blockedReport(
      report,
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!latestBaselines.size) return report;

  let syncRows: StoredOperationRow[];
  let planning: Awaited<ReturnType<typeof loadProductPlanningSnapshot>>;
  try {
    [syncRows, planning] = await Promise.all([
      readRows(SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE),
      loadProductPlanningSnapshot(),
    ]);
  } catch (error) {
    return blockedReport(
      report,
      error instanceof Error ? error.message : String(error),
    );
  }

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

  for (const baseline of latestBaselines.values()) {
    const current = rowsByBarcode.get(baseline.barcode) ?? null;
    const currentMeta = current ? runtimeMeta(current) : null;
    const currentIsSameStocktake = Boolean(
      current &&
        currentMeta?.baselineType === "STOCKTAKE" &&
        current.resetEventId === baseline.eventId,
    );

    if (
      current &&
      !currentIsSameStocktake &&
      Date.parse(current.resetAt) >= Date.parse(baseline.occurredAt)
    ) {
      continue;
    }

    const profile = planningByBarcode.get(baseline.barcode);
    const evidenceCurrent = currentIsSameStocktake ? current : null;
    const receivedSinceBaseline = evidenceCurrent?.receivedSinceReset ?? 0;
    const soldSinceBaseline = evidenceCurrent?.soldSinceReset ?? 0;
    const exactInventoryQuantity = Math.max(
      0,
      baseline.baselineQuantity + receivedSinceBaseline - soldSinceBaseline,
    );
    const desired: ShoplingStockDesiredStatus =
      exactInventoryQuantity > 0 ? "ON_SALE" : "SOLD_OUT";
    const relatedSync = syncEvents
      .filter((event) => event.barcode === baseline.barcode)
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    const latestSync = relatedSync.at(-1) ?? null;
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
    const modelNo = baseline.modelNo || text(profile?.modelNo) || current?.modelNo || null;
    const salesCoverageReady = evidenceCurrent?.salesCoverageReady ?? false;
    let syncBlockReason: string | null = null;
    if (!salesCoverageReady) {
      syncBlockReason =
        "실사 재고 기준점 이후의 Canonical/Tail 판매 범위를 완전히 확인하지 못했습니다.";
    } else if (baseline.productKind === "SINGLE" && !modelNo) {
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

    const next = {
      barcode: baseline.barcode,
      productName:
        text(profile?.productName) || current?.productName || baseline.barcode,
      optionName: text(profile?.optionName) || current?.optionName || null,
      modelNo,
      goodsKeys: goodsKeys.length ? goodsKeys : current?.goodsKeys ?? [],
      productKind: baseline.productKind,
      resetAt: baseline.occurredAt,
      resetEventId: baseline.eventId,
      receivedSinceReset: receivedSinceBaseline,
      soldSinceReset: soldSinceBaseline,
      exactInventoryQuantity,
      recent30StockoutDays:
        exactInventoryQuantity > 0
          ? 0
          : evidenceCurrent?.recent30StockoutDays ?? 0,
      desiredStatus: desired,
      desiredSince: baseline.occurredAt,
      salesCoverageReady,
      receiptEvidenceCount: evidenceCurrent?.receiptEvidenceCount ?? 0,
      salesEvidenceCount: evidenceCurrent?.salesEvidenceCount ?? 0,
      latestSyncOutcome: latestSync?.outcome ?? null,
      latestSyncAt: latestSync?.occurredAt ?? null,
      syncNeeded: latestSucceeded?.desiredStatus !== desired,
      syncBlocked: Boolean(syncBlockReason),
      syncBlockReason,
      baselineType: "STOCKTAKE" as const,
      baselineQuantity: baseline.baselineQuantity,
    } satisfies ExactInventoryAfterReset & StocktakeRuntimeMeta;
    rowsByBarcode.set(baseline.barcode, next);
  }

  const rows = [...rowsByBarcode.values()].sort((left, right) => {
    const pending = Number(right.syncNeeded) - Number(left.syncNeeded);
    if (pending !== 0) return pending;
    return left.barcode.localeCompare(right.barcode, "ko");
  });
  const exactRows = rows.filter((row) => row.salesCoverageReady);
  const stocktakeCount = rows.filter(
    (row) => runtimeMeta(row).baselineType === "STOCKTAKE",
  ).length;

  return {
    ...report,
    message: `${report.message} 실사 재고 기준점 ${stocktakeCount}건은 RECEIVED를 만들지 않고 해당 실물수량을 새 기준재고로 사용합니다.`,
    fingerprint: fingerprint(rows),
    resetCount: rows.length - stocktakeCount,
    exactCount: exactRows.length,
    soldOutCount: exactRows.filter((row) => row.desiredStatus === "SOLD_OUT")
      .length,
    onSaleCount: exactRows.filter((row) => row.desiredStatus === "ON_SALE")
      .length,
    pendingSyncCount: exactRows.filter(
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

export function normalizeInventoryStocktakeBaselineInput(input: {
  eventId?: unknown;
  barcode?: unknown;
  productKind?: unknown;
  modelNo?: unknown;
  baselineQuantity?: unknown;
  occurredAt?: unknown;
  note?: unknown;
}): InventoryStocktakeBaselineEvent {
  const eventId = text(input.eventId);
  const normalizedBarcode = barcode(input.barcode);
  const kind = productKind(input.productKind);
  const baselineQuantity = positiveQuantity(input.baselineQuantity);
  const occurredAt = input.occurredAt
    ? iso(input.occurredAt)
    : new Date().toISOString();
  if (!eventId) throw new Error("STOCKTAKE_EVENT_ID_REQUIRED");
  if (!normalizedBarcode) throw new Error("STOCKTAKE_BARCODE_INVALID");
  if (!kind) throw new Error("STOCKTAKE_PRODUCT_KIND_REQUIRED");
  if (!baselineQuantity) throw new Error("STOCKTAKE_QUANTITY_POSITIVE_INTEGER_REQUIRED");
  if (!occurredAt) throw new Error("STOCKTAKE_OCCURRED_AT_INVALID");
  return {
    eventId,
    barcode: normalizedBarcode,
    productKind: kind,
    modelNo: text(input.modelNo) || null,
    baselineQuantity,
    occurredAt,
    note: text(input.note).slice(0, 500),
  };
}
