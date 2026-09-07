import { createHash } from "node:crypto";
import { CHINA_ORDER_EVENT_OPERATION_TYPE } from "@/lib/chinaOrderLedger";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { loadStage8CanonicalSalesEventSnapshot } from "@/lib/stage8CanonicalSalesEventSnapshot";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const INVENTORY_STOCKOUT_RESET_OPERATION_TYPE =
  "INVENTORY_STOCKOUT_RESET_EVENT";
export const SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE =
  "SHOPLING_STOCK_STATUS_SYNC_EVENT";

const READ_LIMIT = 10_000;
const BARCODE_PATTERN = /^B[A-Z]{1,2}\d+-\d+$/;
const DAY_MS = 86_400_000;

export type ShoplingStockProductKind = "OPTION" | "SINGLE";
export type ShoplingStockDesiredStatus = "SOLD_OUT" | "ON_SALE";
export type ShoplingStockSyncOutcome =
  | "STARTED"
  | "SUCCEEDED"
  | "FAILED"
  | "UNCERTAIN";

export type InventoryStockoutResetEvent = {
  eventId: string;
  barcode: string;
  productKind: ShoplingStockProductKind;
  modelNo: string | null;
  occurredAt: string;
  note: string;
};

export type ShoplingStockSyncEvent = {
  eventId: string;
  jobId: string;
  barcode: string;
  productKind: ShoplingStockProductKind;
  modelNo: string | null;
  desiredStatus: ShoplingStockDesiredStatus;
  outcome: ShoplingStockSyncOutcome;
  occurredAt: string;
  message: string;
  evidence: unknown;
};

export type ExactInventoryAfterReset = {
  barcode: string;
  productName: string;
  optionName: string | null;
  modelNo: string | null;
  goodsKeys: string[];
  productKind: ShoplingStockProductKind;
  resetAt: string;
  resetEventId: string;
  receivedSinceReset: number;
  soldSinceReset: number;
  exactInventoryQuantity: number;
  recent30StockoutDays: number;
  desiredStatus: ShoplingStockDesiredStatus;
  desiredSince: string;
  salesCoverageReady: boolean;
  receiptEvidenceCount: number;
  salesEvidenceCount: number;
  latestSyncOutcome: ShoplingStockSyncOutcome | null;
  latestSyncAt: string | null;
  syncNeeded: boolean;
  syncBlocked: boolean;
  syncBlockReason: string | null;
};

export type InventoryStockControlReport = {
  generatedAt: string;
  state: "READY" | "BLOCKED";
  message: string;
  fingerprint: string;
  resetCount: number;
  exactCount: number;
  soldOutCount: number;
  onSaleCount: number;
  pendingSyncCount: number;
  uncertainSyncCount: number;
  rows: ExactInventoryAfterReset[];
  blockers: string[];
};

type StoredOperationRow = {
  source_event_id?: unknown;
  input_snapshot?: unknown;
  result_snapshot?: unknown;
  started_at?: unknown;
  status?: unknown;
};

type ReceiptPoint = {
  barcode: string;
  occurredAt: string;
  delta: number;
  sourceLineId: string;
};

type StockTimelinePoint = {
  occurredAt: string;
  delta: number;
  order: number;
  type: "RECEIPT" | "SALE";
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

function quantity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function iso(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function productKind(value: unknown): ShoplingStockProductKind | null {
  const normalized = text(value).toUpperCase();
  if (normalized === "OPTION" || normalized === "SINGLE") return normalized;
  return null;
}

function desiredStatus(value: unknown): ShoplingStockDesiredStatus | null {
  const normalized = text(value).toUpperCase();
  if (normalized === "SOLD_OUT" || normalized === "ON_SALE") return normalized;
  return null;
}

function syncOutcome(value: unknown): ShoplingStockSyncOutcome | null {
  const normalized = text(value).toUpperCase();
  if (
    normalized === "STARTED" ||
    normalized === "SUCCEEDED" ||
    normalized === "FAILED" ||
    normalized === "UNCERTAIN"
  ) {
    return normalized;
  }
  return null;
}

function snapshot(row: StoredOperationRow) {
  const result = object(row.result_snapshot);
  const nested = object(result.snapshot);
  if (Object.keys(nested).length) return nested;
  const input = object(row.input_snapshot);
  return Object.keys(input).length ? input : result;
}

function resetEventFrom(row: StoredOperationRow): InventoryStockoutResetEvent | null {
  const source = snapshot(row);
  const normalizedBarcode = barcode(source.barcode);
  const kind = productKind(source.productKind);
  const occurredAt = iso(source.occurredAt) || iso(row.started_at);
  if (!normalizedBarcode || !kind || !occurredAt) return null;
  return {
    eventId: text(source.eventId) || text(row.source_event_id),
    barcode: normalizedBarcode,
    productKind: kind,
    modelNo: text(source.modelNo) || null,
    occurredAt,
    note: text(source.note).slice(0, 500),
  };
}

function syncEventFrom(row: StoredOperationRow): ShoplingStockSyncEvent | null {
  const source = snapshot(row);
  const normalizedBarcode = barcode(source.barcode);
  const kind = productKind(source.productKind);
  const desired = desiredStatus(source.desiredStatus);
  const outcome = syncOutcome(source.outcome);
  const occurredAt = iso(source.occurredAt) || iso(row.started_at);
  if (!normalizedBarcode || !kind || !desired || !outcome || !occurredAt) {
    return null;
  }
  return {
    eventId: text(source.eventId) || text(row.source_event_id),
    jobId: text(source.jobId),
    barcode: normalizedBarcode,
    productKind: kind,
    modelNo: text(source.modelNo) || null,
    desiredStatus: desired,
    outcome,
    occurredAt,
    message: text(source.message).slice(0, 1_000),
    evidence: source.evidence ?? null,
  };
}

function receiptPointsFromRows(rows: StoredOperationRow[]) {
  const byLine = new Map<
    string,
    Array<{
      barcode: string;
      occurredAt: string;
      status: string;
      requested: number;
      ordered: number;
      received: number | null;
    }>
  >();
  for (const row of rows) {
    const source = object(row.input_snapshot);
    const normalizedBarcode = barcode(source.barcode);
    const sourceSystem = text(source.sourceSystem);
    const sourceLineId = text(source.sourceLineId);
    const occurredAt = iso(source.occurredAt) || iso(row.started_at);
    if (!normalizedBarcode || !sourceSystem || !sourceLineId || !occurredAt) {
      continue;
    }
    const receivedRaw = source.receivedQuantity;
    const received =
      receivedRaw === null || receivedRaw === undefined || receivedRaw === ""
        ? null
        : quantity(receivedRaw);
    const key = `${sourceSystem}\u0000${sourceLineId}`;
    const values = byLine.get(key) ?? [];
    values.push({
      barcode: normalizedBarcode,
      occurredAt,
      status: text(source.status).toUpperCase(),
      requested: quantity(source.requestedQuantity),
      ordered: quantity(source.orderedQuantity),
      received,
    });
    byLine.set(key, values);
  }

  const points: ReceiptPoint[] = [];
  for (const [sourceLineId, values] of byLine) {
    values.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    let previousReceived = 0;
    let committed = 0;
    for (const value of values) {
      committed = Math.max(committed, value.requested, value.ordered);
      const cumulativeReceived =
        value.received !== null
          ? value.received
          : value.status === "RECEIVED"
            ? committed
            : previousReceived;
      const boundedReceived = Math.min(committed || cumulativeReceived, cumulativeReceived);
      const delta = Math.max(0, boundedReceived - previousReceived);
      if (delta > 0) {
        points.push({
          barcode: value.barcode,
          occurredAt: value.occurredAt,
          delta,
          sourceLineId,
        });
      }
      previousReceived = Math.max(previousReceived, boundedReceived);
    }
  }
  return points;
}

function recent30ZeroDays(
  resetAt: string,
  timeline: StockTimelinePoint[],
  nowIso: string,
) {
  const nowMs = Date.parse(nowIso);
  const windowStartMs = nowMs - 30 * DAY_MS;
  let quantityOnHand = 0;
  let cursorMs = Date.parse(resetAt);
  let zeroMs = 0;
  for (const point of timeline) {
    const pointMs = Date.parse(point.occurredAt);
    if (!Number.isFinite(pointMs) || pointMs < cursorMs) continue;
    if (quantityOnHand <= 0) {
      const start = Math.max(cursorMs, windowStartMs);
      const end = Math.min(pointMs, nowMs);
      if (end > start) zeroMs += end - start;
    }
    quantityOnHand = Math.max(0, quantityOnHand + point.delta);
    cursorMs = pointMs;
  }
  if (quantityOnHand <= 0) {
    const start = Math.max(cursorMs, windowStartMs);
    if (nowMs > start) zeroMs += nowMs - start;
  }
  return Math.min(30, Math.max(0, Math.round(zeroMs / DAY_MS)));
}

function stateTransition(
  resetAt: string,
  timeline: StockTimelinePoint[],
) {
  let quantityOnHand = 0;
  let desired: ShoplingStockDesiredStatus = "SOLD_OUT";
  let desiredSince = resetAt;
  for (const point of timeline) {
    quantityOnHand = Math.max(0, quantityOnHand + point.delta);
    const next: ShoplingStockDesiredStatus =
      quantityOnHand > 0 ? "ON_SALE" : "SOLD_OUT";
    if (next !== desired) {
      desired = next;
      desiredSince = point.occurredAt;
    }
  }
  return { quantityOnHand, desired, desiredSince };
}

async function readRows(operationType: string) {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  const result = await admin
    .from("commerce_operation_runs")
    .select(
      "source_event_id,input_snapshot,result_snapshot,started_at,status",
    )
    .eq("operation_type", operationType)
    .eq("status", "SUCCEEDED")
    .order("started_at", { ascending: true })
    .limit(READ_LIMIT);
  if (result.error) {
    throw new Error(
      `INVENTORY_STOCK_CONTROL_READ_FAILED:${operationType}:${result.error.message}`,
    );
  }
  return (result.data ?? []) as StoredOperationRow[];
}

export async function loadInventoryStockControlReport(): Promise<InventoryStockControlReport> {
  const generatedAt = new Date().toISOString();
  const blockers: string[] = [];
  const [resetRows, syncRows, receiptRows, sales, planning] = await Promise.all([
    readRows(INVENTORY_STOCKOUT_RESET_OPERATION_TYPE).catch((error) => {
      blockers.push(error instanceof Error ? error.message : String(error));
      return [] as StoredOperationRow[];
    }),
    readRows(SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE).catch((error) => {
      blockers.push(error instanceof Error ? error.message : String(error));
      return [] as StoredOperationRow[];
    }),
    readRows(CHINA_ORDER_EVENT_OPERATION_TYPE).catch((error) => {
      blockers.push(error instanceof Error ? error.message : String(error));
      return [] as StoredOperationRow[];
    }),
    loadStage8CanonicalSalesEventSnapshot().catch((error) => {
      blockers.push(error instanceof Error ? error.message : String(error));
      return null;
    }),
    loadProductPlanningSnapshot().catch((error) => {
      blockers.push(error instanceof Error ? error.message : String(error));
      return null;
    }),
  ]);

  const resetEvents = resetRows
    .map(resetEventFrom)
    .filter((event): event is InventoryStockoutResetEvent => Boolean(event));
  const syncEvents = syncRows
    .map(syncEventFrom)
    .filter((event): event is ShoplingStockSyncEvent => Boolean(event));
  const receiptPoints = receiptPointsFromRows(receiptRows);
  const latestResetByBarcode = new Map<string, InventoryStockoutResetEvent>();
  for (const event of resetEvents) {
    const current = latestResetByBarcode.get(event.barcode);
    if (!current || event.occurredAt >= current.occurredAt) {
      latestResetByBarcode.set(event.barcode, event);
    }
  }
  const planningByBarcode = new Map(
    (planning?.products ?? [])
      .filter((row) => row.skuActive !== false)
      .map((row) => [barcode(row.barcode), row] as const)
      .filter(([key]) => Boolean(key)),
  );
  const salesEvents = sales?.events ?? [];
  const rows: ExactInventoryAfterReset[] = [];

  for (const reset of latestResetByBarcode.values()) {
    const profile = planningByBarcode.get(reset.barcode);
    const receipts = receiptPoints.filter(
      (point) =>
        point.barcode === reset.barcode && point.occurredAt >= reset.occurredAt,
    );
    const sold = salesEvents.filter(
      (event) =>
        barcode(event.barcode) === reset.barcode &&
        event.validSale &&
        event.occurredAt >= reset.occurredAt,
    );
    const timeline: StockTimelinePoint[] = [
      ...receipts.map((point) => ({
        occurredAt: point.occurredAt,
        delta: point.delta,
        order: 0,
        type: "RECEIPT" as const,
      })),
      ...sold.map((event) => ({
        occurredAt: event.occurredAt,
        delta: -quantity(event.quantity),
        order: 1,
        type: "SALE" as const,
      })),
    ].sort(
      (left, right) =>
        left.occurredAt.localeCompare(right.occurredAt) || left.order - right.order,
    );
    const transition = stateTransition(reset.occurredAt, timeline);
    const coverageStartAt = sales?.coverageStartAt ?? null;
    const coverageEndAt = sales?.coverageEndAt ?? null;
    const salesCoverageReady = Boolean(
      sales?.state === "READY_READ_ONLY" &&
        coverageStartAt &&
        coverageEndAt &&
        coverageStartAt <= reset.occurredAt &&
        coverageEndAt >= reset.occurredAt,
    );
    const relatedSync = syncEvents
      .filter((event) => event.barcode === reset.barcode)
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    const latestSync = relatedSync[relatedSync.length - 1] ?? null;
    const succeededForDesired = [...relatedSync]
      .reverse()
      .find(
        (event) =>
          event.desiredStatus === transition.desired &&
          event.outcome === "SUCCEEDED" &&
          event.occurredAt >= transition.desiredSince,
      );
    const unresolved = [...relatedSync]
      .reverse()
      .find(
        (event) =>
          event.occurredAt >= transition.desiredSince &&
          (event.outcome === "STARTED" || event.outcome === "UNCERTAIN"),
      );
    const modelNo = reset.modelNo || text(profile?.modelNo) || null;
    let syncBlockReason: string | null = null;
    if (!salesCoverageReady) {
      syncBlockReason = "품절 초기화 이후의 Canonical 판매 범위를 완전히 확인하지 못했습니다.";
    } else if (reset.productKind === "SINGLE" && !modelNo) {
      syncBlockReason = "단품 A21 검색에 필요한 모델번호가 없습니다.";
    } else if (unresolved) {
      syncBlockReason = "이전 Shopling 실행이 STARTED/UNCERTAIN 상태라 중복 실행을 차단했습니다.";
    }
    const activeListings = (profile?.listings ?? []).filter(
      (listing) => listing.active !== false,
    );
    rows.push({
      barcode: reset.barcode,
      productName: text(profile?.productName) || reset.barcode,
      optionName: text(profile?.optionName) || null,
      modelNo,
      goodsKeys: [
        ...new Set(
          activeListings
            .map((listing) => text(listing.goodsKey))
            .filter((value) => /^\d+$/.test(value)),
        ),
      ].sort((left, right) => Number(left) - Number(right)),
      productKind: reset.productKind,
      resetAt: reset.occurredAt,
      resetEventId: reset.eventId,
      receivedSinceReset: receipts.reduce(
        (total, point) => total + point.delta,
        0,
      ),
      soldSinceReset: sold.reduce(
        (total, event) => total + quantity(event.quantity),
        0,
      ),
      exactInventoryQuantity: transition.quantityOnHand,
      recent30StockoutDays: recent30ZeroDays(
        reset.occurredAt,
        timeline,
        generatedAt,
      ),
      desiredStatus: transition.desired,
      desiredSince: transition.desiredSince,
      salesCoverageReady,
      receiptEvidenceCount: receipts.length,
      salesEvidenceCount: sold.length,
      latestSyncOutcome: latestSync?.outcome ?? null,
      latestSyncAt: latestSync?.occurredAt ?? null,
      syncNeeded: !succeededForDesired,
      syncBlocked: Boolean(syncBlockReason),
      syncBlockReason,
    });
  }

  rows.sort((left, right) => {
    const pending = Number(right.syncNeeded) - Number(left.syncNeeded);
    if (pending !== 0) return pending;
    return left.barcode.localeCompare(right.barcode, "ko");
  });
  const stable = rows.map((row) => ({
    barcode: row.barcode,
    resetAt: row.resetAt,
    exactInventoryQuantity: row.exactInventoryQuantity,
    desiredStatus: row.desiredStatus,
    desiredSince: row.desiredSince,
    latestSyncOutcome: row.latestSyncOutcome,
    syncNeeded: row.syncNeeded,
    syncBlocked: row.syncBlocked,
  }));
  const state = blockers.length ? "BLOCKED" : "READY";
  return {
    generatedAt,
    state,
    message:
      state === "READY"
        ? "품절 확정 시점을 재고 0 기준점으로 삼고, 이후 확정입고 델타와 Canonical 판매를 더하고 빼 정확재고와 Shopling 판매상태를 계산했습니다."
        : "재고·판매·입고 원장 중 일부를 읽지 못해 외부 Shopling 실행을 차단했습니다.",
    fingerprint: sha256(stable),
    resetCount: latestResetByBarcode.size,
    exactCount: rows.filter((row) => row.salesCoverageReady).length,
    soldOutCount: rows.filter((row) => row.desiredStatus === "SOLD_OUT").length,
    onSaleCount: rows.filter((row) => row.desiredStatus === "ON_SALE").length,
    pendingSyncCount: rows.filter(
      (row) => row.syncNeeded && !row.syncBlocked,
    ).length,
    uncertainSyncCount: rows.filter(
      (row) => row.latestSyncOutcome === "UNCERTAIN",
    ).length,
    rows,
    blockers,
  };
}

export function normalizeStockoutResetInput(input: {
  eventId?: unknown;
  barcode?: unknown;
  productKind?: unknown;
  modelNo?: unknown;
  occurredAt?: unknown;
  note?: unknown;
}): InventoryStockoutResetEvent {
  const eventId = text(input.eventId);
  const normalizedBarcode = barcode(input.barcode);
  const kind = productKind(input.productKind);
  const occurredAt = input.occurredAt
    ? iso(input.occurredAt)
    : new Date().toISOString();
  if (!eventId) throw new Error("STOCKOUT_RESET_EVENT_ID_REQUIRED");
  if (!normalizedBarcode) throw new Error("STOCKOUT_RESET_BARCODE_INVALID");
  if (!kind) throw new Error("STOCKOUT_RESET_PRODUCT_KIND_REQUIRED");
  if (!occurredAt) throw new Error("STOCKOUT_RESET_OCCURRED_AT_INVALID");
  return {
    eventId,
    barcode: normalizedBarcode,
    productKind: kind,
    modelNo: text(input.modelNo) || null,
    occurredAt,
    note: text(input.note).slice(0, 500),
  };
}

export function normalizeShoplingStockSyncInput(input: {
  eventId?: unknown;
  jobId?: unknown;
  barcode?: unknown;
  productKind?: unknown;
  modelNo?: unknown;
  desiredStatus?: unknown;
  outcome?: unknown;
  occurredAt?: unknown;
  message?: unknown;
  evidence?: unknown;
}): ShoplingStockSyncEvent {
  const eventId = text(input.eventId);
  const jobId = text(input.jobId);
  const normalizedBarcode = barcode(input.barcode);
  const kind = productKind(input.productKind);
  const desired = desiredStatus(input.desiredStatus);
  const outcome = syncOutcome(input.outcome);
  const occurredAt = input.occurredAt
    ? iso(input.occurredAt)
    : new Date().toISOString();
  if (!eventId || !jobId) throw new Error("SHOPLING_STOCK_SYNC_ID_REQUIRED");
  if (!normalizedBarcode) throw new Error("SHOPLING_STOCK_SYNC_BARCODE_INVALID");
  if (!kind || !desired || !outcome) {
    throw new Error("SHOPLING_STOCK_SYNC_STATE_INVALID");
  }
  if (!occurredAt) throw new Error("SHOPLING_STOCK_SYNC_OCCURRED_AT_INVALID");
  return {
    eventId,
    jobId,
    barcode: normalizedBarcode,
    productKind: kind,
    modelNo: text(input.modelNo) || null,
    desiredStatus: desired,
    outcome,
    occurredAt,
    message: text(input.message).slice(0, 1_000),
    evidence: input.evidence ?? null,
  };
}

export async function storeInventoryOperation(input: {
  operationType: string;
  sourceEventId: string;
  correlationId: string;
  snapshot: unknown;
  actorType?: string;
}) {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  const occurredAt =
    iso(object(input.snapshot).occurredAt) || new Date().toISOString();
  const result = await admin
    .from("commerce_operation_runs")
    .upsert(
      {
        operation_type: input.operationType,
        status: "SUCCEEDED",
        source: "COMMERCE_OS_INVENTORY_STOCK_CONTROL",
        source_event_id: input.sourceEventId,
        correlation_id: input.correlationId,
        actor_type: input.actorType || "OPS_OPERATOR",
        input_snapshot: input.snapshot,
        result_snapshot: {
          accepted: true,
          snapshot: input.snapshot,
        },
        error_message: null,
        started_at: occurredAt,
        finished_at: occurredAt,
        updated_at: occurredAt,
      },
      { onConflict: "source_event_id", ignoreDuplicates: true },
    )
    .select("id,source_event_id,started_at");
  if (result.error) {
    throw new Error(`INVENTORY_OPERATION_STORE_FAILED:${result.error.message}`);
  }
  const storedRows = Array.isArray(result.data) ? result.data : [];
  return {
    duplicate: storedRows.length === 0,
    rows: storedRows,
  };
}
